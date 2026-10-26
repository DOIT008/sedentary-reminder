'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, screen, nativeImage } = require('electron');
const { Engine, PHASE } = require('./engine.js');
const { Store } = require('./store.js');
const { resolveIcons } = require('./icons.js');
const { Autostart } = require('./autostart.js');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const ASSETS = path.join(ROOT, 'assets');
const FLAGS = process.argv.filter((a) => a.startsWith('--'));
const LOG_FILE = process.env.SR_LOG || null;

const log = (...args) => {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  if (LOG_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, `${line}\n`);
    } catch { /* 日志不该影响主流程 */ }
  }
  console.log(line);
};

// 遮罩窗口是在没有用户手势时弹出的，需要允许自动播放提示音
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('SedentaryReminder');
app.setAppUserModelId('SedentaryReminder.DeskStand');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let engine = null;
let store = null;
let persistPending = false;
let tray = null;
let icons = {};
let autostart = null;
let panel = null;
const overlays = [];
let isQuitting = false;
let tickTimer = null;
let lastTrayKey = '';
let overlayHideTimer = null;

function scheduleOverlayHide(delay) {
  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  overlayHideTimer = setTimeout(() => {
    overlayHideTimer = null;
    hideOverlays();
  }, delay);
}

function cancelOverlayHide() {
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
}

/* ------------------------------------------------------------------ 窗口 */

function windowBase() {
  return {
    icon: icons['app-512'] ? nativeImage.createFromPath(icons['app-512']) : undefined,
    backgroundColor: '#0b0f16',
    show: false,
    /**
     * 托盘常驻的窗口大部分时间是隐藏的，Chromium 会把隐藏页面的任务队列降速甚至冻结，
     * 解冻时机在 Windows 的无边框窗口上并不可靠：实测会出现「引擎还在跑、窗口还停在最后一帧」。
     * 我们的渲染器每秒只做一次很小的 DOM 更新，关掉节流换来确定性。
     */
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  };
}

function createPanel() {
  if (panel && !panel.isDestroyed()) return panel;
  panel = new BrowserWindow({
    ...windowBase(),
    width: 920,
    height: 660,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    transparent: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    title: '久坐提醒',
    webPreferences: { ...windowBase().webPreferences, zoomFactor: 1 },
  });
  panel.once('ready-to-show', () => {
    if (FLAGS.includes('--show-panel')) panel.show();
  });
  panel.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      panel.hide();
    }
  });
  panel.on('closed', () => { panel = null; });
  // 从托盘/最小化还原时，DOM 早就更新了，屏幕可能还留着旧帧，强制重绘一次
  const repaint = () => { if (panel && !panel.isDestroyed()) panel.webContents.invalidate(); };
  panel.on('show', repaint);
  panel.on('restore', repaint);
  panel.loadFile(path.join(RENDERER, 'panel', 'index.html'));
  if (FLAGS.includes('--devtools')) panel.webContents.openDevTools({ mode: 'detach' });
  return panel;
}

function showPanel() {
  const win = createPanel();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function togglePanel() {
  if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide();
  else showPanel();
}

function overlayTargets() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.map((d) => ({ display: d, primary: d.id === primary.id }));
}

function showOverlays(reason) {
  for (const { display, primary } of overlayTargets()) {
    const win = new BrowserWindow({
      ...windowBase(),
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: { ...windowBase().webPreferences, transparent: true },
    });
    win.setMenuBarVisibility(false);
    win.setAlwaysOnTop(true, 'screen-saver');
    /**
     * Windows 上没有 setSimpleFullscreen（那是 darwin API，调用直接抛错拖垮主进程）。
     * 实测：screen-saver 层 + setBounds(display.bounds) 就能盖住任务栏（物理 0,0..2560,1440，
     * WindowFromPoint 命中自己）；而 setKiosk/setFullScreen 会被收进 workArea，任务栏照样能点。
     */
    win.setBounds(engine.config.forceOverlay ? display.bounds : display.workArea);
    win.loadFile(path.join(RENDERER, 'overlay', 'index.html'), {
      query: { display: String(display.id), primary: primary ? '1' : '0', reason: reason || 'due' },
    });
    win.once('ready-to-show', () => {
      win.show();
      if (primary) win.focus();
    });
    win.on('closed', () => {
      const i = overlays.indexOf(win);
      if (i >= 0) overlays.splice(i, 1);
    });
    overlays.push(win);
  }
  log(`弹出遮罩 ${overlays.length} 屏 reason=${reason || 'due'} 强制全屏=${engine.config.forceOverlay}`);
}

function hideOverlays() {
  for (const win of overlays.splice(0)) {
    if (!win.isDestroyed()) win.close();
  }
}

/* ------------------------------------------------------------------ 状态广播 */

function broadcast(message) {
  const targets = [panel, ...overlays].filter((w) => w && !w.isDestroyed());
  for (const win of targets) {
    if (!win.webContents.isDestroyed()) win.webContents.send('engine:message', message);
  }
}

function sendState() {
  const snapshot = engine.snapshot();
  broadcast({ type: 'state', snapshot });
  return snapshot;
}

/* ------------------------------------------------------------------ 托盘 */

const TRAY_TITLES = {
  [PHASE.FOCUS]: '久坐提醒 · 专注中',
  [PHASE.BREAK]: '久坐提醒 · 休息中',
  [PHASE.IDLE]: '久坐提醒 · 已暂停（离开电脑）',
  [PHASE.PAUSED]: '久坐提醒 · 已手动暂停',
};

function trayImageName(phase, freezeReason) {
  if (phase === PHASE.PAUSED) return 'tray-paused-32';
  if (phase === PHASE.BREAK) return 'tray-break-32';
  if (phase === PHASE.IDLE) return freezeReason === 'lock' ? 'tray-idle-32' : 'tray-idle-32';
  return 'tray-focus-32';
}

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function refreshTray(snapshot) {
  if (!tray) return;
  const key = `${snapshot.phase}|${snapshot.freezeReason}`;
  if (key !== lastTrayKey) {
    lastTrayKey = key;
    const file = icons[trayImageName(snapshot.phase, snapshot.freezeReason)];
    if (file) tray.setImage(nativeImage.createFromPath(file));
    tray.setToolTip(TRAY_TITLES[snapshot.phase] || '久坐提醒');
    rebuildTrayMenu();
  }
  const detail = snapshot.phase === PHASE.BREAK
    ? `休息剩余 ${fmtClock(snapshot.breakRemainingSec)}`
    : snapshot.phase === PHASE.FOCUS
      ? `下次提醒 ${fmtClock(snapshot.focusRemainingSec)} 后`
      : snapshot.phase === PHASE.PAUSED
        ? `已暂停 · 恢复后还剩 ${fmtClock(snapshot.focusRemainingSec)}`
        : snapshot.freezeReason === 'lock'
          ? '锁屏期间不计时'
          : `已离开 ${Math.round(snapshot.awaySec / 60)} 分钟`;
  tray.setTitle?.(` ${detail}`);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const snapshot = engine.snapshot();
  const paused = snapshot.phase === PHASE.PAUSED;
  const template = [
    { label: `今日已坐 ${snapshot.stats.sittingMin} 分钟 · 完成休息 ${snapshot.stats.breaksDone} 次`, enabled: false },
    { type: 'separator' },
    { label: '打开主界面', click: showPanel },
    { label: '现在就开始休息', click: () => handleCommand('break-now') },
    { label: paused ? '恢复提醒' : '暂停提醒', click: () => handleCommand(paused ? 'resume' : 'pause') },
    { type: 'separator' },
    {
      label: '提醒间隔',
      submenu: [30, 45, 60, 90, 120].map((min) => ({
        label: `${min} 分钟`,
        type: 'radio',
        checked: engine.config.intervalMin === min,
        click: () => handleCommand('set-config', { intervalMin: min }),
      })),
    },
    {
      label: '休息时长',
      submenu: [1, 3, 5, 10, 15].map((min) => ({
        label: `${min} 分钟`,
        type: 'radio',
        checked: engine.config.breakMin === min,
        click: () => handleCommand('set-config', { breakMin: min }),
      })),
    },
    { type: 'separator' },
    { label: '开机自动启动', type: 'checkbox', checked: engine.config.autostart, click: (item) => handleCommand('set-config', { autostart: item.checked }) },
    { label: '提示音', type: 'checkbox', checked: engine.config.sound, click: (item) => handleCommand('set-config', { sound: item.checked }) },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ 命令 */

function handleCommand(name, payload) {
  const now = Date.now();
  switch (name) {
    case 'get-state':
      return engine.snapshot();
    case 'set-config':
      return applyConfig(payload || {});
    case 'snooze':
      engine.snooze(now);
      break;
    case 'skip':
      engine.skip(now);
      break;
    case 'finish':
      engine.finishNow(now);
      break;
    case 'pause':
      engine.pause(now);
      break;
    case 'resume':
      engine.resume(now);
      break;
    case 'reset':
      engine.resetCycle(now);
      break;
    case 'break-now':
      engine.triggerBreakNow(now);
      break;
    case 'show-panel':
      showPanel();
      break;
    case 'hide-panel':
      if (panel) panel.hide();
      break;
    case 'dismiss':
      cancelOverlayHide();
      hideOverlays();
      break;
    case 'minimize':
      if (panel) panel.minimize();
      break;
    case 'meta':
      return { userData: app.getPath('userData'), version: app.getVersion(), electron: process.versions.electron };
    case 'quit':
      isQuitting = true;
      app.quit();
      return { ok: true };
    default:
      return null;
  }
  const snapshot = sendState();
  persist();
  refreshTray(snapshot);
  return snapshot;
}

function applyConfig(patch) {
  const next = { ...patch };
  if (typeof next.autostart === 'boolean' && next.autostart !== engine.config.autostart) {
    if (next.autostart) {
      autostart
        .enable(process.execPath, app.isPackaged ? null : ROOT)
        .then((info) => {
          engine.config.autostart = true;
          persist();
          sendState();
          log('开机自启已开启 ->', info.lnk);
        })
        .catch((err) => {
          log('开机自启开启失败:', err.message);
          next.autostart = false;
          engine.applyConfig({ autostart: false });
          sendState();
        });
      delete next.autostart; // 异步结果再回写，避免乐观置位
    } else {
      autostart.disable().catch((err) => log('开机自启关闭失败:', err.message));
    }
  }
  engine.applyConfig(next);
  const snapshot = engine.snapshot();
  persist();
  refreshTray(snapshot);
  sendState();
  return snapshot;
}

function persist() {
  // Engine 构造期也会发事件（跨天补档），那时 engine 变量还没赋值，先记一笔等 bootstrap 补写
  if (!engine) {
    persistPending = true;
    return;
  }
  persistPending = false;
  store.write(engine.serialize());
}

/* ------------------------------------------------------------------ 引擎事件 */

function onEngineEvent(event) {
  log(`event ${event.type}${event.reason ? ` (${event.reason})` : ''}`);
  switch (event.type) {
    case 'break-start':
      cancelOverlayHide();
      showOverlays('due');
      break;
    case 'break-complete':
      scheduleOverlayHide(1150);
      break;
    case 'break-skipped':
    case 'break-snooze':
    case 'paused':
      cancelOverlayHide();
      hideOverlays();
      break;
    default:
      break;
  }
  broadcast({ type: 'event', event });
  persist();
}

/* ------------------------------------------------------------------ 启动 */

async function bootstrap() {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  store = new Store(path.join(userData, 'state.json'));
  icons = await resolveIcons(ASSETS);
  autostart = new Autostart({ userDataDir: userData });

  const saved = store.read();
  engine = new Engine({ now: Date.now(), saved, onEvent: onEngineEvent });
  if (persistPending) persist(); // 构造期的跨天补档要落盘，否则每次启动都重演一遍
  if (saved?.config) log(`载入配置 间隔=${engine.config.intervalMin}min 休息=${engine.config.breakMin}min`);

  tray = new Tray(nativeImage.createFromPath(icons['tray-focus-32'] || icons['app-256'] || path.join(ASSETS, 'app-256.png')));
  tray.setToolTip('久坐提醒');
  tray.on('click', togglePanel);
  tray.on('double-click', showPanel);
  rebuildTrayMenu();

  powerMonitor.on('lock-screen', () => { engine.freezeForLock(Date.now()); sendState(); });
  powerMonitor.on('suspend', () => { engine.freezeForLock(Date.now()); sendState(); });
  powerMonitor.on('unlock-screen', () => { engine.unfreeze(Date.now(), { postponeFullCycle: true }); sendState(); });
  powerMonitor.on('resume', () => { engine.unfreeze(Date.now(), { postponeFullCycle: true }); sendState(); });
  powerMonitor.on('shutdown', () => store.flush());

  screen.on('display-metrics-changed', () => {
    if (engine.state.phase === PHASE.BREAK) {
      hideOverlays();
      showOverlays('relayout');
    }
  });

  ipcMain.handle('engine:invoke', (event, name, payload) => handleCommand(name, payload));

  tickTimer = setInterval(() => {
    const idleSec = powerMonitor.getSystemIdleTime();
    engine.tick(Date.now(), idleSec, { overlayShowing: overlays.length > 0 });
    const snapshot = sendState();
    refreshTray(snapshot);
  }, 1000);

  createPanel();
  const snapshot = sendState();
  refreshTray(snapshot);
  log(`就绪 idle=${powerMonitor.getSystemIdleTime()}s displays=${screen.getAllDisplays().length} userData=${userData}`);
}

app.on('second-instance', () => showPanel());

app.on('window-all-closed', (event) => {
  event.preventDefault(); // 托盘常驻，不因窗口关闭退出
});

app.on('before-quit', () => {
  isQuitting = true;
  if (tickTimer) clearInterval(tickTimer);
  store?.flush();
});

app.whenReady().then(bootstrap).catch((err) => {
  log(`启动失败: ${err.stack || err.message}`);
  app.exit(1);
});

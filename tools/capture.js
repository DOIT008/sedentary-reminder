'use strict';

/* 用真实 Engine 造状态，把面板/遮罩在多种阶段和主题下截图到 tools/out/
   npm run capture  —— 有任何 console error 就 exit 1 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');
const { Engine, DEFAULT_CONFIG } = require('../src/main/engine.js');

// 托盘里常驻的那份应用会占住默认 userData 的 Chromium profile 锁，
// 抢不到锁的截图进程会直接静默退出，所以截图跑在临时 profile 里
app.setPath('userData', path.join(os.tmpdir(), 'sedentary-reminder-capture'));

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const MIN = 60000;
const T0 = new Date('2026-10-23T10:12:00').getTime();

fs.mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, 'capture.log');
fs.writeFileSync(logFile, `capture start ${new Date().toISOString()}\n`);
const log = (m) => {
  fs.appendFileSync(logFile, `${m}\n`);
};

process.on('uncaughtException', (err) => {
  log(`UNCAUGHT ${err && err.stack ? err.stack : err}`);
  app.exit(1);
});
process.on('unhandledRejection', (err) => {
  log(`REJECT ${err && err.stack ? err.stack : err}`);
});
app.on('second-instance', () => log('SECOND INSTANCE，profile 被占用'));
app.on('ready', () => log('ready'));
app.on('child-process-gone', (_e, d) => log(`child-gone ${d.type} ${d.reason}`));

function snapshotFor(scenario) {
  const engine = new Engine({
    now: T0 - 3 * 3600 * 1000,
    config: { ...DEFAULT_CONFIG, ...scenario.config },
    onEvent: () => {},
  });
  for (const [day, focusMin] of Object.entries(scenario.seedHistory || {})) {
    engine.stats.history[day] = {
      focusSec: focusMin * 60,
      breaksDone: Math.round(focusMin / 45),
      breaksSkipped: 0,
      snoozes: 1,
      longestFocusSec: 2700,
    };
  }
  const end = T0 + (scenario.atMin || 0) * MIN;
  let idleSec = 0;
  for (let t = T0 - 3 * 3600 * 1000 + 1000; t <= end; t += 1000) {
    idleSec = scenario.idleAt && t > scenario.idleAt && t < scenario.idleEnd ? 600 : 0;
    engine.tick(t, idleSec);
  }
  return engine.snapshot(end, idleSec);
}

const SCENARIOS = {
  // 周期含休息，休息窗口落在 10:27-10:32 / 11:17-11:22，按这个挑时间点
  'panel-focus': { page: 'panel', atMin: 25, theme: 'dark' },
  'panel-soon': { page: 'panel', atMin: 64, theme: 'dark' },
  'panel-break': { page: 'panel', atMin: 17, theme: 'dark' },
  'panel-away': { page: 'panel', atMin: 48, idleAt: T0 + 27 * MIN, idleEnd: T0 + 400 * MIN, theme: 'dark' },
  'panel-light': { page: 'panel', atMin: 25, theme: 'light', config: { theme: 'light' } },
  'panel-charts': { page: 'panel', atMin: 25, theme: 'dark', tall: true, scroll: 9999 },
  // 有 7 天历史时右列必须在默认窗口尺寸内放得下，不用滚动
  'panel-trend': {
    page: 'panel', atMin: 25, theme: 'dark',
    seedHistory: {
      '2026-10-17': 210, '2026-10-18': 305, '2026-10-19': 168,
      '2026-10-20': 352, '2026-10-21': 264, '2026-10-22': 96,
    },
  },
  'panel-custom': { page: 'panel', atMin: 40, theme: 'dark', config: { intervalMin: 90, breakMin: 10, snoozeMin: 8, idleThresholdMin: 6, sound: false, autostart: true, lockPostpone: false } },
  'overlay-early': { page: 'overlay', atMin: 15.2, theme: 'dark' },
  'overlay-break': { page: 'overlay', atMin: 17, theme: 'dark' },
  'overlay-late': { page: 'overlay', atMin: 19.6, theme: 'dark' },
  'overlay-light': { page: 'overlay', atMin: 17, theme: 'light', config: { theme: 'light' } },
  'overlay-done': { page: 'overlay', atMin: 17, theme: 'dark', events: [{ type: 'break-complete', reason: 'countdown' }] },
};

const SIZES = { panel: { width: 920, height: 660 }, overlay: { width: 1440, height: 900 } };

async function shoot(name, scenario) {
  const size = scenario.tall ? { width: 920, height: 1000 } : SIZES[scenario.page];
  const win = new BrowserWindow({
    ...size,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) errors.push(`${source}:${line} ${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`));

  const snapshot = snapshotFor(scenario);
  snapshot.config.theme = scenario.theme;
  const mock = JSON.stringify({ snapshot, events: scenario.events || [] });
  const file = scenario.page === 'panel' ? 'src/renderer/panel/index.html' : 'src/renderer/overlay/index.html';
  await win.loadFile(path.join(ROOT, file), { query: { mock } });
  await new Promise((r) => setTimeout(r, 2200));
  if (scenario.scroll) {
    await win.webContents.executeJavaScript(`document.querySelector('.side').scrollTo({ top: ${scenario.scroll} }); void 0`);
    await new Promise((r) => setTimeout(r, 900));
  }
  // 过渡动画跑到终值（进度环/描边），入场动画取消（终态 = 基础样式），
  // 循环动画钉在一个好看的相位。注意别用 finish() 处理 blur 入场动画，
  // 那会留下降采样的合成层，截图是糊的。
  await win.webContents.executeJavaScript(`
    document.getAnimations().forEach((a) => {
      if (a instanceof CSSTransition) { a.finish(); return; }
      if (a.effect && a.effect.getComputedTiming().iterations === Infinity) { a.currentTime = 4200; a.pause(); }
      else { a.cancel(); }
    });
    void 0
  `);
  // 隐藏窗口的 rAF 不一定触发，所以只等一帧并加超时兜底
  await Promise.race([
    win.webContents.executeJavaScript(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`),
    new Promise((r) => setTimeout(r, 1200)),
  ]);
  await new Promise((r) => setTimeout(r, 400));
  const png = (await win.capturePage()).toPNG();
  const out = path.join(OUT, `${name}.png`);
  fs.writeFileSync(out, png);
  win.destroy();
  return { name, out: path.relative(ROOT, out), bytes: png.length, errors };
}

app.on('window-all-closed', (e) => e.preventDefault());

app.whenReady().then(async () => {
  const results = [];
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    try {
      results.push(await shoot(name, scenario));
    } catch (err) {
      results.push({ name, error: String(err.message || err) });
    }
  }
  const bad = results.filter((r) => r.error || (r.errors && r.errors.length));
  fs.writeFileSync(path.join(OUT, 'capture-report.json'), JSON.stringify(results, null, 2));
  for (const r of results) {
    log(`${r.error ? 'FAIL' : 'OK  '} ${r.name.padEnd(16)} ${r.bytes || 0}B ${r.errors && r.errors.length ? `errors=${r.errors.length}` : ''}`);
    if (r.errors && r.errors.length) log(`     ${r.errors.join('\n     ')}`);
  }
  log(bad.length ? `GATES FAILED (${bad.length})` : 'ALL CAPTURES OK');
  app.exit(bad.length ? 1 : 0);
});

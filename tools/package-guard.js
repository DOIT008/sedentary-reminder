'use strict';

/* 打包产物门禁：真的跑打出来的那种 exe，确认打包后的目录结构没有把应用打死。
   npm run test:package   （会弹出面板窗口约 60 秒，然后自己关掉）

   这里刻意不复用 mock 截图那套：asar 只读、sandbox preload 在 asar 里、
   process.execPath 变成应用自身、userData 来源改变，只有真跑打包 exe 才测得到。 */

const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const { Engine } = require('../src/main/engine.js');
const { Autostart } = require('../src/main/autostart.js');

const ROOT = path.join(__dirname, '..');
const DIST = process.env.SR_DIST || 'E:\\builds\\sedentary-reminder';
const EXE = path.join(DIST, 'win-unpacked', '久坐提醒.exe');
const PORTABLE = path.join(DIST, '久坐提醒-便携版-1.0.0.exe');
const INSTALLER = path.join(DIST, '久坐提醒-安装版-1.0.0.exe');
const RUN = path.join(ROOT, 'tools', 'out', 'package-guard');
const PORT = Number(process.env.SR_GUARD_PORT || 9350);
const USER_DATA = path.join(RUN, 'userData');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const say = (ok, name, detail = '') => {
  checks.push({ ok, name });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

fs.rmSync(RUN, { recursive: true, force: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const now = Date.now();
const engine = new Engine({
  now,
  config: { intervalMin: 30, breakMin: 3, theme: 'light', autostart: false, sound: false, idlePause: false },
  onEvent: () => {},
});
engine.state.cycleStartAt = now - 60000;
engine.state.nextDueAt = now - 60000 + 30 * 60000;
const STATE_FILE = path.join(USER_DATA, 'state.json');
fs.writeFileSync(STATE_FILE, JSON.stringify(engine.serialize(), null, 2));
const SEED_MTIME = fs.statSync(STATE_FILE).mtimeMs;

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.SR_LOG = path.join(RUN, 'app.log');

let child = null;
function launch(exe) {
  child = spawn(exe, [`--user-data-dir=${USER_DATA}`, '--show-panel', `--remote-debugging-port=${PORT}`], {
    cwd: path.dirname(exe), env, stdio: 'ignore',
  });
}
function kill() {
  if (!child) return;
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已经没了 */ }
  child = null;
}
const readLog = () => (fs.existsSync(env.SR_LOG) ? fs.readFileSync(env.SR_LOG, 'utf8') : '');

async function panelTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && /panel\/index\.html/.test(t.url));
      if (page) return page;
    } catch { /* 端口还没起 */ }
    await sleep(500);
  }
  return null;
}

/* ---------------------------------------------------------------- CDP */

let seq = 0;
const pending = new Map();
let ws = null;
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}
async function expr(code) {
  const res = await send('Runtime.evaluate', { expression: `(async()=>{${code}})()`, awaitPromise: true, returnByValue: true });
  const e = res.result || {};
  if (e.exceptionDetails) throw new Error(`页面求值失败：${JSON.stringify(e.exceptionDetails.exception?.description || e.exceptionDetails.text)}`);
  return e.result.value;
}
async function connect(page) {
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  await send('Runtime.enable');
  await sleep(2000);
}
const clock = () => expr(`return document.getElementById('bigClock').textContent;`);
const view = () => expr(`return JSON.stringify({
  clock: document.getElementById('bigClock').textContent,
  pauseText: document.getElementById('pauseText').textContent,
  pauseIcon: document.getElementById('pauseIcon').dataset.icon,
});`).then((s) => JSON.parse(s));
const secs = (t) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };

/** 受信点击：合成 .click() 测不出真实指针路径上的问题 */
async function click(id) {
  const rect = JSON.parse(await expr(`const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
}

/* ---------------------------------------------------------------- 跑 */

(async () => {
  say(fs.existsSync(EXE), '解包目录里有可执行文件', EXE);
  say(fs.existsSync(PORTABLE), '便携版单文件存在', PORTABLE);
  say(fs.existsSync(INSTALLER), '安装版单文件存在', INSTALLER);
  if (!fs.existsSync(EXE)) process.exit(1);

  launch(EXE);
  const page = await panelTarget();
  say(Boolean(page), '打包后面板窗口能加载（asar 内的 loadFile + sandbox preload 通路正常）');
  if (!page) { kill(); process.exit(1); }
  await connect(page);

  const info = JSON.parse(await expr(`return JSON.stringify(await window.sedentary.command('meta'));`));
  say(info.version === '1.0.0', '打包版读到的版本号来自 asar 内的 package.json', String(info.version));
  say(path.resolve(info.userData) === path.resolve(USER_DATA), 'userData 落在传入目录（asar 只读没有把状态指回错误位置）', info.userData);

  const a = await clock();
  await sleep(3000);
  const b = await clock();
  say(a !== b, '打包版面板继续走秒', `${a} → ${b}`);

  const before = await view();
  await click('btnPause');
  await sleep(900);
  const paused = await view();
  say(paused.pauseText === '继续' && paused.pauseIcon === 'play', '点暂停后按钮变成「继续 / play」', `${paused.pauseText} / ${paused.pauseIcon}`);
  await click('btnPause');
  await sleep(900);
  const resumed = await view();
  say(resumed.pauseText === '暂停' && resumed.pauseIcon === 'pause', '再点一次回到「暂停 / pause」', `${resumed.pauseText} / ${resumed.pauseIcon}`);

  await click('btnReset');
  await sleep(900);
  const afterReset = await view();
  say(secs(afterReset.clock) >= 29 * 60 && secs(afterReset.clock) > secs(before.clock), '重置后倒计时回到整圈', `${before.clock} → ${afterReset.clock}`);
  await sleep(2500);
  const still = await view();
  say(secs(still.clock) < secs(afterReset.clock), '重置后继续往下计', `${afterReset.clock} → ${still.clock}`);

  await expr(`window.sedentary.command('hide-panel');return 1;`);
  await sleep(5000);
  const h1 = await clock();
  await sleep(3500);
  const h2 = await clock();
  say(h1 !== h2, '收进托盘后仍然走秒', `${h1} → ${h2}`);

  ws.close();
  kill();

  const text = readLog();
  say(/就绪/.test(text), '打包版主进程日志出现「就绪」');
  say(!/\[icons\].*生成失败/.test(text), 'asar 只读目录下图标没有触发就地补写', (text.match(/\[icons\].*/g) || []).join(' | ') || '无');
  const badLines = text.split('\n').filter((l) => /Error:|UNCAUGHT|TypeError/.test(l));
  say(badLines.length === 0, '主进程日志没有异常', badLines.join(' | ').slice(0, 200) || '无');

  const saved = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : null;
  say(Boolean(saved) && fs.statSync(STATE_FILE).mtimeMs > SEED_MTIME, '状态回写到 userData（持久化正常）',
    saved && `phase=${saved.state?.phase} todayKey=${saved.stats?.todayKey} savedAt=${new Date(saved.savedAt).toLocaleTimeString()}`);

  /* ------------------------------------------- 开机自启：打包后必须直指 exe */
  const linkInfo = await new Autostart({ startupDir: path.join(RUN, 'startup'), userDataDir: path.join(RUN, 'linkdata') }).enable(EXE, null);
  // PowerShell 5.1 默认按 936 输出，中文 exe 名会花掉，先让它吐 UTF-8
  const ps = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${linkInfo.lnk.replace(/'/g, "''")}')`,
    '$s.TargetPath + "|" + $s.Arguments',
  ].join('; ');
  const link = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8' }).trim();
  say(link.startsWith(EXE) && !/wscript/i.test(link), '打包后开机自启快捷方式直指 exe（不再套一层 vbs）', link);

  /* ------------------------------------------- 便携版：单文件也要能起 */
  await sleep(1500); // 等上一个实例把 Chromium profile 锁释放干净
  fs.writeFileSync(env.SR_LOG, '');
  launch(PORTABLE);
  const portablePage = await panelTarget();
  say(Boolean(portablePage), '便携版单文件 exe 能起面板');
  if (portablePage) {
    await connect(portablePage);
    const p1 = await clock();
    await sleep(3000);
    const p2 = await clock();
    say(p1 !== p2, '便携版面板走秒', `${p1} → ${p2}`);
    ws.close();
  }
  kill();
  say(/就绪/.test(readLog()), '便携版主进程日志出现「就绪」');

  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `\nPACKAGE GUARD FAILED (${checks.length - failed.length}/${checks.length})` : `\nPACKAGE GUARD PASSED (${checks.length}/${checks.length})`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('门禁自身出错:', err.message);
  kill();
  process.exit(1);
});

'use strict';

/* 冻结门禁：面板最小化/收进托盘之后，渲染进程还必须继续走秒。
   Chromium 会把隐藏页面降速，Windows 无边框窗口上解冻并不可靠，
   实测过「引擎在跑、界面停在最后一帧」——所以这条要能真的失败。

   node tools/freeze-guard.js   （会弹一个面板窗口约 40 秒，然后自己关掉） */

const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const { Engine } = require('../src/main/engine.js');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = path.join(ROOT, 'tools', 'out', 'freeze-guard');
const PORT = Number(process.env.SR_GUARD_PORT || 9345);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const say = (ok, name, detail = '') => {
  checks.push({ ok, name });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

fs.rmSync(RUN, { recursive: true, force: true });
fs.mkdirSync(RUN, { recursive: true });

const now = Date.now();
const engine = new Engine({
  now,
  config: { intervalMin: 30, breakMin: 3, theme: 'light', autostart: false, sound: false, idlePause: false },
  onEvent: () => {},
});
engine.state.cycleStartAt = now - 90000;
engine.state.nextDueAt = now - 90000 + 30 * 60000;
fs.writeFileSync(path.join(RUN, 'state.json'), JSON.stringify(engine.serialize(), null, 2));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.SR_LOG = path.join(RUN, 'app.log');
const child = spawn(EXE, ['.', `--user-data-dir=${RUN}`, '--show-panel', `--remote-debugging-port=${PORT}`], {
  cwd: ROOT, env, stdio: 'ignore',
});

function kill() {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已经没了 */ }
}

async function panelTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && /panel\/index\.html/.test(t.url));
      if (page) return page;
    } catch (e) { /* 端口还没起 */ }
    await sleep(500);
  }
  return null;
}

let seq = 0;
const pending = new Map();
let ws;
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
const clock = () => expr(`return document.getElementById('bigClock').textContent;`);

/** 等 N 毫秒，看这段时间里秒数有没有自己走过 */
async function ticking(label, ms) {
  const a = await clock();
  await sleep(ms);
  const b = await clock();
  const moved = a !== b;
  say(moved, `${label}：隐藏 ${ms / 1000} 秒后秒数仍在走`, `${a} → ${b}`);
  return moved;
}

(async () => {
  const page = await panelTarget();
  if (!page) { say(false, '找到面板窗口'); kill(); process.exit(1); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  await send('Runtime.enable');
  await sleep(2500);

  await ticking('前台', 3000);

  await expr(`window.sedentary.command('minimize');return 1;`);
  await sleep(6000);
  await ticking('最小化', 4000);
  await expr(`window.sedentary.command('show-panel');return 1;`);
  await sleep(2000);

  await expr(`window.sedentary.command('hide-panel');return 1;`);
  await sleep(6000);
  await ticking('收进托盘', 4000);

  const log = fs.readFileSync(path.join(RUN, 'app.log'), 'utf8');
  say(/就绪/.test(log), '应用正常启动（没有崩溃）');

  ws.close();
  kill();
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length ? `\nFREEZE GUARD FAILED (${checks.length - failed.length}/${checks.length})` : `\nFREEZE GUARD PASSED (${checks.length}/${checks.length})`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('门禁自身出错:', err.message);
  kill();
  process.exit(1);
});

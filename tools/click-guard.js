'use strict';

/* 真点击门禁：起真应用，用 CDP 的鼠标事件（和用户手点同一条路径）点面板按钮，
   断言引擎真的换档、界面真的跟着换。之前只用合成快照量过 DOM，漏掉了
   「点了没反应」这一整类缺陷。

   node tools/click-guard.js  （会弹一个面板窗口约 30 秒，然后自己关掉） */

const path = require('node:path');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const { Engine } = require('../src/main/engine.js');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = path.join(ROOT, 'tools', 'out', 'click-guard');
const PORT = Number(process.env.SR_CLICK_PORT || 9346);
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
const kill = () => { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ } };

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
/** 真鼠标：按下 + 抬起，走 Chromium 的命中测试，和手点一致 */
async function click(id) {
  const box = await expr(`const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: 0 });
}
const view = () => expr(`return {
  phase: document.body.dataset.phase,
  clock: document.getElementById('bigClock').textContent,
  pauseText: document.getElementById('pauseText').textContent,
  pauseIcon: document.getElementById('pauseIcon').dataset.icon,
  label: document.getElementById('phaseLabel').textContent,
  toast: document.getElementById('toast').classList.contains('is-show'),
};`);
const secs = (t) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
const events = () => (fs.readFileSync(path.join(RUN, 'app.log'), 'utf8').match(/event /g) || []).length;

(async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && /panel\/index\.html/.test(t.url));
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        ws.addEventListener('message', (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
        });
        await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
        break;
      }
    } catch (e) { /* 还没起来 */ }
    await sleep(500);
  }
  if (!ws) { say(false, '找到面板窗口'); kill(); process.exit(1); }
  await send('Runtime.enable');
  await sleep(2500);

  const a = await view();
  say(a.phase === 'focus' && a.pauseText === '暂停' && a.pauseIcon === 'pause', '起始：专注态显示「暂停」+ pause 图标', JSON.stringify(a));

  await click('btnPause');
  await sleep(1500);
  const b = await view();
  say(b.phase === 'paused' && b.pauseText === '继续' && b.pauseIcon === 'play' && b.label === '已暂停', '真鼠标点「暂停」→ 图标文字都换成继续', JSON.stringify(b));
  say(b.toast, '点完有 toast 回执', '');

  await click('btnPause');
  await sleep(1500);
  const c = await view();
  say(c.phase === 'focus' && c.pauseText === '暂停' && c.pauseIcon === 'pause', '再点一次 → 回到暂停按钮', JSON.stringify(c));

  const before = secs(c.clock);
  await click('btnReset');
  await sleep(1500);
  const d = await view();
  say(secs(d.clock) >= 29 * 60 && secs(d.clock) > before, '点「重置」→ 倒计时回到满周期', `${c.clock} → ${d.clock}`);
  await sleep(3000);
  const e = await view();
  say(secs(e.clock) < secs(d.clock), '重置后数字继续往下走', `${d.clock} → ${e.clock}`);

  say(events() >= 3, '引擎确实收到了这几次命令', `app.log 里 event 数 = ${events()}`);

  ws.close();
  kill();
  const failed = checks.filter((x) => !x.ok);
  console.log(failed.length ? `\nCLICK GUARD FAILED (${checks.length - failed.length}/${checks.length})` : `\nCLICK GUARD PASSED (${checks.length}/${checks.length})`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('门禁自身出错:', err.message);
  kill();
  process.exit(1);
});

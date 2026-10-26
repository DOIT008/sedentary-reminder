'use strict';

/* 跨天启动门禁：拿一份「昨天」的存档启动真实应用，验证
   1) 进程能起来（构造期事件不能把宿主打崩）
   2) 昨天归档进 history、今天从零开始
   3) 落盘一次到位，不会每次启动重演补档
   node tools/day-rollover-test.cjs —— 任一断言失败 exit 1 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { Engine } = require('../src/main/engine.js');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(ROOT, 'tools', 'out', 'daytest');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const LOG = path.join(RUN, 'app.log');
const DAY_MS = 24 * 60 * 60 * 1000;

const checks = [];
function say(ok, name, detail) {
  checks.push({ ok: Boolean(ok), name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seedYesterday() {
  fs.rmSync(RUN, { recursive: true, force: true });
  fs.mkdirSync(RUN, { recursive: true });
  const y = Date.now() - DAY_MS;
  const engine = new Engine({ now: y, saved: null, onEvent: () => {} });
  engine.applyConfig({ intervalMin: 45, breakMin: 5 });
  for (let t = y; t < y + 40 * 60000; t += 1000) engine.tick(t, 0);
  const saved = engine.serialize();
  fs.writeFileSync(path.join(RUN, 'state.json'), JSON.stringify(saved, null, 2));
  return { yesterdayKey: dayKey(y), focusSec: saved.stats.today.focusSec };
}

function killTree(pid) {
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
}

async function waitFor(pattern, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    let text = '';
    try { text = fs.readFileSync(LOG, 'utf8'); } catch { /* 还没建 */ }
    const hit = text.match(pattern);
    if (hit) return { line: hit[0].trim(), text };
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

function finish() {
  const bad = checks.filter((c) => !c.ok);
  console.log(bad.length ? `\nDAY ROLLOVER FAILED (${bad.length}/${checks.length})` : `\nDAY ROLLOVER PASSED (${checks.length}/${checks.length})`);
  process.exit(bad.length ? 1 : 0);
}

async function main() {
  if (!fs.existsSync(EXE)) {
    say(false, '找到 Electron', EXE);
    return finish();
  }
  const seed = seedYesterday();
  const env = { ...process.env, SR_LOG: LOG };
  delete env.ELECTRON_RUN_AS_NODE; // Qoder 进程树会带着它，会把 Electron 降级成纯 Node
  const child = spawn(EXE, [`--user-data-dir=${RUN}`, ROOT], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'ignore'] });

  try {
    const ready = await waitFor(/就绪/, 30000);
    say(Boolean(ready), '跨天后应用仍能正常启动', ready ? ready.line : '30s 内没看到「就绪」');
    // 崩在构造期时进程会自己退出，这时才认定失败，避免和正常的跨天日志撞车
    await new Promise((r) => setTimeout(r, 600));
    const dead = child.exitCode !== null;
    const crash = dead ? { line: `exit=${child.exitCode}` } : null;
    say(!dead, '构造期事件没有打崩宿主', crash ? crash.line : '进程存活');
    const rollover = await waitFor(/event day-rollover/, 1000);
    say(Boolean(rollover), '补档事件按预期发出', rollover ? rollover.line : '没发出 day-rollover');

    await new Promise((r) => setTimeout(r, 1200)); // 等 store 的 800ms 防抖落盘
    const saved = JSON.parse(fs.readFileSync(path.join(RUN, 'state.json'), 'utf8'));
    say(saved.stats.todayKey === dayKey(Date.now()), '今天已切到新的一天', `todayKey=${saved.stats.todayKey}`);
    const archived = saved.stats.history[seed.yesterdayKey];
    say(archived && Math.round(archived.focusSec) === Math.round(seed.focusSec),
      '昨天的久坐数据归档而不是被丢弃', `${seed.yesterdayKey}: ${archived && archived.focusSec}s（补档前 ${Math.round(seed.focusSec)}s）`);
    say(saved.stats.today.focusSec < 60, '今天从零开始计', `focusSec=${Math.round(saved.stats.today.focusSec)}`);
  } finally {
    killTree(child.pid);
  }
  finish();
}

main().catch((err) => {
  say(false, '门禁脚本自身没炸', String(err.stack || err));
  finish();
});

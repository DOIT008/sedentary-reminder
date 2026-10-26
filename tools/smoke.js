'use strict';

/* 真机冒烟：用隔离的 userData 启动真正的 Electron 应用，
   让引擎自然到点弹遮罩，再用 Win32 量它有没有盖住任务栏。
   node tools/smoke.js  —— 期间屏幕会被全屏遮罩盖住约 1 分钟 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { Engine } = require('../src/main/engine.js');
const { Autostart, LNK_NAME, startupFolder } = require('../src/main/autostart.js');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RUN = path.join(ROOT, 'tools', 'out', 'smoke', STAMP);
const STATE_FILE = path.join(RUN, 'state.json');
const APP_LOG = path.join(RUN, 'app.log');
const DUE_IN_MS = 18000;

fs.mkdirSync(RUN, { recursive: true });
const checks = [];
const say = (ok, name, detail = '') => {
  checks.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(re, timeoutMs, file) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const hit = text.match(re);
    if (hit) return hit[0];
    await sleep(300);
  }
  return null;
}

/* 用真引擎造一份“18 秒后自然到点”的存档。
   idlePause 保持开启：这样测试期间要靠 smoke-nudge.ps1 真的动光标，
   否则整台机器闲置几千秒，计时一开始就被冻住，弹不出遮罩。 */
function seedState() {
  const now = Date.now();
  const engine = new Engine({
    now,
    config: { intervalMin: 15, breakMin: 1, prewarnSec: 8, idlePause: true, sound: true, autostart: false },
    onEvent: () => {},
  });
  engine.state.cycleStartAt = now - (15 * 60000 - DUE_IN_MS);
  engine.state.nextDueAt = now + DUE_IN_MS;
  fs.writeFileSync(STATE_FILE, JSON.stringify(engine.serialize(), null, 2));
  return engine;
}

function probeGeometry(pid) {
  const res = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(ROOT, 'tools', 'smoke-geometry.ps1'), '-TargetPid', String(pid),
  ], { encoding: 'utf8', timeout: 30000 });
  if (res.status !== 0 || !res.stdout) {
    return { error: `powershell exit=${res.status} ${(res.stderr || '').slice(0, 400)}` };
  }
  try {
    return JSON.parse(res.stdout.trim().split('\n').pop());
  } catch (err) {
    return { error: `解析失败 ${err.message}: ${res.stdout.slice(0, 300)}` };
  }
}

function killTree(pid) {
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
}

async function main() {
  if (!fs.existsSync(EXE)) {
    say(false, '找到 Electron', EXE);
    return finish();
  }
  seedState();
  const lnk = path.join(startupFolder(), LNK_NAME);
  const lnkBefore = fs.existsSync(lnk); // 你可能早就在面板里开了自启，这里只要求这次运行不改它

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // Qoder 的进程树会带着它，会把 Electron 降级成纯 Node
  env.SR_LOG = APP_LOG;
  env.ELECTRON_ENABLE_LOGGING = '1';

  const child = spawn(EXE, [`--user-data-dir=${RUN}`, ROOT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const nudge = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(ROOT, 'tools', 'smoke-nudge.ps1'), '-Seconds', '90',
  ], { stdio: 'ignore', windowsHide: true });
  const stopNudge = () => { try { nudge.kill(); } catch { /* 已经自己退了 */ } };
  let stderr = '';
  child.stdout.on('data', (b) => { process.stdout.write(`[app] ${b}`); });
  child.stderr.on('data', (b) => { stderr += b.toString(); process.stdout.write(`[app!] ${b}`); });

  const ready = await waitFor(/^.*就绪.*$/m, 30000, APP_LOG);
  say(Boolean(ready), '主进程启动并建好托盘', ready ? ready.trim() : '30s 内没看到「就绪」');
  const seen = (ready || '').match(/userData=(.*)$/);
  const got = seen ? path.normalize(seen[1].trim()).toLowerCase() : '';
  say(got === path.normalize(RUN).toLowerCase(), '跑在隔离的 userData 下，不碰你真实的设置和统计', `应用报告 userData=${seen ? seen[1].trim() : '?'}`);

  const overlay = await waitFor(/弹出遮罩/, DUE_IN_MS + 20000, APP_LOG);
  say(Boolean(overlay), '计时到点自动弹出全屏遮罩', overlay || '引擎没在预期时间弹遮罩');
  stopNudge(); // 从这一刻起算「人离开键盘」，用来验休息会不会被提前判完成

  if (overlay) {
    const geo = probeGeometry(child.pid);
    fs.writeFileSync(path.join(RUN, 'geometry.json'), JSON.stringify(geo, null, 2));
    if (geo.error) {
      say(false, 'Win32 几何探针跑通', geo.error);
    } else {
      const full = geo.coversWholeScreen || [];
      say(full.length > 0, '存在铺满整块物理屏幕的窗口（含任务栏那条）',
        JSON.stringify(full.map((w) => ({ cls: w.class, rect: [w.left, w.top, w.right, w.bottom], screen: `${geo.screen.w}x${geo.screen.h}` }))));
      say(geo.hitOnOurs === true && geo.hitOnTaskbar === false, '遮罩压在任务栏正中之上，任务栏点不到了',
        `命中=${geo.hitClass}(pid ${geo.hitPid}) 命中任务栏=${geo.hitOnTaskbar} 命中自己=${geo.hitOnOurs}`);
    }
  }

  await sleep(1500);
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  say(saved.config.intervalMin === 15 && saved.config.breakMin === 1, '配置按隔离存档载入', `interval=${saved.config.intervalMin} break=${saved.config.breakMin}`);
  say(saved.stats.today.focusSec > 0, '真实 tick 在累计久坐', `focusSec=${saved.stats.today.focusSec}`);
  say(saved.state.lastBreakAt > 0 || saved.state.phase === 'break', '休息事件已落盘', `phase=${saved.state.phase}`);

  /* 回归：休息设 1 分钟时，遮罩挂着、人不碰键鼠，也不能在 25 秒被「已起身」提前收尾。
     在计划结束点前 6 秒取样，太早测不出来、太晚会撞上正常收尾。 */
  const breakEndAt = saved.state.breakEndAt || Date.now() + 60000;
  await sleep(Math.max(0, breakEndAt - Date.now() - 6000));
  const mid = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  // 有人在真机上点了「跳过」会让这两条前提不成立（测试跑的是你正在用的那块屏）
  const skipped = mid.stats.today.breaksSkipped > saved.stats.today.breaksSkipped;
  const leftSec = mid.state.breakEndAt ? Math.round((mid.state.breakEndAt - Date.now()) / 1000) : null;
  say(mid.state.phase === 'break' && leftSec > 0, '闲置满 30 秒，1 分钟的休息依然没被提前结束',
    skipped ? '前提不成立：休息被点了「跳过」，请等这一轮跑完别碰遮罩' : `phase=${mid.state.phase} 剩余=${leftSec === null ? '已结束' : `${leftSec}s`}`);
  await sleep(9000);
  const reason = (fs.readFileSync(APP_LOG, 'utf8').match(/event break-complete \((\w+)\)/) || [])[1];
  say(reason === 'countdown', '最终按倒计时收尾，不是 away', skipped ? `同上，收尾 reason=${reason || '无'}` : `reason=${reason}`);

  say(fs.existsSync(lnk) === lnkBefore, '这次运行没有动开机自启', lnkBefore ? '启动文件夹里已有你自己开启的快捷方式，保持原样' : '启动文件夹里没有快捷方式');
  say(new Autostart({ userDataDir: RUN }).lnk === lnk, 'Autostart 指向当前用户的启动文件夹', lnk);

  const noise = stderr.match(/uncaught|referenceerror|typeerror|did-fail-load|refused to|security warning/i);
  say(!noise, '渲染进程零报错/零 CSP 违规', noise ? stderr.slice(Math.max(0, stderr.indexOf(noise[0]) - 120)).slice(0, 500) : '');

  killTree(child.pid);
  await sleep(1200);
  return finish();
}

function finish() {
  const bad = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(RUN, 'smoke-report.json'), JSON.stringify({ checks, at: STAMP }, null, 2));
  console.log(bad.length ? `\nSMOKE FAILED (${bad.length}/${checks.length})  详见 ${RUN}` : `\nSMOKE PASSED (${checks.length}/${checks.length})`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => {
  say(false, '冒烟脚本自身没炸', String(err.stack || err));
  finish();
});

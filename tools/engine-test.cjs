'use strict';

/* eslint-disable no-console */
const { Engine, PHASE, DEFAULT_CONFIG } = require('../src/main/engine.js');

let failures = 0;
let checks = 0;

function check(name, cond, detail = '') {
  checks += 1;
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const MIN = 60000;

function scenario(config = {}, startHour = 9) {
  const t0 = new Date(`2026-10-23T0${startHour}:00:00`).getTime();
  const events = [];
  const engine = new Engine({ now: t0, config: { ...DEFAULT_CONFIG, ...config }, onEvent: (e) => events.push(e) });
  return {
    t0,
    engine,
    events,
    /** 以 1s 步进推进虚拟时钟；idleSecFn 可按绝对时间返回系统闲置秒数 */
    advance(ms, idleSecFn = () => 0, opts) {
      const from = engine.lastTickAt;
      for (let t = from + 1000; t <= from + ms; t += 1000) engine.tick(t, idleSecFn(t), opts);
      return engine.lastTickAt;
    },
    types: () => events.map((e) => e.type),
    find: (type) => events.find((e) => e.type === type),
    count: (type) => events.filter((e) => e.type === type).length,
    breakDurationSec: () => Math.round((engine.state.breakEndAt - engine.state.breakStartAt) / 1000),
  };
}

console.log('\n[1] 满 45 分钟触发休息');
{
  const s = scenario();
  s.advance(44 * MIN);
  check('44 分钟仍在专注', s.engine.state.phase === PHASE.FOCUS, s.engine.state.phase);
  check('剩余时间约 60s', Math.abs(s.engine.snapshot().focusRemainingSec - 60) <= 1);
  check('prewarn 恰好一次', s.count('prewarn') === 1, String(s.count('prewarn')));
  s.advance(1 * MIN + 1000);
  check('触发 break-start', s.count('break-start') === 1, s.types().join(','));
  check('进入 break 阶段', s.engine.state.phase === PHASE.BREAK, s.engine.state.phase);
  check('休息时长 = 5 分钟', s.breakDurationSec() === 300, String(s.breakDurationSec()));
}

console.log('\n[2] 自定义间隔 90 分钟 / 休息 10 分钟生效');
{
  const s = scenario({ intervalMin: 90, breakMin: 10 });
  s.advance(46 * MIN);
  check('46 分钟不触发', s.engine.state.phase === PHASE.FOCUS && s.count('break-start') === 0);
  s.advance(44 * MIN + 1000);
  check('90 分钟到点触发', s.count('break-start') === 1 && s.engine.state.phase === PHASE.BREAK);
  check('休息时长 = 10 分钟', s.breakDurationSec() === 600, String(s.breakDurationSec()));
}

console.log('\n[3] 闲置冻结:离开约 30 分钟回来,提醒顺延而不是立刻弹');
{
  const s = scenario({ idleThresholdMin: 3 });
  s.advance(20 * MIN);
  const dueBefore = s.engine.state.nextDueAt;
  const sittingBefore = s.engine.stats.today.focusSec;
  s.advance(31 * MIN, () => 240); // 系统闲置 4 分钟 > 阈值 3 分钟
  check('冻结为 idle 阶段', s.engine.state.phase === PHASE.IDLE && s.engine.freeze.reason === 'idle', `${s.engine.state.phase}/${s.engine.freeze.reason}`);
  check('冻结期间不累计久坐', s.engine.stats.today.focusSec === sittingBefore, `${s.engine.stats.today.focusSec - sittingBefore}s`);
  check('冻结期间不弹提醒', s.count('break-start') === 0);
  const remAtFreeze = s.engine.snapshot().focusRemainingSec;
  check('冻结期间界面仍显示离开时刻的剩余', Math.abs(remAtFreeze - 25 * 60) <= 3, `${remAtFreeze}s`);
  s.advance(1000, () => 0); // 回来了
  check('回来后恢复 focus', s.engine.state.phase === PHASE.FOCUS, s.engine.state.phase);
  const shiftedMin = (s.engine.state.nextDueAt - dueBefore) / MIN;
  check('到期时间顺延约 30 分钟', shiftedMin > 28.5 && shiftedMin < 31.5, `${shiftedMin.toFixed(1)}min`);
  check('回来后剩余时间和冻结时刻一致(不补罚)', Math.abs(s.engine.snapshot().focusRemainingSec - remAtFreeze) <= 2, `${s.engine.snapshot().focusRemainingSec}s vs ${remAtFreeze}s`);
}

console.log('\n[4] 锁屏/睡眠:期间不计时,回来顺延一个完整周期');
{
  const s = scenario();
  s.advance(40 * MIN);
  const sittingBefore = s.engine.stats.today.focusSec;
  s.engine.freezeForLock(s.engine.lastTickAt);
  check('锁屏后冻结', s.engine.state.phase === PHASE.IDLE && s.engine.freeze.reason === 'lock', `${s.engine.state.phase}/${s.engine.freeze.reason}`);
  s.advance(50 * MIN, () => 3000); // 锁着的时候一直没有输入
  check('锁屏 50 分钟内不弹提醒', s.count('break-start') === 0 && s.engine.state.phase === PHASE.IDLE, s.engine.state.phase);
  check('锁屏期间不累计久坐', s.engine.stats.today.focusSec === sittingBefore);
  s.advance(1000, () => 0); // 解锁并动了动鼠标
  check('解锁后不立刻弹', s.count('break-start') === 0 && s.engine.state.phase === PHASE.FOCUS, s.types().join(','));
  const remaining = s.engine.snapshot().focusRemainingSec;
  check('解锁后重新计满 45 分钟', Math.abs(remaining - 2700) <= 2, `${remaining}s`);
}

console.log('\n[5] 锁屏时正在休息 => 判定为已完成起身');
{
  const s = scenario();
  s.advance(46 * MIN);
  check('已进入休息', s.engine.state.phase === PHASE.BREAK);
  s.engine.freezeForLock(s.engine.lastTickAt);
  check('锁屏自动收尾并计为完成', s.count('break-complete') === 1 && s.engine.stats.today.breaksDone === 1);
  check('收尾后退出 break 阶段', s.engine.state.phase !== PHASE.BREAK, s.engine.state.phase);
  check('锁屏后重新计时,不会一解锁就弹', s.engine.state.phase === PHASE.IDLE && s.engine.freeze.reason === 'lock', `${s.engine.state.phase}/${s.engine.freeze.reason}`);
}

console.log('\n[6] 稍后 / 跳过 / 倒计时自然完成');
{
  const s = scenario();
  s.advance(46 * MIN);
  s.engine.snooze(s.engine.lastTickAt);
  check('稍后 5 分钟', s.engine.state.phase === PHASE.FOCUS && Math.abs(s.engine.snapshot().focusRemainingSec - 300) <= 1, String(s.engine.snapshot().focusRemainingSec));
  check('稍后计入 snoozes', s.engine.stats.today.snoozes === 1);
  s.advance(6 * MIN);
  check('稍后到点再次提醒', s.count('break-start') === 2, s.types().join(','));
  s.engine.skip(s.engine.lastTickAt);
  check('跳过计入 skips 并回到完整周期', s.engine.stats.today.breaksSkipped === 1 && s.engine.state.phase === PHASE.FOCUS);
  check('跳过后的周期是完整 45 分钟', Math.abs(s.engine.snapshot().focusRemainingSec - 2700) <= 1);
  s.advance(46 * MIN);
  s.advance(5 * MIN + 1000);
  check('倒计时结束自动完成', s.engine.stats.today.breaksDone === 1, JSON.stringify(s.engine.statsView()));
}

console.log('\n[7] 长休息中离开键盘 => 视为已起身,自动完成');
{
  const s = scenario();
  s.advance(s.engine.intervalMs() + 1000);
  check('刚进入休息', s.engine.state.phase === PHASE.BREAK, s.types().join(','));
  s.advance(110 * 1000, () => 40);
  check('休息不满 2 分钟不提前收尾', s.engine.state.phase === PHASE.BREAK, s.types().join(','));
  s.advance(20 * 1000, () => 40);
  check('满 2 分钟后离开 40s 自动完成', s.engine.stats.today.breaksDone === 1 && s.engine.state.phase === PHASE.FOCUS, s.types().join(','));
  check('完成原因 = away', (s.find('break-complete') || {}).reason === 'away', JSON.stringify(s.find('break-complete')));
}

console.log('\n[7b] 遮罩正盖在屏幕上 => 闲置不算离开，设多久就多久');
{
  const s = scenario({ breakMin: 5 });
  s.advance(s.engine.intervalMs() + 1000);
  check('已进入休息', s.engine.state.phase === PHASE.BREAK);
  s.advance(200 * 1000, () => 300, { overlayShowing: true });
  check('遮罩下闲置 200s 仍在休息', s.engine.state.phase === PHASE.BREAK, s.types().join(','));
  s.advance(105 * 1000, () => 300, { overlayShowing: true });
  const done = s.find('break-complete');
  check('走满 5 分钟才完成，原因是倒计时', done && done.reason === 'countdown' && s.engine.stats.today.breaksDone === 1, JSON.stringify(done));
}

console.log('\n[7c] 没开遮罩的 1 分钟短休息，同样不被闲置截断');
{
  const s = scenario({ breakMin: 1 });
  s.advance(s.engine.intervalMs() + 1000);
  check('1 分钟休息已开始', s.engine.state.phase === PHASE.BREAK);
  s.advance(55 * 1000, () => 300);
  check('短休息不会因为手不动就提前结束', s.engine.state.phase === PHASE.BREAK, s.types().join(','));
  s.advance(10 * 1000, () => 300);
  check('到点用倒计时收尾', ((s.find('break-complete') || {}).reason) === 'countdown', JSON.stringify(s.find('break-complete')));
}

console.log('\n[8] 关闭期间错过很久 => 重启不补罚');
{
  /* 必须像真进程那样 1s 步进走到休息中：单次 tick 跳 46 分钟会被「休眠检测」
     判成整机睡眠，直接顺延，测不到休息中存档这条路。 */
  const s = scenario();
  s.advance(46 * MIN);
  check('原进程内已触发休息', s.engine.state.phase === PHASE.BREAK, s.engine.state.phase);
  const dump = s.engine.serialize();
  const revived = new Engine({ now: s.t0 + 46 * MIN + 3 * 60 * MIN, saved: dump, onEvent: () => {} });
  check('重启后不立刻弹', revived.state.phase === PHASE.FOCUS, revived.state.phase);
  check('重启后顺延整周期', Math.abs(revived.snapshot().focusRemainingSec - 2700) <= 2, String(revived.snapshot().focusRemainingSec));
}

console.log('\n[9] 只错过 60 秒 => 重启后仍然提醒');
{
  const s = scenario();
  s.advance(46 * MIN);
  const dump = s.engine.serialize();
  const revived = new Engine({ now: s.t0 + 46 * MIN + 60 * 1000, saved: dump, onEvent: () => {} });
  check('短时错过补回休息', revived.state.phase === PHASE.BREAK, revived.state.phase);
  /* 休息是按 breakEndAt 这个墙上时间点收的：存档时已坐 60s，停机又 60s，
     重启后剩 300-120=180 才对，不能因为重启就把已休息的时间抹掉。 */
  const revivedAt = s.t0 + 46 * MIN + 60 * 1000;
  const want = Math.round((s.engine.state.breakEndAt - revivedAt) / 1000);
  const rem = revived.snapshot().breakRemainingSec;
  check('剩余时间按重启时刻收敛', rem === want && want === 180, `${rem} vs ${want}`);
}

console.log('\n[10] 手动暂停保留进度,恢复后继续');
{
  const s = scenario();
  s.advance(30 * MIN);
  s.engine.pause(s.engine.lastTickAt);
  check('暂停中', s.engine.state.phase === PHASE.PAUSED);
  const remAtPause = s.engine.snapshot().focusRemainingSec;
  const satAtPause = s.engine.stats.today.focusSec;
  s.advance(10 * MIN);
  check('暂停期间界面上的倒计时数字不再走', s.engine.snapshot().focusRemainingSec === remAtPause, `${s.engine.snapshot().focusRemainingSec} vs ${remAtPause}`);
  check('暂停期间不累计久坐', s.engine.stats.today.focusSec === satAtPause, `${s.engine.stats.today.focusSec} vs ${satAtPause}`);
  s.advance(50 * MIN);
  check('暂停 1 小时不弹提醒', s.count('break-start') === 0);
  const dump = JSON.parse(JSON.stringify(s.engine.serialize()));
  const revived = new Engine({ now: s.engine.lastTickAt + MIN, saved: dump, onEvent: () => {} });
  check('重启后仍是暂停态', revived.state.phase === PHASE.PAUSED, revived.state.phase);
  revived.resume(revived.lastTickAt);
  check('恢复后剩余约 15 分钟', Math.abs(revived.snapshot().focusRemainingSec - 900) <= 2, String(revived.snapshot().focusRemainingSec));
}

console.log('\n[11] 运行中改间隔 => 按已消耗比例保留,不会刚改完就弹');
{
  const s = scenario({ intervalMin: 45 });
  s.advance(15 * MIN);
  s.engine.applyConfig({ intervalMin: 90 });
  const rem = s.engine.snapshot().focusRemainingSec;
  check('15/45 改成 90 后剩余 60 分钟', Math.abs(rem - 3600) <= 2, `${rem}s`);
  s.advance(10 * MIN);
  check('继续不触发', s.count('break-start') === 0);
}

console.log('\n[12] 跨天归档与历史截断');
{
  const t0 = new Date('2026-10-23T23:00:00').getTime();
  const events = [];
  const e = new Engine({ now: t0, config: { ...DEFAULT_CONFIG, intervalMin: 15 }, onEvent: (x) => events.push(x) });
  for (let d = 0; d < 20; d += 1) {
    const base = t0 + d * 86400000;
    e.tick(base + 10 * MIN, 0);
    e.tick(base + 25 * 3600 * 1000, 0);
  }
  const view = e.statsView();
  check('跨天后今日重新计数', view.sittingMin < 60 * 24, JSON.stringify(view.sittingMin));
  check('历史最多 14 天', Object.keys(e.stats.history).length <= 14, String(Object.keys(e.stats.history).length));
  check('周视图含今日共 7 条', view.week.length === 7, String(view.week.length));
  check('小时分布 24 格', view.hourly.length === 24);
  check('发生过夜滚动', events.filter((x) => x.type === 'day-rollover').length >= 19, String(events.filter((x) => x.type === 'day-rollover').length));
}

console.log('\n[13] 序列化可往返,配置钳制在合法范围');
{
  const s = scenario();
  s.advance(10 * MIN);
  const dump = JSON.parse(JSON.stringify(s.engine.serialize()));
  const back = new Engine({ now: s.engine.lastTickAt, saved: dump, onEvent: () => {} });
  check('往返后剩余时间一致', Math.abs(back.snapshot().focusRemainingSec - s.engine.snapshot().focusRemainingSec) <= 1);
  check('往返后久坐统计保留', back.statsView().sittingMin === s.engine.statsView().sittingMin, `${back.statsView().sittingMin}/${s.engine.statsView().sittingMin}`);
  back.applyConfig({ intervalMin: 1, breakMin: 999, snoozeMin: -5 });
  check('间隔钳制到 >=15', back.config.intervalMin === 15, String(back.config.intervalMin));
  check('休息钳制到 <=30', back.config.breakMin === 30, String(back.config.breakMin));
  check('稍后钳制到 >=1', back.config.snoozeMin === 1, String(back.config.snoozeMin));
}

console.log(`\n${failures === 0 ? 'ALL GATES PASSED' : 'GATES FAILED'} — ${checks - failures}/${checks} checks`);
process.exit(failures === 0 ? 0 : 1);

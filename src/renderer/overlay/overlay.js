(function () {
  'use strict';

  const api = window.sedentary;
  const F = window.SFmt;
  const ICONS = window.SIcon;
  const meta = api.meta || {};
  const isPrimary = meta.primary !== false;

  const RING_R = 118;
  const RING_C = 2 * Math.PI * RING_R;
  const TIP_SECONDS = 12;

  const TIPS = [
    '站起来，双脚踩实地面，把重心前后挪一挪',
    '双手抱头，肘部打开，胸椎向后伸展',
    '肩胛骨下沉后收，保持 5 次深呼吸',
    '转头看窗外 6 米以外的地方，放松眼睛',
    '站起来踮 10 次脚尖，唤醒小腿泵血',
    '髋部向前顶一顶，久坐这里最容易紧',
    '手腕画圈，手指张开再握拳，重复 5 次',
    '接一杯水，顺便让眼睛离开屏幕',
  ];

  const el = {
    body: document.body,
    clock: document.getElementById('clock'),
    kicker: document.getElementById('kicker'),
    hint: document.getElementById('hint'),
    ring: document.getElementById('ringValue'),
    tipText: document.getElementById('tipText'),
    tipDots: document.getElementById('tipDots'),
    meta: document.getElementById('meta'),
    brandState: document.getElementById('brandState'),
    done: document.getElementById('btnDone'),
    snooze: document.getElementById('btnSnooze'),
    snoozeText: document.getElementById('snoozeText'),
    skip: document.getElementById('btnSkip'),
  };

  let snap = null;
  let tipIndex = 0;
  let done = false;
  let alerted = false;

  function playAlertOnce() {
    if (alerted) return;
    alerted = true;
    if (isPrimary && snap && snap.config && snap.config.sound) window.SAudio.play('alert');
  }

  el.done.querySelector('.ic').innerHTML = ICONS.check;
  el.snooze.querySelector('[data-icon]').innerHTML = ICONS.snooze;
  el.skip.querySelector('[data-icon]').innerHTML = ICONS.skip;
  el.tipDots.replaceChildren(...TIPS.map(() => document.createElement('i')));

  function applyTheme(pref) {
    const light = pref === 'light' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
  }

  function rotateTip() {
    if (done || !isPrimary) return;
    tipIndex = (tipIndex + 1) % TIPS.length;
    el.tipText.classList.add('is-out');
    setTimeout(() => {
      el.tipText.textContent = TIPS[tipIndex];
      el.tipText.classList.remove('is-out');
      [...el.tipDots.children].forEach((dot, i) => dot.classList.toggle('on', i === tipIndex));
    }, 260);
  }

  function render(s) {
    if (!s || !s.config) return;
    const leaving = done && s.phase !== 'break';
    snap = s;
    applyTheme(s.config.theme);
    el.body.dataset.primary = isPrimary ? '1' : '0';

    if (s.phase === 'break') {
      if (done) return; // 完成态已经画好，别让后到的状态把环拨回去
      const total = Math.max(1, s.breakTotalSec);
      const frac = Math.max(0, Math.min(1, 1 - s.breakRemainingSec / total));
      el.ring.style.strokeDasharray = String(RING_C);
      el.ring.style.strokeDashoffset = String(RING_C * (1 - frac));
      el.clock.textContent = F.clock(s.breakRemainingSec);
      el.snoozeText.textContent = `稍后 ${s.config.snoozeMin} 分钟`;
      el.meta.textContent = `本段已连续坐了 ${s.stats.longestFocusMin} 分钟 · 今日第 ${s.stats.breaksDone + 1} 次休息 · 每 ${s.config.intervalMin} 分钟提醒一次`;
      el.brandState.textContent = s.breakRemainingSec > 0 ? '休息时间' : '休息完成';
    } else if (!leaving) {
      // 引擎已经收尾（离开键盘自动完成等），补一次完成态
      markDone();
    }
  }

  function markDone() {
    if (done) return;
    done = true;
    el.body.classList.add('is-done');
    el.kicker.textContent = '做得好';
    el.hint.textContent = '可以回到工作了';
    el.clock.textContent = '0:00';
    el.brandState.textContent = '休息完成';
    el.ring.style.strokeDashoffset = '0';
    if (isPrimary && snap && snap.config.sound) window.SAudio.play('done');
  }

  function markLeaving() {
    el.body.classList.add('is-leaving');
  }

  function command(name) {
    markLeaving();
    api.command(name);
  }

  el.done.addEventListener('click', () => {
    markLeaving();
    api.command('dismiss');
  });
  el.snooze.addEventListener('click', () => command('snooze'));
  el.skip.addEventListener('click', () => command('skip'));

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') command('snooze');
    else if (event.key === 'Enter' && done) api.command('dismiss');
  });

  api.onMessage((message) => {
    if (message.type === 'state') {
      render(message.snapshot);
      if (message.snapshot.phase === 'break' && message.snapshot.breakRemainingSec === 0) markDone();
    } else if (message.type === 'event') {
      const event = message.event;
      if (event.type === 'break-start') playAlertOnce();
      if (event.type === 'break-complete') markDone();
      if (event.type === 'break-skipped' || event.type === 'break-snooze' || event.type === 'paused') markLeaving();
    }
  });

  setInterval(rotateTip, TIP_SECONDS * 1000);
  api.getState().then((s) => {
    render(s);
    [...el.tipDots.children].forEach((dot, i) => dot.classList.toggle('on', i === 0));
    el.tipText.textContent = TIPS[0];
    playAlertOnce();
  });
})();

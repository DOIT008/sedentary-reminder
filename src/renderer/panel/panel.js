(function () {
  'use strict';

  const api = window.sedentary;
  const F = window.SFmt;
  const ICONS = window.SIcon;
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  };

  const RING_R = 104;
  const RING_C = 2 * Math.PI * RING_R;
  const INTERVAL_PRESETS = [30, 45, 60, 90, 120];
  const BREAK_PRESETS = [1, 3, 5, 10, 15];

  const SWITCHES = [
    { key: 'sound', icon: 'soundOn', title: '提示音', desc: '到点播放一声很轻的双音，只响一次' },
    { key: 'idlePause', icon: 'away', title: '离开自动暂停', desc: '键鼠闲置超过阈值就不计时，回来接着算' },
    { key: 'lockPostpone', icon: 'lock', title: '锁屏 / 睡眠后顺延', desc: '回来不补罚，重新计一个完整周期' },
    { key: 'forceOverlay', icon: 'force', title: '全屏强制遮罩', desc: '休息时盖住包括任务栏在内的全部内容' },
    { key: 'autostart', icon: 'plug', title: '开机自动启动', desc: '在 Windows「启动」文件夹放一个快捷方式' },
  ];

  const THEME_ORDER = ['auto', 'dark', 'light'];
  const THEME_ICON = { auto: 'auto', dark: 'moon', light: 'sun' };
  const THEME_TEXT = { auto: '跟随系统', dark: '深色', light: '浅色' };

  const ui = {
    hero: $('.hero'),
    ringValue: $('#ringValue'),
    ringHead: $('#ringHead'),
    ringPulse: $('#ringPulse'),
    phase: $('#phaseLabel'),
    heroState: $('#heroState'),
    clock: $('#bigClock'),
    unit: $('#clockUnit'),
    next: $('#nextLine'),
    brandSub: $('#brandSub'),
    chip: $('#statusChip'),
    chipText: $('#statusText'),
    pauseText: $('#pauseText'),
    pauseIcon: $('#pauseIcon'),
    nowText: $('#nowText'),
    nowIcon: $('#nowIcon'),
    intervalSeg: $('#intervalSeg'),
    intervalRange: $('#intervalRange'),
    intervalVal: $('#intervalVal'),
    breakSeg: $('#breakSeg'),
    breakVal: $('#breakVal'),
    snoozeVal: $('#snoozeVal'),
    idleField: $('#idleField'),
    idleRange: $('#idleRange'),
    idleVal: $('#idleVal'),
    switches: $('#switches'),
    hourChart: $('#hourChart'),
    weekChart: $('#weekChart'),
    weekLegend: $('#weekLegend'),
    todayTotal: $('#todayTotal'),
    weekHint: $('#weekHint'),
    mSitting: $('#mSitting'),
    mSittingUnit: $('#mSittingUnit'),
    mBreaks: $('#mBreaks'),
    mBreaksNote: $('#mBreaksNote'),
    mLast: $('#mLast'),
    mLastNote: $('#mLastNote'),
    kpiSpark: $('#kpiSpark'),
    adv: $('#adv'),
    advHead: $('#advHead'),
    advSummary: $('#advSummary'),
    toast: $('#toast'),
    toastText: $('#toastText'),
    foot: $('#foot'),
  };

  let snap = null;
  let meta = { userData: '', version: '' };
  let dragging = null;
  let lastSoundKey = '';
  let chartWidth = 0;
  let hourBuilt = false;
  let weekBuilt = false;
  let weekKey = '';
  let lastClockKey = '';
  let lastPhase = '';
  let toastTimer = null;

  function paintIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((node) => {
      node.innerHTML = ICONS[node.dataset.icon] || '';
    });
  }

  /** 数字换档才脉冲，逐秒跳动的东西不该抢注意力 */
  function pulseClock(key) {
    if (key === lastClockKey) return;
    lastClockKey = key;
    if (document.body.dataset.reducedMotion === 'on') return;
    ui.clock.classList.remove('tick');
    void ui.clock.offsetWidth;
    ui.clock.classList.add('tick');
  }

  function toast(msg) {
    ui.toastText.textContent = msg;
    ui.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('is-show'), 2100);
  }

  /* ---------------------------------------------------------------- 主题 */

  function themeName(pref) {
    if (pref === 'auto') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    return pref === 'light' ? 'light' : 'dark';
  }

  function applyTheme(pref) {
    document.documentElement.dataset.theme = themeName(pref);
    $('#btnTheme').innerHTML = ICONS[THEME_ICON[pref]];
    $('#btnTheme').title = `主题：${THEME_TEXT[pref]}（点击切换）`;
  }

  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    document.body.dataset.reducedMotion = e.matches ? 'on' : 'off';
  });

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (snap && snap.config.theme === 'auto') applyTheme('auto');
  });

  /* ---------------------------------------------------------------- 控件 */

  function buildSegments() {
    ui.intervalSeg.replaceChildren(
      ...INTERVAL_PRESETS.map((min) => {
        const b = el('button', '', `${min}`);
        b.dataset.value = String(min);
        b.title = `每 ${min} 分钟提醒一次`;
        b.addEventListener('click', () => setConfig({ intervalMin: min }, `已生效 · 之后每 ${min} 分钟提醒一次`));
        return b;
      })
    );
    ui.breakSeg.replaceChildren(
      ...BREAK_PRESETS.map((min) => {
        const b = el('button', '', `${min}`);
        b.dataset.value = String(min);
        b.title = `每次休息 ${min} 分钟`;
        b.addEventListener('click', () => setConfig({ breakMin: min }, `已生效 · 遮罩会走满 ${min} 分钟`));
        return b;
      })
    );
  }

  function buildSwitches() {
    ui.switches.replaceChildren(
      ...SWITCHES.map((item) => {
        const row = el('div', 'sw');
        row.setAttribute('role', 'switch');
        row.dataset.key = item.key;
        row.tabIndex = 0;
        row.innerHTML = `<span class="sw__ic">${ICONS[item.icon]}</span>
          <span class="sw__txt"><span class="sw__t">${item.title}</span><span class="sw__d">${item.desc}</span></span>
          <span class="switch" aria-hidden="true"></span>`;
        const toggle = () => {
          const next = !(snap && snap.config[item.key]);
          setConfig({ [item.key]: next }, `${item.title}已${next ? '开启' : '关闭'}`);
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', (e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggle();
          }
        });
        return row;
      })
    );
  }

  function bindRange(input, key, format) {
    const onInput = () => {
      dragging = key;
      const value = Number(input.value);
      input.style.setProperty('--pct', pct(value, Number(input.min), Number(input.max)));
      if (key === 'intervalMin') ui.intervalVal.textContent = format(value);
      if (key === 'idleThresholdMin') ui.idleVal.textContent = format(value);
      scheduleConfig({ [key]: value });
    };
    input.addEventListener('input', onInput);
    input.addEventListener('change', () => {
      dragging = null;
      commitConfig();
    });
  }

  let pendingPatch = null;
  let pendingTimer = null;
  let pendingNote = '';

  function scheduleConfig(patch) {
    pendingPatch = Object.assign(pendingPatch || {}, patch);
    if (pendingTimer) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const payload = pendingPatch;
      pendingPatch = null;
      api.setConfig(payload).then((next) => { if (next && next.phase) render(next); });
    }, 260);
  }

  function commitConfig() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    const payload = pendingPatch;
    pendingPatch = null;
    if (!payload) return;
    api.setConfig(payload).then((next) => {
      if (next && next.phase) render(next);
      if (payload.intervalMin != null) toast(`已生效 · 之后每 ${payload.intervalMin} 分钟提醒一次`);
      else if (payload.idleThresholdMin != null) toast(`已生效 · 离开 ${payload.idleThresholdMin} 分钟算「不在」`);
    });
  }

  function setConfig(patch, note) {
    api.setConfig(patch).then((next) => {
      if (next && next.phase) render(next);
      if (note) toast(note);
    });
  }

  function pct(value, min, max) {
    return Math.round(((value - min) / (max - min)) * 100);
  }

  /* ---------------------------------------------------------------- 抽屉 */

  function toggleDrawer(force) {
    const open = force === undefined ? ui.adv.dataset.open !== 'true' : force;
    ui.adv.dataset.open = String(open);
    ui.advHead.setAttribute('aria-expanded', String(open));
    if (open) {
      // 展开后把抽屉尾部带进可视区，收起时不动滚动位置
      requestAnimationFrame(() => setTimeout(() => {
        if (ui.adv.dataset.open === 'true') ui.adv.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 260));
    }
  }

  /* ---------------------------------------------------------------- 图表 */

  function hourChart(stats) {
    const host = ui.hourChart;
    const W = Math.max(240, host.clientWidth || 300);
    const H = 62;
    const gap = 3;
    const bw = (W - gap * 23) / 24;
    const max = Math.max(30, ...stats.hourly);
    const nowHour = new Date().getHours();
    const bars = stats.hourly
      .map((v, i) => {
        const h = Math.max(0.04, v / max);
        const x = (i * (bw + gap)).toFixed(2);
        const cls = i === nowHour ? 'hbar hbar--now' : 'hbar';
        const fill = i === nowHour ? 'url(#barGradNow)' : 'url(#barGrad)';
        return `<rect class="${cls}" x="${x}" y="0" width="${bw.toFixed(2)}" height="${H}" rx="${Math.min(3, bw / 2).toFixed(1)}"
          fill="${fill}" style="--v:${h.toFixed(3)};--i:${i}"><title>${F.pad(i)}:00 · ${Math.round(v)} 分钟</title></rect>`;
      })
      .join('');
    const ticks = [0, 6, 12, 18, 23]
      .map((i) => `<text class="axis" x="${Math.min(W - 12, i * (bw + gap) + bw / 2).toFixed(0)}" y="${H + 12}" text-anchor="middle">${F.pad(i)}</text>`)
      .join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H + 16}" width="${W}" height="${H + 16}">
      <defs>
        <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="var(--accent)" stop-opacity="0.3"/><stop offset="1" stop-color="var(--accent-2)" stop-opacity="0.8"/>
        </linearGradient>
        <linearGradient id="barGradNow" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="var(--accent)" stop-opacity="0.9"/><stop offset="1" stop-color="var(--accent-3)"/>
        </linearGradient>
      </defs>
      <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--line)" stroke-width="1"/>
      ${bars}${ticks}
    </svg>`;
    chartWidth = W;
    hourBuilt = true;
  }

  /** 之后每秒只改当前小时那一根，让 transform 过渡把变化讲清楚，而不是整张重建 */
  function patchHourBars(stats) {
    const rects = ui.hourChart.querySelectorAll('.hbar');
    if (!rects.length) return;
    const max = Math.max(30, ...stats.hourly);
    const nowHour = new Date().getHours();
    rects.forEach((r, i) => {
      const h = Math.max(0.04, stats.hourly[i] / max);
      const next = h.toFixed(3);
      if (r.style.getPropertyValue('--v') !== next) r.style.setProperty('--v', next);
      const isNow = i === nowHour;
      if (r.classList.contains('hbar--now') !== isNow) {
        r.classList.toggle('hbar--now', isNow);
        r.setAttribute('fill', isNow ? 'url(#barGradNow)' : 'url(#barGrad)');
      }
      const tip = r.querySelector('title');
      const text = `${F.pad(i)}:00 · ${Math.round(stats.hourly[i])} 分钟`;
      if (tip && tip.textContent !== text) tip.textContent = text;
    });
  }

  function weekChart(stats, animate) {
    const host = ui.weekChart;
    const W = Math.max(240, host.clientWidth || 300);
    const H = 46;
    const padX = 8;
    const padTop = 6;
    const data = stats.week;
    const max = Math.max(60, ...data.map((d) => d.focusMin));
    const stepX = (W - padX * 2) / Math.max(1, data.length - 1);
    const pts = data.map((d, i) => {
      const x = padX + i * stepX;
      const y = H - ((d.focusMin / max) * (H - padTop - 10)) - 10;
      return { x, y, d };
    });
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1].x.toFixed(1)} ${H} L${pts[0].x.toFixed(1)} ${H} Z`;
    const dots = pts
      .map((p) => `<circle class="weekDot${p.d.partial ? ' weekDot--today' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.d.partial ? 4 : 2.8}"><title>${F.dayLabel(p.d.day)}（${F.weekday(p.d.day)}）· ${p.d.focusMin} 分钟</title></circle>`)
      .join('');
    const labels = pts
      .map((p) => `<text class="axis" x="${p.x.toFixed(0)}" y="${H + 11}" text-anchor="middle">${p.d.partial ? '今天' : F.dayLabel(p.d.day)}</text>`)
      .join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H + 16}" width="${W}" height="${H + 16}" class="${animate ? 'is-draw' : ''}">
      <defs>
        <linearGradient id="weekStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-3)"/>
        </linearGradient>
        <linearGradient id="weekFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--accent-2)" stop-opacity="0.3"/><stop offset="1" stop-color="var(--accent-2)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path class="weekArea" d="${area}"/><path class="weekLine" d="${line}"/>${dots}${labels}
    </svg>`;
    weekBuilt = true;
  }

  function sparkline(week) {
    if (week.length < 2) {
      ui.kpiSpark.hidden = true;
      return;
    }
    ui.kpiSpark.hidden = false;
    const max = Math.max(60, ...week.map((d) => d.focusMin));
    ui.kpiSpark.replaceChildren(
      ...week.map((d) => {
        const b = el('b');
        b.style.height = `${Math.max(3, (d.focusMin / max) * 20).toFixed(1)}px`;
        b.title = `${F.dayLabel(d.day)}（${F.weekday(d.day)}）· ${d.focusMin} 分钟`;
        return b;
      })
    );
  }

  /* ---------------------------------------------------------------- 渲染 */

  function phaseView(s) {
    if (s.phase === 'break') return { cls: 'is-break', phase: '休息中', unit: '后结束', value: s.breakRemainingSec, frac: s.breakTotalSec ? 1 - s.breakRemainingSec / s.breakTotalSec : 0 };
    if (s.phase === 'paused') return { cls: 'is-frozen', phase: '已暂停', unit: '后提醒', value: s.focusRemainingSec, frac: s.focusTotalSec ? 1 - s.focusRemainingSec / s.focusTotalSec : 0 };
    if (s.phase === 'idle') {
      const label = s.freezeReason === 'lock' ? '锁屏中' : '你不在';
      return { cls: 'is-frozen', phase: label, unit: '计时已冻结', value: s.focusRemainingSec, frac: s.focusTotalSec ? 1 - s.focusRemainingSec / s.focusTotalSec : 0 };
    }
    return { cls: '', phase: '专注中', unit: '后提醒', value: s.focusRemainingSec, frac: s.focusTotalSec ? 1 - s.focusRemainingSec / s.focusTotalSec : 0 };
  }

  function heroState(s) {
    if (s.phase === 'break') return `今日第 ${s.stats.breaksDone + 1} 次起身`;
    if (s.phase === 'paused') return '暂停期间不累计';
    if (s.phase === 'idle') return s.freezeReason === 'lock' ? '解锁后重新开始' : `已经离开 ${Math.max(1, Math.round(s.awaySec / 60))} 分钟`;
    return `本段已连坐 ${s.stats.longestFocusMin} 分钟`;
  }

  function statusChip(s) {
    const soon = s.phase === 'focus' && s.focusRemainingSec <= 60;
    if (s.phase === 'break') return { cls: 'chip chip--warn', text: `休息 ${F.clock(s.breakRemainingSec)}` };
    if (s.phase === 'paused') return { cls: 'chip chip--idle', text: '提醒已暂停' };
    if (s.phase === 'idle') return { cls: 'chip chip--idle', text: s.freezeReason === 'lock' ? '锁屏暂停' : `离开 ${Math.max(1, Math.round(s.awaySec / 60))} 分钟` };
    if (soon) return { cls: 'chip chip--warn', text: '马上提醒' };
    return { cls: 'chip', text: `下次 ${F.hhmm(s.nextDueAt)}` };
  }

  function render(s) {
    if (!s || !s.config) return;
    snap = s;
    const view = phaseView(s);
    const phaseChanged = lastPhase !== s.phase;
    lastPhase = s.phase;
    document.body.dataset.phase = s.phase;
    ui.hero.classList.toggle('is-break', view.cls === 'is-break');
    ui.hero.classList.toggle('is-frozen', view.cls === 'is-frozen');
    ui.clock.textContent = F.clock(view.value);
    ui.phase.textContent = view.phase;
    ui.unit.textContent = view.unit;
    ui.heroState.textContent = heroState(s);

    const frac = Math.max(0, Math.min(1, view.frac));
    ui.ringValue.style.strokeDasharray = String(RING_C);
    ui.ringValue.style.strokeDashoffset = String(RING_C * (1 - frac));
    ui.ringValue.style.stroke = view.cls === 'is-break' ? 'url(#ringGradientBreak)' : 'url(#ringGradient)';
    ui.ringHead.style.transform = `rotate(${(frac * 360).toFixed(2)}deg)`;
    ui.ringHead.style.opacity = s.phase === 'break' ? '0' : '0.92';
    const soon = s.phase === 'focus' && s.focusRemainingSec <= 60;
    ui.ringPulse.style.animation = soon ? 'ringPulse 1.9s var(--ease-soft) infinite' : 'none';
    // 只有跨过整分钟或换了阶段才脉冲
    pulseClock(`${Math.floor(view.value / 60)}:${s.phase}`);

    const chip = statusChip(s);
    if (ui.chip.className !== chip.cls) ui.chip.className = chip.cls;
    ui.chipText.textContent = chip.text;
    ui.brandSub.textContent = `每 ${s.config.intervalMin} 分钟提醒 · 休息 ${s.config.breakMin} 分钟`;

    const sitting = s.stats.sittingMin;
    const today = sitting >= 60 ? `${Math.floor(sitting / 60)} 小时 ${sitting % 60} 分` : `${sitting} 分钟`;
    const held = s.paused || s.phase === 'idle';
    ui.next.innerHTML =
      s.phase === 'break'
        ? '起身走动一下，看看远处，倒计时结束会自动关闭'
        : held
          ? `恢复后还要 <b>${F.clock(s.focusRemainingSec)}</b> 才提醒 · 今日已坐 <b>${today}</b>`
          : soon
            ? `先准备好起身，<b>${F.clock(s.focusRemainingSec)}</b> 后遮罩会出现 · 今日已坐 <b>${today}</b>`
            : `下次提醒 <b>${F.hhmm(s.nextDueAt)}</b> · 今日已坐 <b>${today}</b>`;

    const paused = s.phase === 'paused';
    const pauseIco = paused ? 'play' : 'pause';
    ui.pauseText.textContent = paused ? '继续' : '暂停';
    // render 每秒跑一次，图标只在真的换档时重写 DOM
    if (ui.pauseIcon.dataset.icon !== pauseIco) {
      ui.pauseIcon.dataset.icon = pauseIco;
      ui.pauseIcon.innerHTML = ICONS[pauseIco];
    }
    const onBreak = s.phase === 'break';
    ui.nowText.textContent = onBreak ? '完成休息' : '现在休息';
    ui.nowIcon.innerHTML = ICONS[onBreak ? 'check' : 'stand'];

    // KPI 三块
    if (sitting >= 60) {
      ui.mSitting.textContent = (sitting / 60).toFixed(1);
      ui.mSittingUnit.textContent = '小时';
    } else {
      ui.mSitting.textContent = String(sitting);
      ui.mSittingUnit.textContent = '分钟';
    }
    ui.mBreaks.textContent = String(s.stats.breaksDone);
    ui.mBreaksNote.textContent = s.stats.breaksSkipped || s.stats.snoozes
      ? `跳过 ${s.stats.breaksSkipped} 次 · 稍后 ${s.stats.snoozes} 次`
      : `每次 ${s.config.breakMin} 分钟 · 没有跳过`;
    const lastAt = s.stats.lastBreakAt || s.lastBreakAt;
    ui.mLast.textContent = lastAt ? F.hhmm(lastAt) : '—';
    ui.mLastNote.textContent = lastAt ? F.since(lastAt) : '今天还没有';
    sparkline(s.stats.week);

    // 控件同步（拖动中不打断）
    const c = s.config;
    ui.intervalVal.textContent = `${c.intervalMin} 分钟`;
    ui.breakVal.textContent = `${c.breakMin} 分钟`;
    ui.snoozeVal.textContent = String(c.snoozeMin);
    ui.idleVal.textContent = `${c.idleThresholdMin} 分钟`;
    if (dragging !== 'intervalMin') {
      ui.intervalRange.value = String(c.intervalMin);
      ui.intervalRange.style.setProperty('--pct', pct(c.intervalMin, 15, 180));
    }
    if (dragging !== 'idleThresholdMin') {
      ui.idleRange.value = String(c.idleThresholdMin);
      ui.idleRange.style.setProperty('--pct', pct(c.idleThresholdMin, 1, 30));
    }
    ui.intervalSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.value) === c.intervalMin)));
    ui.breakSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.value) === c.breakMin)));
    ui.idleField.hidden = !c.idlePause;
    let on = 0;
    ui.switches.querySelectorAll('.sw').forEach((row) => {
      const isOn = Boolean(c[row.dataset.key]);
      if (isOn) on += 1;
      row.setAttribute('aria-checked', String(isOn));
      row.querySelector('.switch').setAttribute('aria-checked', String(isOn));
    });
    // 收起时也能看到状态摘要
    ui.advSummary.textContent = `${SWITCHES.length} 项 · ${on} 项开启`;
    $('#btnSound').innerHTML = ICONS[c.sound ? 'soundOn' : 'soundOff'];
    $('#btnSound').classList.toggle('is-off', !c.sound);
    applyTheme(c.theme);

    ui.todayTotal.textContent = `${sitting} 分钟`;
    const week = s.stats.week;
    const hasTrend = week.length >= 2;
    ui.weekChart.hidden = !hasTrend;
    ui.weekLegend.hidden = !hasTrend;
    const weekSum = week.reduce((acc, d) => acc + d.focusMin, 0);
    ui.weekHint.textContent = hasTrend
      ? `合计 ${weekSum >= 60 ? `${Math.round(weekSum / 60)} 小时` : `${weekSum} 分钟`}`
      : '再用几天，这里会出现近 7 天的趋势';

    if (!hourBuilt || ui.hourChart.clientWidth !== chartWidth) hourChart(s.stats);
    else patchHourBars(s.stats);
    if (hasTrend) {
      // 只在数值真的变了才重画；入场描线动画只在第一次建的时候放
      const nextKey = `${ui.weekChart.clientWidth}|${week.map((d) => d.focusMin).join()}`;
      if (nextKey !== weekKey) {
        weekChart(s.stats, !weekBuilt);
        weekKey = nextKey;
      }
    } else if (weekKey !== '') {
      weekKey = '';
      weekBuilt = false;
    }
    // 路径长度随用户名变化，统一显示成 %APPDATA% 形式，完整路径放 title
    const dir = meta.userData || '';
    const dirNode = document.createElement('b');
    dirNode.textContent = dir.replace(/^[\s\S]*?\\AppData\\Roaming\\/i, '%APPDATA%\\') || '…';
    dirNode.title = dir;
    ui.foot.replaceChildren('数据与设置保存在 ', dirNode, '，只在本机 · 托盘右键可改间隔或退出');
  }

  /* ---------------------------------------------------------------- 事件 */

  function handleEvent(event) {
    const sound = snap && snap.config.sound;
    const key = `${event.type}:${event.reason || ''}:${(snap && snap.nextDueAt) || 0}`;
    if (sound && lastSoundKey !== key) {
      if (event.type === 'break-start') {
        lastSoundKey = key;
        window.SAudio.play('alert');
      } else if (event.type === 'prewarn') {
        lastSoundKey = key;
        window.SAudio.play('warn');
      }
    }
  }

  function wire() {
    document.body.dataset.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'on' : 'off';
    paintIcons();
    buildSegments();
    buildSwitches();
    $('#btnMin').innerHTML = ICONS.minimize;
    $('#btnClose').innerHTML = ICONS.close;
    $('#btnSound').innerHTML = ICONS.soundOn;
    $('#btnReset').innerHTML = ICONS.reset;

    bindRange(ui.intervalRange, 'intervalMin', (v) => `${v} 分钟`);
    bindRange(ui.idleRange, 'idleThresholdMin', (v) => `${v} 分钟`);

    $('#snoozeMinus').addEventListener('click', () => setConfig({ snoozeMin: (snap ? snap.config.snoozeMin : 5) - 1 }));
    $('#snoozePlus').addEventListener('click', () => setConfig({ snoozeMin: (snap ? snap.config.snoozeMin : 5) + 1 }));

    ui.advHead.addEventListener('click', () => toggleDrawer());
    ui.advHead.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleDrawer();
      }
    });

    $('#btnBreakNow').addEventListener('click', () => {
      const finishing = snap && snap.phase === 'break';
      api.command(finishing ? 'finish' : 'break-now').then(() => toast(finishing ? '已结束休息 · 开始新的周期' : '遮罩已打开 · 现在起身'));
    });
    $('#btnPause').addEventListener('click', () => {
      const resuming = snap && snap.phase === 'paused';
      api.command(resuming ? 'resume' : 'pause').then(() => toast(resuming ? '已恢复计时' : '已暂停 · 计时与统计都不再累加'));
    });
    $('#btnReset').addEventListener('click', () => api.command('reset').then(() => toast('已重新计时 · 本段从满周期开始')));
    $('#btnSound').addEventListener('click', () => {
      if (snap && snap.config.sound) window.SAudio.play('preview');
      else setConfig({ sound: true }, '提示音已开启');
    });
    $('#btnTheme').addEventListener('click', () => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf((snap && snap.config.theme) || 'auto') + 1) % THEME_ORDER.length];
      setConfig({ theme: next });
    });
    $('#btnMin').addEventListener('click', () => api.command('minimize'));
    $('#btnClose').addEventListener('click', () => api.command('hide-panel'));

    api.onMessage((message) => {
      if (message.type === 'state') render(message.snapshot);
      else if (message.type === 'event') handleEvent(message.event);
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (snap && snap.stats.hourly.length === 24) {
          hourBuilt = false;
          weekBuilt = false;
          render(snap);
        }
      }, 140);
    });

    api.command('meta').then((result) => {
      if (result && result.userData) {
        meta = result;
        if (snap) render(snap);
      }
    });
    api.getState().then(render);
  }

  window.addEventListener('error', (e) => console.error('[panel]', e.message));
  wire();
})();

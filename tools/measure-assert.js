/* 面板量测断言（浏览器端脚本，由 tools/measure-server.cjs 挂在 /harness-assert.js）
   在页面里跑真实交互，返回 [{name, pass, detail}]；门禁在 tools/measure-check.cjs */
(function () {
  'use strict';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const push = (name, pass, detail) => {
    results.push({ name: `${name}${window.__MEASURE_TAG ? ':' + window.__MEASURE_TAG : ''}`, pass: Boolean(pass), detail: String(detail == null ? '' : detail) });
  };
  const q = (sel) => document.querySelector(sel);
  const rect = (sel) => {
    const n = q(sel);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
  };
  const css = (sel, prop) => {
    const n = q(sel);
    return n ? getComputedStyle(n)[prop] : null;
  };
  const overlapY = (a, b) => a && b && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const click = (sel) => {
    const n = q(sel);
    if (n) n.click();
    return Boolean(n);
  };
  // 未聚焦窗口的 rAF 会被饿死，合成层的 opacity/transform 读不到实时值，
  // 所以量终态前先把过渡钉到终点（和 capture.js 一样的处理）
  const settle = async () => {
    document.getAnimations().forEach((a) => {
      if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) a.finish();
    });
    await wait(40);
  };

  async function layout(tag) {
    window.__MEASURE_TAG = tag;
    const de = document.documentElement;
    const w = `${de.clientWidth}x${de.clientHeight}`;
    push('no-h-overflow', de.scrollWidth <= de.clientWidth + 1, `${w} scrollW=${de.scrollWidth}`);
    push('no-page-scroll', de.scrollHeight <= de.clientHeight + 1, `${w} scrollH=${de.scrollHeight}`);

    const L = rect('.col--L');
    const Rt = rect('.col--R');
    push('columns-side-by-side', L && Rt && L.right <= Rt.left + 1, `L.right=${L.right.toFixed(1)} R.left=${Rt.left.toFixed(1)}`);

    const hero = rect('#hero');
    const axis = rect('.axis');
    push('hero-axis-stacked', hero && axis && !overlapY(hero, axis) && axis.top >= hero.bottom - 1, `hero.b=${hero.bottom.toFixed(1)} axis.t=${axis.top.toFixed(1)}`);

    const clock = rect('#bigClock');
    const ringBox = rect('.hero__ringBox');
    const inside = clock && ringBox && clock.left >= ringBox.left - 1 && clock.right <= ringBox.right + 1
      && clock.top >= ringBox.top - 1 && clock.bottom <= ringBox.bottom + 1;
    push('clock-inside-ring', inside, clock && ringBox ? `clock=${clock.width.toFixed(0)}x${clock.height.toFixed(0)} ring=${ringBox.width.toFixed(0)}` : 'missing');

    const kids = Array.from(document.querySelectorAll('.col--R > *'));
    let bad = '';
    for (let i = 1; i < kids.length; i += 1) {
      const a = kids[i - 1].getBoundingClientRect();
      const b = kids[i].getBoundingClientRect();
      if (a.bottom > b.top + 1) bad += ` ${kids[i - 1].className.split(' ')[0]}->${kids[i].className.split(' ')[0]}`;
    }
    push('no-card-overlap', kids.length >= 4 && !bad, bad || `${kids.length} blocks`);

    const side = q('.side');
    const footEl = q('#foot');
    const footR = rect('#foot');
    if (side && footR && side.clientHeight >= 560) {
      // 默认窗口里页脚要整行露出来；更小的窗口允许滚动，只要求滚到底能看到（见 foot-reachable）
      const lines = footR.height / parseFloat(getComputedStyle(footEl).lineHeight);
      push('foot-fully-visible', footR.bottom <= side.getBoundingClientRect().bottom + 1, `foot.b=${footR.bottom.toFixed(1)} side.b=${side.getBoundingClientRect().bottom.toFixed(1)} lines=${lines.toFixed(1)}`);
    }
    if (q('#adv').dataset.open !== 'true' && side) {
      // 默认窗口（920×660 → 右列可视高 574）要整列不滚动；更小的窗口只要求主控件可见
      if (side.clientHeight >= 560) {
        push('side-fits-collapsed', side.scrollHeight <= side.clientHeight + 1, `scrollH=${side.scrollHeight} clientH=${side.clientHeight}`);
      } else {
        // 最小窗口放不下全部内容，但「提醒节奏」这张主控件卡必须整块可见
        const cardR = rect('.card');
        const sideR = rect('.side');
        push('primary-controls-visible', cardR && cardR.top >= sideR.top && cardR.bottom <= sideR.bottom + 2, `card ${cardR && cardR.top.toFixed(0)}-${cardR && cardR.bottom.toFixed(0)} side ${sideR.top.toFixed(0)}-${sideR.bottom.toFixed(0)}`);
      }
    }
    const hourOk = Boolean(q('#hourChart svg')) && document.querySelectorAll('.hbar').length === 24;
    const weekHidden = q('#weekChart').hidden;
    const weekDots = document.querySelectorAll('.weekDot').length;
    const weekOk = weekHidden ? weekDots === 0 : weekDots >= 2;
    push('charts-rendered', hourOk && weekOk, `hbars=${document.querySelectorAll('.hbar').length} weekHidden=${weekHidden} weekPts=${weekDots}`);
    push('bars-have-spring-scale', Array.from(document.querySelectorAll('.hbar')).every((b) => b.style.getPropertyValue('--v') !== ''), `first=${q('.hbar') && q('.hbar').style.getPropertyValue('--v')}`);
  }

  async function interactions() {
    window.__MEASURE_TAG = 'act';
    const de = document.documentElement;
    const toastEl = q('#toast');

    // 抽屉展开
    const closedClip = rect('.adv__clip');
    const caret0 = css('.adv__caret svg', 'transform');
    push('drawer-closed-flat', closedClip && closedClip.height < 4, `h=${closedClip && closedClip.height.toFixed(1)}`);
    click('#advHead');
    await wait(160);
    const rowAnim = document.getAnimations().find((a) => a.effect && a.effect.target === q('.adv__body') && a.transitionProperty === 'grid-template-rows');
    await settle();
    const openClip = rect('.adv__clip');
    const inner = rect('.adv__inner');
    push('drawer-animates-open', Boolean(rowAnim && rowAnim.playState !== 'idle' && rowAnim.effect.getComputedTiming().duration > 200), rowAnim ? `${rowAnim.playState} ${rowAnim.effect.getComputedTiming().duration}ms` : 'no transition');
    push('drawer-opens', openClip.height > 120, `h=${openClip.height.toFixed(1)}`);
    push('drawer-aria', q('#advHead').getAttribute('aria-expanded') === 'true', q('#advHead').getAttribute('aria-expanded'));
    push('drawer-not-clipped', Math.abs(inner.height - openClip.height) < 2, `inner=${inner.height.toFixed(1)} clip=${openClip.height.toFixed(1)}`);
    const caret1 = css('.adv__caret svg', 'transform');
    // 展开时箭头朝上（rotate 270），朝左说明方向选错了
    push('drawer-caret-points-up', /matrix\(\s*0,\s*-1/.test(caret1), caret1);
    push('drawer-caret-animates', caret0 !== caret1, `${caret0} -> ${caret1}`);
    push('drawer-switches-visible', document.querySelectorAll('#switches .sw').length === 5, document.querySelectorAll('#switches .sw').length);
    push('drawer-no-h-overflow', de.scrollWidth <= de.clientWidth + 1, `scrollW=${de.scrollWidth}`);

    // 高亮框要往外扩：图标和开关不能贴着 hover 背景的边
    const swR = rect('.sw');
    const icR = rect('.sw .sw__ic');
    const tgR = rect('.sw .switch');
    push('sw-highlight-insets', icR.left - swR.left >= 8 && swR.right - tgR.right >= 8,
      `L=${(icR.left - swR.left).toFixed(1)} R=${(swR.right - tgR.right).toFixed(1)}`);

    // 展开后右列可以滚到底，页脚能进可视区
    const side = q('.side');
    side.scrollTop = side.scrollHeight;
    await settle();
    const foot = rect('#foot');
    const sideR = rect('.side');
    push('foot-reachable', foot.bottom <= sideR.bottom + 2 && foot.top >= sideR.top - 2, `foot.b=${foot.bottom.toFixed(0)} side.b=${sideR.bottom.toFixed(0)}`);
    push('drawer-scrolls-internally', side.scrollHeight > side.clientHeight, `scrollH=${side.scrollHeight} clientH=${side.clientHeight}`);

    // 收起
    click('#advHead');
    await settle();
    push('drawer-closes', rect('.adv__clip').height < 4, `h=${rect('.adv__clip').height.toFixed(1)}`);
    side.scrollTop = 0;
    await wait(80);

    // 生效 toast：点休息时长预设
    push('toast-hidden-idle', getComputedStyle(toastEl).opacity < 0.05, getComputedStyle(toastEl).opacity);
    const breakBtn = Array.from(document.querySelectorAll('#breakSeg button')).find((b) => b.textContent.trim() === '3');
    breakBtn.click();
    await wait(80);
    const toastAnims = document.getAnimations().filter((a) => a.effect && a.effect.target === toastEl);
    push('toast-transitions', toastAnims.length >= 2 && toastAnims.every((a) => a.playState !== 'idle'), toastAnims.map((a) => `${a.transitionProperty}:${a.playState}`).join(','));
    push('toast-text', /已生效/.test(toastEl.textContent) && /3 分钟/.test(toastEl.textContent), toastEl.textContent.trim());
    await settle();
    push('toast-shows', toastEl.classList.contains('is-show') && Number(getComputedStyle(toastEl).opacity) > 0.99, `op=${getComputedStyle(toastEl).opacity}`);
    push('break-val-updates', q('#breakVal').textContent.trim() === '3 分钟', q('#breakVal').textContent.trim());
    push('break-seg-active', breakBtn.getAttribute('aria-pressed') === 'true', breakBtn.getAttribute('aria-pressed'));
    await wait(2600);
    push('toast-auto-hides', !toastEl.classList.contains('is-show'), toastEl.className);

    // 间隔预设 + 滑杆同步
    const seg60 = Array.from(document.querySelectorAll('#intervalSeg button')).find((b) => b.textContent.trim() === '60');
    seg60.click();
    await wait(150);
    push('interval-val-sync', q('#intervalVal').textContent.trim() === '60 分钟', q('#intervalVal').textContent.trim());
    push('interval-range-sync', q('#intervalRange').value === '60', q('#intervalRange').value);
    push('interval-seg-active', seg60.getAttribute('aria-pressed') === 'true', seg60.getAttribute('aria-pressed'));
    push('brand-sub-sync', /每 60 分钟提醒/.test(q('#brandSub').textContent), q('#brandSub').textContent.trim());

    // stepper
    const before = Number(q('#snoozeVal').textContent);
    click('#snoozePlus');
    await wait(120);
    push('stepper-plus', Number(q('#snoozeVal').textContent) === before + 1, `${before} -> ${q('#snoozeVal').textContent}`);

    // 暂停按钮的状态反馈
    const pauseIco0 = q('#pauseIcon').innerHTML;
    click('#btnPause');
    await wait(150);
    push('pause-toast', /暂停|恢复/.test(toastEl.textContent), toastEl.textContent.trim());

    // 图标要跟着状态走：只改文字不算反馈
    const pausedSnap = JSON.parse(JSON.stringify(window.__measure.snapshot()));
    pausedSnap.phase = 'paused';
    pausedSnap.paused = true;
    window.__measure.emit({ type: 'state', snapshot: pausedSnap });
    await wait(80);
    const pauseIco1 = q('#pauseIcon').innerHTML;
    push('pause-icon-swaps', pauseIco1.includes('<svg') && pauseIco1 !== pauseIco0 && q('#pauseText').textContent.trim() === '继续',
      `${q('#pauseIcon').dataset.icon} / ${q('#pauseText').textContent.trim()}`);
    pausedSnap.phase = 'focus';
    pausedSnap.paused = false;
    window.__measure.emit({ type: 'state', snapshot: pausedSnap });
    await wait(80);
    push('pause-icon-restores', q('#pauseIcon').innerHTML === pauseIco0 && q('#pauseText').textContent.trim() === '暂停', q('#pauseIcon').dataset.icon);

    // .btn:hover 的 background 简写权重比 .btn--primary 高，会把渐变抹成白底：
    // 带背景的变体必须自己声明 hover，否则浅色主题下白底白字。
    const hoverRules = [];
    Array.from(document.styleSheets).forEach((s) => {
      let list = null;
      try { list = s.cssRules; } catch { return; }
      Array.from(list || []).forEach((r) => { if (r.selectorText) hoverRules.push(r); });
    });
    const primaryHover = hoverRules.filter((r) => /(^|,)\s*\.btn--primary:hover\s*($|,)/.test(r.selectorText) && (r.style.backgroundImage || r.style.background));
    push('primary-btn-hover-keeps-bg', primaryHover.length > 0, primaryHover.map((r) => r.selectorText).join('|') || 'missing .btn--primary:hover');

    // 数字脉冲：喂一个跨整分钟的新状态
    const snap = JSON.parse(JSON.stringify(window.__measure.snapshot()));
    snap.phase = 'focus';
    snap.focusRemainingSec = 41 * 60 + 30;
    snap.focusTotalSec = 45 * 60;
    window.__measure.emit({ type: 'state', snapshot: snap });
    await wait(60);
    push('clock-tick-pulse', q('#bigClock').classList.contains('tick'), q('#bigClock').className);
    const tickAnims = document.getAnimations().filter((a) => a.effect && a.effect.target === q('#bigClock'));
    push('clock-tick-animates', tickAnims.length > 0, `${tickAnims.length} animations`);

    // 同一分钟不重复脉冲
    q('#bigClock').classList.remove('tick');
    snap.focusRemainingSec = 41 * 60 + 10;
    window.__measure.emit({ type: 'state', snapshot: snap });
    await wait(60);
    push('clock-tick-deduped', !q('#bigClock').classList.contains('tick'), q('#bigClock').className);

    // 休息阶段：同一主题内比较配色，避免被主题切换干扰
    const focusClockColor = css('#bigClock', 'color');
    const focusRing = css('#ringValue', 'stroke');
    snap.phase = 'break';
    snap.breakRemainingSec = 180;
    snap.breakTotalSec = 300;
    window.__measure.emit({ type: 'state', snapshot: snap });
    await settle();
    push('break-phase-attr', document.body.dataset.phase === 'break', document.body.dataset.phase);
    push('break-hero-class', q('#hero').classList.contains('is-break'), q('#hero').className);
    push('break-clock-color', css('#bigClock', 'color') !== focusClockColor, `${focusClockColor} -> ${css('#bigClock', 'color')}`);
    push('break-ring-gradient', css('#ringValue', 'stroke') !== focusRing, `${focusRing} -> ${css('#ringValue', 'stroke')}`);
    push('break-cta-text', q('#nowText').textContent === '完成休息', q('#nowText').textContent);
    snap.phase = 'focus';
    window.__measure.emit({ type: 'state', snapshot: snap });
    await wait(80);

    // 主题切换
    const theme0 = document.documentElement.dataset.theme;
    click('#btnTheme');
    await wait(150);
    const theme1 = document.documentElement.dataset.theme;
    push('theme-toggles', theme0 !== theme1, `${theme0} -> ${theme1}`);

    // 过渡时长用的是设计令牌量级，不是浏览器默认 0s
    const ring = css('#ringValue', 'transitionDuration');
    push('ring-transitions', Boolean(ring && ring !== '0s'), ring);
    const hbar = css('.hbar', 'transitionDuration');
    push('bars-transition', Boolean(hbar && hbar !== '0s'), hbar);
  }

  const rgbOf = (str) => {
    const s = String(str).trim();
    let m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    m = s.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    return m[1].split(',').slice(0, 3).map((v) => Math.round(parseFloat(v) * (/^\./.test(v) ? 255 : 1)));
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (fg, bg) => {
    const [x, y] = [lum(rgbOf(fg)), lum(rgbOf(bg))].sort((a, b) => b - a);
    return (x + 0.05) / (y + 0.05);
  };

  /* 两个主题下都量一遍文字/背景对比度（AA 小字 4.5:1） */
  async function contrast() {
    const root = document.documentElement;
    const keep = root.dataset.theme;
    for (const theme of ['dark', 'light']) {
      window.__MEASURE_TAG = `aa-${theme}`;
      root.dataset.theme = theme;
      await wait(30);
      const cs = getComputedStyle(root);
      const bg = cs.getPropertyValue('--bg-0').trim();
      const card = cs.getPropertyValue('--bg-1').trim() || bg;
      for (const token of ['--text', '--text-2', '--text-3', '--accent-ink']) {
        const fg = cs.getPropertyValue(token).trim();
        const onBg = ratio(fg, bg);
        const onCard = ratio(fg, card);
        push(`contrast${token}`, Math.min(onBg, onCard) >= 4.5, `${fg} on ${bg}/${card} = ${onBg.toFixed(2)}:${onCard.toFixed(2)}`);
      }

      // 渐变底上的按钮文字：标签居中，所以量渐变两端的中点
      for (const phase of ['focus', 'break']) {
        document.body.dataset.phase = phase;
        await wait(20);
        const stops = String(css('#btnBreakNow', 'backgroundImage')).match(/rgb\([^)]+\)/g) || [];
        const fg = css('#btnBreakNow', 'color');
        const mix = (a, b) => rgbOf(a).map((v, i) => Math.round((v + rgbOf(b)[i]) / 2));
        const mid = stops.length > 1 ? `rgb(${mix(stops[0], stops[stops.length - 1]).join(', ')})` : stops[0];
        const r = mid ? ratio(fg, mid) : 0;
        push(`cta-on-gradient-${phase}`, r >= 4.5, `${fg} on ${mid} = ${r.toFixed(2)}:1`);
      }
      document.body.dataset.phase = '';
    }
    root.dataset.theme = keep;
    await wait(30);
  }

  async function motion() {
    window.__MEASURE_TAG = 'rm';
    const durations = [
      ['.hbar', css('.hbar', 'transitionDuration')],
      ['.adv__body', css('.adv__body', 'transitionDuration')],
      ['.btn', css('.btn', 'transitionDuration')],
    ];
    push('reduced-motion-flag', document.body.dataset.reducedMotion === 'on', document.body.dataset.reducedMotion);
    push('reduced-motion-zeroed', durations.every(([, d]) => d === '0.001s' || d === '0s'), JSON.stringify(durations));
    const clock = q('#bigClock');
    clock.classList.remove('tick');
    const snap = JSON.parse(JSON.stringify(window.__measure.snapshot()));
    snap.phase = 'focus';
    snap.focusRemainingSec = 22 * 60 + 5;
    snap.focusTotalSec = 45 * 60;
    window.__measure.emit({ type: 'state', snapshot: snap });
    await wait(60);
    push('reduced-motion-no-pulse', !clock.classList.contains('tick'), clock.className);
  }

  window.runMeasureAsserts = async (mode) => {
    if (mode === 'reset') results.length = 0;
    if (mode === 'layout') await layout(window.__MEASURE_SCENARIO || 'focus');
    else if (mode === 'interact') await interactions();
    else if (mode === 'motion') await motion();
    else if (mode === 'contrast') await contrast();
    return results;
  };
})();

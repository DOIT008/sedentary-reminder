/* 线性图标：统一 24 视框、1.7 描边、圆头，跟随 currentColor */
(function () {
  'use strict';

  const wrap = (body, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

  window.SIcon = {
    stand: wrap('<circle cx="12" cy="4.6" r="2.1"/><path d="M12 8.4v5.1"/><path d="M12 9.9 8.4 12M12 9.9 15.6 12"/><path d="M12 13.5 9.4 19.6M12 13.5l2.6 6.1"/>'),
    pause: wrap('<path d="M9.4 5.5v13M14.6 5.5v13"/>'),
    play: wrap('<path d="M8.2 5.6 18 12l-9.8 6.4z"/>'),
    reset: wrap('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.4V9h-4.6"/>'),
    snooze: wrap('<path d="M12 7.6V12l3 1.8"/><path d="M4.9 4.9 20 20"/><circle cx="12" cy="12" r="8.4" stroke-dasharray="34 12" transform="rotate(-120 12 12)"/>'),
    skip: wrap('<path d="M6 5.6 15 12l-9 6.4z"/><path d="M18.4 5.5v13"/>'),
    check: wrap('<path d="M5 12.8 9.6 17.4 19 7"/>'),
    soundOn: wrap('<path d="M4.6 9.4h3L12 5.8v12.4l-4.4-3.6h-3z"/><path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.2 6.8a7.4 7.4 0 0 1 0 10.4"/>'),
    soundOff: wrap('<path d="M4.6 9.4h3L12 5.8v12.4l-4.4-3.6h-3z"/><path d="M16.2 10.2 20.4 14.4M20.4 10.2 16.2 14.4"/>'),
    moon: wrap('<path d="M20 14.4A8.4 8.4 0 1 1 9.6 4a6.8 6.8 0 0 0 10.4 10.4z"/>'),
    sun: wrap('<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.2M12 19v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.8 12H5M19 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>'),
    auto: wrap('<rect x="3" y="4.6" width="18" height="12.4" rx="2.4"/><path d="M8.6 20.4h6.8M12 17v3.4"/><path d="M12 4.6v12.4" stroke-dasharray="2 2.6"/>'),
    lock: wrap('<rect x="4.8" y="10.4" width="14.4" height="9.2" rx="2.4"/><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6"/><path d="M12 14v2.4"/>'),
    away: wrap('<circle cx="12" cy="12" r="8.4" stroke-dasharray="3.4 3.2"/><path d="M12 7.8V12l3.2 2"/>'),
    plug: wrap('<path d="M9 3.6v4M15 3.6v4"/><path d="M6.4 7.6h11.2v3.2a5.6 5.6 0 0 1-11.2 0z"/><path d="M12 16.4v4"/>'),
    chart: wrap('<path d="M4 19.4h16"/><path d="M7.2 19.4v-6M12 19.4V7.6M16.8 19.4v-9"/>'),
    close: wrap('<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/>'),
    chevron: wrap('<path d="M9.2 6.4 15.6 12l-6.4 5.6"/>'),
    minimize: wrap('<path d="M6 12.4h12"/>'),
    sparkle: wrap('<path d="M12 3.6 13.6 9 19 10.6 13.6 12.2 12 17.6 10.4 12.2 5 10.6 10.4 9z"/><path d="M18.4 16.2l.7 2.2 2.2.7-2.2.7-.7 2.2-.7-2.2-2.2-.7 2.2-.7z"/>'),
    timer: wrap('<circle cx="12" cy="13.4" r="7.4"/><path d="M12 9.8v3.6l2.4 1.6M9.2 3.2h5.6"/>'),
    force: wrap('<path d="M12 3.6 4.4 6.8v5.4c0 4.2 3.1 7.3 7.6 8.4 4.5-1.1 7.6-4.2 7.6-8.4V6.8z"/><path d="M9.4 12.2 11.4 14.2l3.6-3.8"/>'),
    info: wrap('<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.2M12 7.9v.1"/>'),
  };
})();

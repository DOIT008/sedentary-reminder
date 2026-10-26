(function () {
  'use strict';

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 秒 -> 27:14 / 1:05:09 */
  function clock(totalSec, { sign = false } = {}) {
    const sec = Math.max(0, Math.round(totalSec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    return sign && h === 0 && m < 1 ? body : body;
  }

  /** 只到分钟，用于“下次提醒 11:23” */
  function hhmm(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function minutes(sec) {
    return Math.round((sec || 0) / 60);
  }

  function dayLabel(key) {
    if (!key) return '';
    const [, m, d] = String(key).split('-');
    return `${Number(m)}/${Number(d)}`;
  }

  function weekday(key) {
    if (!key) return '';
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    return `周${names[new Date(`${key}T12:00:00`).getDay()]}`;
  }

  function since(ts) {
    if (!ts) return '今天还没有';
    const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    return `${Math.round(min / 60)} 小时前`;
  }

  window.SFmt = { clock, hhmm, minutes, dayLabel, weekday, since, pad };
})();

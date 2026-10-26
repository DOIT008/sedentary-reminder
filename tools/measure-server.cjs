'use strict';

/* 面板量测用的最小静态服务器：把真实 Engine 造的 snapshot 用浏览器可读的方式注入，
   让 playwright 能量几何、动画与交互（Electron 里没法改 viewport）。
   node tools/measure-server.cjs [port] */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { Engine, DEFAULT_CONFIG } = require('../src/main/engine.js');

const ROOT = path.join(__dirname, '..');
const MIN = 60000;
const T0 = new Date('2026-10-23T10:12:00').getTime();
const port = Number(process.argv[2] || 8731);

function snapshotFor(scenario) {
  const engine = new Engine({
    now: T0 - 3 * 3600 * 1000,
    config: { ...DEFAULT_CONFIG, ...scenario.config },
    onEvent: () => {},
  });
  for (const [day, focusMin] of Object.entries(scenario.seedHistory || {})) {
    engine.stats.history[day] = {
      focusSec: focusMin * 60,
      breaksDone: Math.round(focusMin / 45),
      breaksSkipped: 0,
      snoozes: 1,
      longestFocusSec: 2700,
    };
  }
  const end = T0 + (scenario.atMin || 0) * MIN;
  let idleSec = 0;
  for (let t = T0 - 3 * 3600 * 1000 + 1000; t <= end; t += 1000) {
    idleSec = scenario.idleAt && t > scenario.idleAt && t < scenario.idleEnd ? 600 : 0;
    engine.tick(t, idleSec);
  }
  const snapshot = engine.snapshot(end, idleSec);
  snapshot.config.theme = scenario.theme;
  return snapshot;
}

const SCENARIOS = {
  focus: { atMin: 25, theme: 'dark' },
  soon: { atMin: 64, theme: 'dark' },
  brk: { atMin: 17, theme: 'dark' },
  away: { atMin: 48, idleAt: T0 + 27 * MIN, idleEnd: T0 + 400 * MIN, theme: 'dark' },
  light: { atMin: 25, theme: 'light', config: { theme: 'light' } },
  trend: {
    atMin: 25,
    theme: 'dark',
    seedHistory: {
      '2026-10-17': 210, '2026-10-18': 305, '2026-10-19': 168,
      '2026-10-20': 352, '2026-10-21': 264, '2026-10-22': 96,
    },
  },
  custom: {
    atMin: 40, theme: 'dark',
    config: { intervalMin: 90, breakMin: 10, snoozeMin: 8, idleThresholdMin: 6, sound: false, autostart: true, lockPostpone: false },
  },
};

// 与 src/preload/index.js 暴露的面一致，只是数据来自静态脚本（CSP 禁了 fetch）
const META = {
  userData: 'C:\\Users\\you\\AppData\\Roaming\\SedentaryReminder',
  version: '1.0.0',
  electron: '33.0.0',
};
const HARNESS_API = `(function(){
  var m = window.__MOCK || {};
  var listeners = [];
  window.sedentary = {
    meta: { mock: true },
    getState: function(){ return Promise.resolve(m.snapshot || {}); },
    setConfig: function(patch){
      m.snapshot = Object.assign({}, m.snapshot, { config: Object.assign({}, m.snapshot.config, patch) });
      return Promise.resolve(m.snapshot);
    },
    command: function(name){
      if (name === 'meta') return Promise.resolve(${JSON.stringify(META)});
      return Promise.resolve(Object.assign({}, m.snapshot, { lastCommand: name }));
    },
    onMessage: function(fn){ listeners.push(fn); return function(){}; }
  };
  window.__measure = {
    emit: function(message){ listeners.slice().forEach(function(fn){ fn(message); }); },
    snapshot: function(){ return m.snapshot; }
  };
})();`;

const ROUTES = {
  'panel/': 'src/renderer/panel/',
  'shared/': 'src/renderer/shared/',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const send = (body, type) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  if (url.pathname === '/harness-mock.js') {
    const key = url.searchParams.get('s') || 'focus';
    const scenario = SCENARIOS[key] || SCENARIOS.focus;
    return send(`window.__MEASURE_SCENARIO = ${JSON.stringify(key)};\nwindow.__MOCK = ${JSON.stringify({ snapshot: snapshotFor(scenario), events: [] })};`, MIME['.js']);
  }
  if (url.pathname === '/harness-api.js') return send(HARNESS_API, MIME['.js']);
  if (url.pathname === '/harness-assert.js') return send(fs.readFileSync(path.join(__dirname, 'measure-assert.js'), 'utf8'), MIME['.js']);

  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  for (const [prefix, dir] of Object.entries(ROUTES)) {
    if (rel.startsWith(prefix)) rel = dir + rel.slice(prefix.length);
  }
  if (rel === '') rel = 'src/renderer/panel/index.html';
  if (rel === 'src/renderer/panel/index.html') {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const inject = '<script src="/harness-mock.js?s=' + (url.searchParams.get('s') || 'focus') + '"></script>'
      + '<script src="/harness-api.js"></script>';
    return send(html.replace('<script src="../shared/icons.js"></script>', inject + '\n    <script src="../shared/icons.js"></script>'), MIME['.html']);
  }
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('404 ' + rel);
  }
  send(fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`measure server on http://127.0.0.1:${port}/panel/index.html?s=focus`);
});

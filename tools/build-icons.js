'use strict';

/* 生成 assets/ 下的 PNG 图标：npm run icons
   electron.exe 是 GUI 子系统程序，stdout 不会回到 bash，所以结果写进日志文件。 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const { buildIconSet, disposeRasterWindow } = require('../src/main/icons.js');

const LOG = path.join(__dirname, 'out', 'build-icons.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (msg) => fs.appendFileSync(LOG, `${msg}\n`);
fs.writeFileSync(LOG, `build-icons start ${new Date().toISOString()} (run-as-node=${process.env.ELECTRON_RUN_AS_NODE || 'unset'})\n`);

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const outDir = path.join(__dirname, '..', 'assets');
    const written = await buildIconSet(outDir);
    for (const w of written) log(`  ${w.file.padEnd(20)} ${w.bytes} bytes`);
    const win = new BrowserWindow({ width: 720, height: 470, show: false, webPreferences: { offscreen: true } });
    await win.loadFile(path.join(outDir, 'icon-sheet-preview.html'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const png = (await win.capturePage()).toPNG();
    fs.writeFileSync(path.join(outDir, 'icon-sheet-preview.png'), png);
    log(`OK ${written.length} icons + sheet (${png.length} bytes)`);
    disposeRasterWindow();
  } catch (err) {
    log(`FAIL ${err.stack || err.message}`);
    disposeRasterWindow();
    app.exit(1);
    return;
  }
  app.quit();
});

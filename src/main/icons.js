'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PALETTES = {
  focus: ['#5eead4', '#38bdf8', '#6366f1'],
  break: ['#fcd34d', '#fb923c', '#f43f5e'],
  idle: ['#cbd5e1', '#94a3b8', '#64748b'],
  paused: ['#a5b4fc', '#818cf8', '#6366f1'],
};

function wrap(inner, size, viewBox) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">${inner}</svg>`;
}

function defs(key, id) {
  const [a, b, c] = PALETTES[key];
  return `<defs>
<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/>
</linearGradient>
<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.05"/><stop offset="1" stop-color="#000000" stop-opacity="0.12"/>
</linearGradient>
</defs>`;
}

/** 托盘/窗口用的小图标:地面线 + 起身箭头(或暂停双竖线) */
function traySvg(key, size, variant) {
  const g = `${key}${size}`;
  const body = variant === 'paused'
    ? `<g stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.96">
<path d="M13 10.5V22"/><path d="M19 10.5V22"/></g>`
    : `<g fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.97">
<path d="M10.5 23.5h11" stroke-opacity="0.6"/>
<path d="M16 19.5V9"/>
${variant === 'idle' ? '<path d="M11.4 13.6 16 9l4.6 4.6" stroke-dasharray="3 3"/>' : '<path d="M11.4 13.6 16 9l4.6 4.6"/>'}
</g>`;
  const inner = `${defs(key, g)}
<rect x="2.2" y="2.2" width="27.6" height="27.6" rx="8.4" fill="url(#${g})"/>
<rect x="2.2" y="2.2" width="27.6" height="27.6" rx="8.4" fill="url(#${g}s)"/>
${body}`;
  return wrap(inner, size, '0 0 32 32');
}

/** 512 应用图标：渐变圆角方块 + 起身人形 + 与界面同款的进度环 */
function appSvg(size) {
  const g = 'app';
  const inner = `${defs('focus', g)}
<rect x="24" y="24" width="464" height="464" rx="118" fill="url(#${g})"/>
<rect x="24" y="24" width="464" height="464" rx="118" fill="url(#${g}s)"/>
<rect x="27" y="27" width="458" height="458" rx="115" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="3"/>
<circle cx="256" cy="256" r="152" fill="none" stroke="#04121f" stroke-opacity="0.14" stroke-width="18"/>
<path d="M256 104A152 152 0 1 1 113.2 308" fill="none" stroke="#ffffff" stroke-opacity="0.62" stroke-width="18" stroke-linecap="round"/>
<circle cx="113.2" cy="308" r="13" fill="#ffffff" fill-opacity="0.85"/>
<ellipse cx="256" cy="386" rx="96" ry="13" fill="#04121f" fill-opacity="0.16"/>
<g stroke="#ffffff" stroke-width="28" stroke-linecap="round" fill="none">
<path d="M256 230v88"/>
<path d="M256 248l-48 28M256 248l48 28"/>
<path d="M256 318l-36 62M256 318l36 62"/>
</g>
<circle cx="256" cy="178" r="36" fill="#ffffff"/>`;
  return wrap(inner, size, '0 0 512 512');
}

/** 遮罩窗口左上角/标题用的小圆点图标 */
function badgeSvg(size) {
  const g = 'badge';
  const inner = `${defs('focus', g)}
<circle cx="32" cy="32" r="30" fill="url(#${g})"/>
<g fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
<path d="M22 44h20" stroke-opacity="0.65"/>
<path d="M32 36V19"/>
<path d="M24.5 26.5 32 19l7.5 7.5"/>
</g>`;
  return wrap(inner, size, '0 0 64 64');
}

const ICON_SET = [
  { file: 'app-512.png', svg: () => appSvg(512), size: 512 },
  { file: 'app-256.png', svg: () => appSvg(256), size: 256 },
  { file: 'badge-64.png', svg: () => badgeSvg(64), size: 64 },
  ...['focus', 'break', 'idle', 'paused'].flatMap((key) => [
    { file: `tray-${key}-16.png`, svg: () => traySvg(key, 16, key), size: 16 },
    { file: `tray-${key}-32.png`, svg: () => traySvg(key, 32, key), size: 32 },
  ]),
];

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

let rasterWindow = null;

async function ensureRasterWindow(electron) {
  const { BrowserWindow } = electron;
  if (rasterWindow && !rasterWindow.isDestroyed()) return rasterWindow;
  rasterWindow = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    skipTaskbar: true,
    webPreferences: { sandbox: true },
  });
  await rasterWindow.loadURL('about:blank');
  return rasterWindow;
}

function isBlankPng(electron, png, size) {
  const image = electron.nativeImage.createFromBuffer(png);
  if (image.isEmpty()) return true;
  const { width, height } = image.getSize();
  if (width !== size || height !== size) return true;
  const bitmap = image.getBitmap();
  let opaque = 0;
  for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i] > 8) opaque += 1;
  return opaque < width * height * 0.02;
}

/** 用 canvas 把 SVG 画成 PNG：不依赖窗口是否真的在合成，隐藏窗口也能出图 */
async function rasterize(electron, svg, size) {
  const win = await ensureRasterWindow(electron);
  const source = svgDataUrl(svg);
  const script = `(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(source)};
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = ${size};
    canvas.height = ${size};
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, ${size}, ${size});
    ctx.drawImage(img, 0, 0, ${size}, ${size});
    const url = canvas.toDataURL('image/png');
    return url.slice(url.indexOf(',') + 1);
  })()`;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const b64 = await Promise.race([
        win.webContents.executeJavaScript(script, true),
        new Promise((_, reject) => setTimeout(() => reject(new Error('rasterize 超时')), 8000)),
      ]);
      const png = Buffer.from(b64, 'base64');
      if (png.length > 64 && !isBlankPng(electron, png, size)) return png;
      lastErr = new Error(`结果过小或全透明 (${size}px)`);
    } catch (err) {
      lastErr = err;
      if (win.isDestroyed()) rasterWindow = null;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastErr;
}

async function buildIconSet(outDir) {
  const electron = require('electron');
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const icon of ICON_SET) {
    const png = await rasterize(electron, icon.svg(), icon.size);
    const file = path.join(outDir, icon.file);
    fs.writeFileSync(file, png);
    written.push({ file: icon.file, bytes: png.length });
  }
  return written;
}

/** 运行期读取 assets；缺文件就地补齐（离线生成失败也不会没有图标） */
async function resolveIcons(assetsDir) {
  const electron = require('electron');
  const missing = ICON_SET.filter((icon) => {
    const file = path.join(assetsDir, icon.file);
    try {
      return fs.statSync(file).size < 64;
    } catch {
      return true;
    }
  });
  for (const icon of missing) {
    try {
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, icon.file), await rasterize(electron, icon.svg(), icon.size));
    } catch (err) {
      console.error(`[icons] ${icon.file} 生成失败:`, err.message);
    }
  }
  const paths = {};
  for (const icon of ICON_SET) {
    const file = path.join(assetsDir, icon.file);
    paths[icon.file.replace(/\.png$/, '')] = fs.existsSync(file) ? file : null;
  }
  return paths;
}

function disposeRasterWindow() {
  if (rasterWindow && !rasterWindow.isDestroyed()) rasterWindow.destroy();
  rasterWindow = null;
}

module.exports = { ICON_SET, appSvg, traySvg, badgeSvg, PALETTES, rasterize, buildIconSet, resolveIcons, disposeRasterWindow };

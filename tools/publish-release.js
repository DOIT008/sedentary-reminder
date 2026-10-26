'use strict';

/* 把 npm run package 的产物发布成 GitHub Release：npm run release
   - 凭据只从 git credential helper 取（git credential fill），不落盘、不打印
   - 版本号取 package.json，产物名沿用 electron-builder 的中文 artifactName，上传时改成 ASCII 名
   - 可重复跑：已存在的 release 会复用，同名同大小的附件会跳过 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { version } = require('../package.json');
const OWNER = process.env.SR_GH_OWNER || 'DOIT008';
const REPO = process.env.SR_GH_REPO || 'sedentary-reminder';
const TAG = `v${version}`;
const DIST = process.env.SR_OUT || 'E:\\builds\\sedentary-reminder';
const ASSETS = [
  { src: path.join(DIST, `久坐提醒-安装版-${version}.exe`), name: `SedentaryReminder-Setup-${version}.exe`, label: '安装版（NSIS，含卸载入口）' },
  { src: path.join(DIST, `久坐提醒-便携版-${version}.exe`), name: `SedentaryReminder-Portable-${version}.exe`, label: '便携版（单文件，免安装）' },
];

const NOTES = [
  '首个可用的 Windows 版本。到点弹全屏呼吸遮罩提醒你起身休息，纯本地运行，不联网、不上传任何数据。',
  '',
  '## 下哪个',
  '',
  '| 文件 | 适合 |',
  '| --- | --- |',
  `| \`SedentaryReminder-Setup-${version}.exe\` | 长期用：可选安装目录，创建开始菜单/桌面快捷方式和卸载入口 |`,
  `| \`SedentaryReminder-Portable-${version}.exe\` | 不想装：单文件拷到哪跑到哪，不写注册表 |`,
  '',
  '需要 Windows 10/11 x64。',
  '',
  '## 首次运行的 SmartScreen 提示',
  '',
  '二进制没有代码签名证书，Windows 会弹「未知发布者」。点「更多信息 → 仍要运行」即可。',
  '介意的话可以 clone 源码自己 `npm install --include=dev && npm run package`，产物逻辑与这里完全一致。',
  '',
  '## 校验和（SHA-256）',
  '',
];

function token() {
  const r = spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error('拿不到 github.com 凭据');
  const out = {};
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('=');
    // Windows 上输出是 CRLF，尾巴带 \r 会让 fetch 直接报 fetch failed
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/\r$/, '');
  }
  if (!out.password) throw new Error('凭据里没有 password 字段');
  return out.password;
}

const H = {
  Authorization: `token ${token()}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'sedentary-reminder-release',
};
const API = 'https://api.github.com';

async function api(method, url, body, extraHeaders = {}, extraInit = {}) {
  const res = await fetch(url, { method, headers: { ...H, ...extraHeaders }, body, ...extraInit });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const sha256 = (file) => new Promise((res) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex')));
});

(async () => {
  const sizes = {};
  const sums = {};
  for (const a of ASSETS) {
    if (!fs.existsSync(a.src)) throw new Error(`找不到产物 ${a.src}，先跑 npm run package`);
    sizes[a.name] = fs.statSync(a.src).size;
    sums[a.name] = await sha256(a.src);
    console.log(`${a.name}  ${(sizes[a.name] / 1048576).toFixed(1)} MB  sha256=${sums[a.name].slice(0, 16)}…`);
  }

  const body = NOTES.join('\n')
    + ASSETS.map((a) => `- \`${a.name}\`\n  \`${sums[a.name]}\``).join('\n')
    + '\n\n'
    + fs.readFileSync(path.join(__dirname, '..', 'RELEASE-NOTES.md'), 'utf8').trim();

  let rel = null;
  try {
    rel = await api('GET', `${API}/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
    console.log('已存在 release，复用:', rel.html_url);
  } catch {
    rel = await api('POST', `${API}/repos/${OWNER}/${REPO}/releases`, JSON.stringify({
      tag_name: TAG, name: `${TAG}`, body, draft: false, prerelease: false,
    }), { 'Content-Type': 'application/json' });
    console.log('创建 release:', rel.html_url);
  }

  const existing = await api('GET', rel.assets_url);
  for (const a of ASSETS) {
    if (existing.some((x) => x.name === a.name && x.size === sizes[a.name])) {
      console.log('跳过（已上传）:', a.name);
      continue;
    }
    const url = `${rel.upload_url.replace(/\{[^}]*\}(\?.*)?$/, '')}?name=${encodeURIComponent(a.name)}&label=${encodeURIComponent(a.label)}`;
    const t0 = Date.now();
    const r = await api('POST', url, fs.createReadStream(a.src), {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(sizes[a.name]),
    }, { duplex: 'half' });
    console.log(`上传完成: ${r.name}  ${(sizes[a.name] / 1048576).toFixed(1)} MB / ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const finalRel = await api('GET', `${API}/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
  console.log('\nrelease:', finalRel.html_url);
  for (const a of finalRel.assets) console.log(` - ${a.name} ${(a.size / 1048576).toFixed(1)} MB -> ${a.browser_download_url}`);
})().catch((err) => {
  console.error('发布失败:', err.message);
  process.exitCode = 1;
});

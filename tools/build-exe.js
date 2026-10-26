'use strict';

/* 打成 Windows exe：npm run package
   产物 -> E:\builds\sedentary-reminder（C: 长期紧张，构建缓存也放 E:）
   首次运行要下载 nsis / winCodeSign / 7zip，走 npmmirror 镜像 */
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.SR_OUT || 'E:/builds/sedentary-reminder';
const CACHE = process.env.ELECTRON_BUILDER_CACHE || 'E:/electron-builder-cache';

const env = { ...process.env };
// 从 Qoder 进程树继承下来的话，被拉起的 electron.exe 会退化成普通 node
delete env.ELECTRON_RUN_AS_NODE;
env.ELECTRON_BUILDER_CACHE = CACHE;
env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';

const bin = path.join(ROOT, 'node_modules', '.bin', 'electron-builder.cmd');
const args = ['--win', `--config.directories.output=${OUT}`];

console.log(`electron-builder --win -> ${OUT}\ncache: ${CACHE}`);
const child = spawn(bin, args, { cwd: ROOT, env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code == null ? 1 : code));

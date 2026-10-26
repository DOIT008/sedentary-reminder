'use strict';

/* 生成两个启动入口：
     启动久坐提醒.vbs —— 双击用，不带黑框（wscript 按 UTF-16LE 读，中文注释才不会乱码）
     启动久坐提醒.bat —— 真正的启动逻辑（cmd 里才能真删掉 ELECTRON_RUN_AS_NODE）
   源文本放 tools/launcher-*-source.txt（UTF-8，方便 diff），这里只填绝对路径和转码。
   bat 必须落盘成 GBK：cmd 按字节偏移逐行读批处理，UTF-8 中文会让它错位、把 rem 的后半截当命令执行。*/

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function fill(srcName) {
  return fs
    .readFileSync(path.join(__dirname, srcName), 'utf8')
    .replace(/__APP_DIR__/g, ROOT)
    .replace(/\r?\n/g, '\r\n');
}

function report(file) {
  console.log('已生成', file, `(${fs.statSync(file).size} bytes)`);
}

const vbsFile = path.join(ROOT, '启动久坐提醒.vbs');
fs.writeFileSync(vbsFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(fill('launcher-vbs-source.txt'), 'utf16le')]));
report(vbsFile);

const batFile = path.join(ROOT, '启动久坐提醒.bat');
const utf8Tmp = path.join(os.tmpdir(), `sedentary-launcher-${process.pid}.utf8`);
fs.writeFileSync(utf8Tmp, fill('launcher-bat-source.txt'), 'utf8');
const ps = [
  '$t=[IO.File]::ReadAllText(',
  `'${utf8Tmp}',[Text.Encoding]::UTF8);`,
  `[IO.File]::WriteAllText('${batFile}',$t,[Text.Encoding]::GetEncoding(936));`,
  `Remove-Item '${utf8Tmp}'`,
].join('');
const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, encoding: 'utf8' });
if (res.status !== 0) throw new Error(`bat 转 GBK 失败：${res.stderr}`);
report(batFile);

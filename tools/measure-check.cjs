'use strict';

/* 量测门禁：读 tools/out/ 下的量测结果（playwright evaluate 落盘），有任何 FAIL 就 exit 1
   node tools/measure-check.cjs [文件...]   不给文件时跑全套 */
const fs = require('node:fs');
const path = require('node:path');

const ALL = [
  'measure-layout-920.json',
  'measure-layout-760.json',
  'measure-interact.json',
  'measure-motion.json',
  'measure-contrast.json',
].map((f) => path.join(__dirname, 'out', f));

const files = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

function flatten(value, out) {
  if (Array.isArray(value)) {
    for (const v of value) flatten(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    if (typeof value.pass === 'boolean' && value.name) out.push(value);
    else for (const v of Object.values(value)) flatten(v, out);
    return;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
      try { flatten(JSON.parse(t), out); } catch { /* 非 JSON 字符串忽略 */ }
    }
  }
}

const rows = [];
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`MISSING ${file}`);
    process.exit(1);
  }
  flatten(JSON.parse(fs.readFileSync(file, 'utf8')), rows);
}

if (!rows.length) {
  console.error('没有读到任何断言结果');
  process.exit(1);
}

const seen = new Map();
for (const r of rows) if (!seen.has(r.name)) seen.set(r.name, r);
const list = [...seen.values()];
const failed = list.filter((r) => !r.pass);

for (const r of list) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name.padEnd(34)} ${r.detail || ''}`);
console.log(`\n${list.length} assertions, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);

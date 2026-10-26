'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 单个 JSON 文件 + 临时文件改名，写入防抖，退出时强制落盘 */
class Store {
  constructor(file) {
    this.file = file;
    this.timer = null;
    this.pending = null;
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[store] 读取失败，使用空状态:', err.message);
      return null;
    }
  }

  write(data) {
    this.pending = data;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 800);
    this.timer.unref?.();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending === null) return;
    const payload = JSON.stringify(this.pending, null, 2);
    this.pending = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, payload, 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] 写入失败:', err.message);
    }
  }
}

module.exports = { Store };

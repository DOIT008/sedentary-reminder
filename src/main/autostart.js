'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const LNK_NAME = 'SedentaryReminder.lnk';

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** wscript 用 UTF-16LE 读取，路径里有中文也不会乱码 */
function writeLauncherVbs(file, electronExe, appDir) {
  const body = `Set sh = CreateObject("WScript.Shell")\r\nsh.Run """${electronExe}"" ""${appDir}""", 0, False\r\n`;
  fs.writeFileSync(file, Buffer.from(`﻿${body}`, 'utf16le'));
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(String(stdout).trim()))
    );
  });
}

/** Electron 33 没有 app.getPath('startup')，自己按 %APPDATA% 推当前用户的启动文件夹 */
function startupFolder() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

class Autostart {
  constructor({ startupDir, userDataDir }) {
    this.lnk = path.join(startupDir || startupFolder(), LNK_NAME);
    this.vbs = path.join(userDataDir, 'autostart-launcher.vbs');
  }

  async isEnabled() {
    try {
      return fs.statSync(this.lnk).size > 0;
    } catch {
      return false;
    }
  }

  /**
   * 开发态要启动的是「electron.exe + 项目目录」两个参数，中间隔一层 vbs 才传得进去；
   * appDir 为空表示直接链接可执行文件本身（打包后的 exe 自己就知道要跑哪个应用）。
   */
  async enable(exe, appDir) {
    fs.mkdirSync(path.dirname(this.lnk), { recursive: true });
    let target = exe;
    let args = '';
    let workingDir = appDir || path.dirname(exe);
    if (appDir) {
      fs.mkdirSync(path.dirname(this.vbs), { recursive: true });
      writeLauncherVbs(this.vbs, exe, appDir);
      target = `${process.env.windir || 'C:\\Windows'}\\System32\\wscript.exe`;
      args = `"${this.vbs}"`;
    }
    const script = [
      `$ws = New-Object -ComObject WScript.Shell`,
      `$sc = $ws.CreateShortcut(${psQuote(this.lnk)})`,
      `$sc.TargetPath = ${psQuote(target)}`,
      `$sc.Arguments = ${psQuote(args)}`,
      `$sc.WorkingDirectory = ${psQuote(workingDir)}`,
      `$sc.Description = '久坐提醒'`,
      '$sc.Save()',
    ].join('; ');
    await runPowerShell(script);
    return { enabled: true, lnk: this.lnk, target, args };
  }

  /** 只删我们自己命名的那一个快捷方式 */
  async disable() {
    if (!fs.existsSync(this.lnk)) return { enabled: false, removed: false };
    fs.rmSync(this.lnk, { force: true });
    return { enabled: false, removed: true, lnk: this.lnk };
  }
}

module.exports = { Autostart, LNK_NAME, startupFolder };

"use strict";
// Crash-safe desktop preferences. Backups contain the same protected secrets as
// the main file and must never be included in diagnostics or source archives.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseConfig(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('配置必须为 JSON 对象');
  }
  for (const key of ['sessionSecret', 'sessionSecretEnc']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error('会话密钥格式无效');
    }
  }
  return value;
}

function readCandidate(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    if (err.code === 'ENOENT') return { missing: true };
    throw err; // Permission/I/O failures must not silently reset preferences.
  }
  try { return { value: parseConfig(text), text }; }
  catch (_) { return { invalid: true }; }
}

function readConfig(file) {
  const primary = readCandidate(file);
  if (primary.value) return { config: primary.value, recovered: false };
  const backup = readCandidate(file + '.bak');
  if (backup.value) return { config: backup.value, recovered: true };
  if (primary.missing && backup.missing) return { config: {}, recovered: false };
  throw new Error('桌面配置与备份无法读取。原文件已保留，请备份数据目录后修复 desktop-config.json；不会自动重置密钥或删除数据。');
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}

function writeConfig(file, config) {
  const text = JSON.stringify(config, null, 2);
  parseConfig(text); // Reject bad values before touching either file.
  const primary = readCandidate(file);
  if (primary.value) atomicWrite(file + '.bak', primary.text);
  else {
    // Recovered configurations may replace corrupt primary files, but must not
    // rotate that corruption over the sole known-good backup.
    const backup = readCandidate(file + '.bak');
    if ((primary.invalid || backup.invalid) && !backup.value) {
      throw new Error('配置损坏且无有效备份，已停止写入并保留原文件。');
    }
  }
  atomicWrite(file, text);
}

module.exports = { readConfig, writeConfig };

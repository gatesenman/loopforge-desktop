'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');
const { addFile, addFileFromDisk, writeZip, walkDir } = require('./zipfile');

const SECRET_KEYS = /secret|token|password|passwd|credential|cookie|authorization|api[_-]?key/i;

function sanitizeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (SECRET_KEYS.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = sanitizeConfig(v);
    else out[k] = v;
  }
  return out;
}

function tailFile(file, maxBytes) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const size = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, Math.max(0, st.size - size));
    fs.closeSync(fd);
    return buf;
  } catch (_) {
    return Buffer.from('');
  }
}

async function exportDiagnostics({ dataDir, logDir, config, checks, getVersions }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultPath = path.join(app.getPath('desktop'), `LoopForge-diagnostics-${stamp}.zip`);
  const picked = await dialog.showSaveDialog({
    title: '导出诊断包',
    defaultPath,
    filters: [{ name: 'Zip', extensions: ['zip'] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  const entries = [];
  const versions = typeof getVersions === 'function' ? getVersions() : {
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    packaged: app.isPackaged,
  };
  addFile(entries, 'versions.json', JSON.stringify(versions, null, 2) + '\n');
  addFile(entries, 'desktop-config.sanitized.json', JSON.stringify(sanitizeConfig(config), null, 2) + '\n');
  if (checks) addFile(entries, 'envcheck.json', JSON.stringify(checks, null, 2) + '\n');
  const logFile = path.join(logDir, 'server.log');
  if (fs.existsSync(logFile)) addFile(entries, 'logs/server.log', tailFile(logFile, 2 * 1024 * 1024));
  const prev = path.join(logDir, 'server.log.1');
  if (fs.existsSync(prev)) addFile(entries, 'logs/server.log.1', tailFile(prev, 1024 * 1024));
  addFile(entries, 'README.txt', [
    'LoopForge Desktop diagnostics package.',
    'This archive does not include session secrets, tokens, or passwords.',
    `Created: ${new Date().toISOString()}`,
    `Data directory: ${dataDir}`,
    '',
  ].join('\n'));
  writeZip(entries, picked.filePath);
  return picked.filePath;
}

async function backupDataDir({ dataDir, config }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultPath = path.join(app.getPath('desktop'), `LoopForge-backup-${stamp}.zip`);
  const picked = await dialog.showSaveDialog({
    title: '备份数据目录',
    defaultPath,
    filters: [{ name: 'Zip', extensions: ['zip'] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  const entries = [];
  addFile(entries, 'desktop-config.sanitized.json', JSON.stringify(sanitizeConfig(config), null, 2) + '\n');
  const skip = (rel) => {
    const base = rel.split('/').pop();
    if (base === 'desktop-config.json') return true; // replaced by sanitized copy
    if (SECRET_KEYS.test(base)) return true;
    if (base.endsWith('.tmp') || base === '.write-test') return true;
    return false;
  };
  for (const item of walkDir(dataDir, skip)) {
    try { addFileFromDisk(entries, item.name, item.file); } catch (_) { /* unreadable file */ }
  }
  writeZip(entries, picked.filePath);
  return picked.filePath;
}

module.exports = { sanitizeConfig, exportDiagnostics, backupDataDir };

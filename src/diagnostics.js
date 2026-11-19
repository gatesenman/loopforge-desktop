 'use strict';
// Do not export arbitrary logs, config/extraEnv, database, or workspace data.
// Redaction cannot reliably recognize every credential. Use strict allowlists.
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { addFile, writeZip } = require('./zipfile');
const { sanitizeConfig, sanitizeChecks, lifecycleSummary } = require('./redaction');
async function exportDiagnostics({ logDir, config, checks }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const picked = await dialog.showSaveDialog({
    title: '导出诊断包（不含原始日志）',
    defaultPath: path.join(app.getPath('desktop'), `LoopForge-diagnostics-${stamp}.zip`),
    filters: [{ name: 'Zip', extensions: ['zip'] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  const entries = [];
  addFile(entries, 'versions.json', JSON.stringify({ app: app.getVersion(),
    electron: process.versions.electron, node: process.versions.node,
    platform: process.platform, arch: process.arch }, null, 2));
  addFile(entries, 'desktop-config.sanitized.json', JSON.stringify(sanitizeConfig(config), null, 2));
  addFile(entries, 'envcheck.json', JSON.stringify(sanitizeChecks(checks), null, 2));
  let log = '';
  try {
    const file = path.join(logDir, 'server.log');
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(size, 1024 * 1024));
      fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
      log = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch (_) { /* optional */ }
  addFile(entries, 'logs/lifecycle.json', JSON.stringify(lifecycleSummary(log), null, 2));
  addFile(entries, 'README.txt', 'Raw logs, config/extraEnv, credentials, database and workspaces are deliberately excluded. Lifecycle counts only.');
  writeZip(entries, picked.filePath);
  return picked.filePath;
}
module.exports = { exportDiagnostics };

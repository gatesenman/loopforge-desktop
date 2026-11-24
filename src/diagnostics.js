 'use strict';
// Do not export arbitrary logs, config/extraEnv, database, or workspace data.
// Redaction cannot reliably recognize every credential. Use strict allowlists.
const path = require('path');
const { app, dialog } = require('electron');
const { addFile, writeZip } = require('./zipfile');
const { readTail } = require('./log-store');
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
  const log = readTail(path.join(logDir, 'server.log'), 1024 * 1024);
  addFile(entries, 'logs/lifecycle.json', JSON.stringify(lifecycleSummary(log), null, 2));
  addFile(entries, 'README.txt', 'Raw logs, config/extraEnv, credentials, database and workspaces are deliberately excluded. Lifecycle counts only.');
  writeZip(entries, picked.filePath);
  return picked.filePath;
}
module.exports = { exportDiagnostics };

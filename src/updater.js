'use strict';
// GitHub Releases auto-update. The installer is unsigned unless CSC_LINK is used at build time.
const { app, dialog } = require('electron');

function setupAutoUpdate({ isWin, getWindow, log, onInstall }) {
  const api = {
    check: async (manual) => {
      if (manual) dialog.showMessageBox({ type: 'info', message: '当前构建未包含自动更新模块。' });
    },
  };
  if (!app.isPackaged) return api;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    if (log) log('electron-updater not available: ' + (e && e.message));
    return api;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  // Builds are typically unsigned. Do not pretend a signature will be verified.
  if (isWin) {
    autoUpdater.verifyUpdateCodeSignature = false;
  }
  autoUpdater.on('error', (err) => { if (log) log('auto-update: ' + String(err && err.message || err)); });
  autoUpdater.on('update-downloaded', (info) => {
    const win = getWindow && getWindow();
    const version = (info && info.version) || '';
    const opts = {
      type: 'info',
      buttons: ['立即重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: 'LoopForge 更新',
      message: version ? `新版本 ${version} 已下载` : '新版本已下载',
      detail: '请先保存工作再重启安装。安装包默认没有代码签名，Windows SmartScreen 可能在重启后再次提示，选择“仍要运行”即可。不会在你工作中途自动重启。',
    };
    const p = win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
    p.then(({ response }) => {
      if (response === 0) {
        Promise.resolve(onInstall && onInstall()).then(() => autoUpdater.quitAndInstall(false, true));
      }
    }).catch(() => { /* ignore */ });
  });
  api.check = async (manual) => {
    try {
      const result = await autoUpdater.checkForUpdates();
      const update = result && result.updateInfo;
      const available = update && update.version && update.version !== app.getVersion();
      // electron-updater also sets downloadPromise when an update exists.
      if (manual && !available) {
        const win = getWindow && getWindow();
        const opts = { type: 'info', title: '检查更新', message: `当前已是最新版本（${app.getVersion()}）` };
        if (win) dialog.showMessageBox(win, opts);
        else dialog.showMessageBox(opts);
      }
      return result;
    } catch (e) {
      if (log) log('auto-update check failed: ' + String(e && e.message || e));
      if (manual) {
        const win = getWindow && getWindow();
        const opts = {
          type: 'warning',
          title: '检查更新失败',
          message: '暂时无法检查更新。',
          detail: String(e && e.message || e) + '\n\n可稍后从 GitHub Releases 手动下载。安装包默认没有代码签名。',
        };
        if (win) dialog.showMessageBox(win, opts);
        else dialog.showMessageBox(opts);
      }
    }
  };
  // Defer the first check so it does not contend with sidecar startup.
  setTimeout(() => { api.check(false); }, 12000);
  return api;
}

module.exports = { setupAutoUpdate };

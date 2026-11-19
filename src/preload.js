'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('loopforgeDesktop', {
  check: () => ipcRenderer.invoke('env:check'),
  action: (a) => ipcRenderer.invoke('env:action', a),
  setMirror: (on) => ipcRenderer.invoke('env:setMirror', on),
  setMode: (m) => ipcRenderer.invoke('env:setMode', m),
  done: () => ipcRenderer.invoke('env:done'),
  retry: () => ipcRenderer.invoke('app:retry'),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  openEnvCheck: () => ipcRenderer.invoke('app:openEnv'),
  onActionLog: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('env:action-log', fn);
    return () => ipcRenderer.removeListener('env:action-log', fn);
  },
});

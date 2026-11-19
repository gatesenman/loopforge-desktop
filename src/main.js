'use strict';
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { runChecks, pathKey } = require('./envcheck');

const isWin = process.platform === 'win32';
app.setName('LoopForge');
// Keep data in %APPDATA%\LoopForge regardless of the package name.
app.setPath('userData', path.join(app.getPath('appData'), 'LoopForge'));

const DATA = app.getPath('userData');
const LOG_DIR = path.join(DATA, 'logs');
const CONFIG_PATH = path.join(DATA, 'desktop-config.json');
const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'dev-resources');
const BIN = path.join(RES, 'bin');
const GIT_DIR = path.join(RES, 'runtime', 'git');
const NODE_DIR = path.join(RES, 'runtime', 'node');
const PYTHON_DIR = path.join(RES, 'runtime', 'python');

let mainWindow = null;
let server = null; // { proc, port, url, stopping }
let serverLog = null;
let quitting = false;

// ---------- config ----------
function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { /* first run */ }
  let dirty = false;
  if (!cfg.sessionSecret) { cfg.sessionSecret = crypto.randomBytes(32).toString('hex'); dirty = true; }
  if (!cfg.port) { cfg.port = 18090; dirty = true; }
  cfg.runtimeMode = 'local'; // desktop build is host-only; Docker is not offered
  if (cfg.npmMirror === undefined) { cfg.npmMirror = true; dirty = true; }
  if (dirty) saveConfig(cfg);
  return cfg;
}
function saveConfig(cfg) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
let config;

// ---------- environment ----------
function childEnv() {
  const env = { ...process.env };
  const key = pathKey(env);
  const current = env[key] || '';
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path' && k !== key) delete env[k];
  const extra = [];
  if (isWin) {
    extra.push(path.join(GIT_DIR, 'cmd'), path.join(GIT_DIR, 'usr', 'bin'), path.join(GIT_DIR, 'ucrt64', 'bin'), path.join(GIT_DIR, 'mingw64', 'bin'));
    extra.push(NODE_DIR);
    extra.push(PYTHON_DIR);
    extra.push(path.join(PYTHON_DIR, 'Scripts'));
    if (env.APPDATA) extra.push(path.join(env.APPDATA, 'npm')); // npm -g prefix of the bundled node
    if (env.USERPROFILE) extra.push(path.join(env.USERPROFILE, '.local', 'bin'));
  }
  extra.push(path.join(DATA, 'cli', 'bin'));
  env[key] = [...extra.filter((d) => fs.existsSync(d)), current].join(path.delimiter);
  return env;
}

function serverEnv(port) {
  const env = childEnv();
  const ext = isWin ? '' : '';
  Object.assign(env, {
    AGENTFLOW_SQLITE_PATH: path.join(DATA, 'db', 'loopforge.db'),
    AGENTFLOW_SESSION_SECRET: config.sessionSecret,
    AGENTFLOW_HTTP_PORT: String(port),
    AGENTFLOW_AUTH_REQUIRED: 'true',
    AGENTFLOW_ALLOW_SIGNUP: 'false', // the first account (admin) is always allowed
    AGENTFLOW_SECURE_COOKIES: 'false',
    AGENTFLOW_ASSISTANT_SESSION_DIR: path.join(DATA, 'assistant'),
    AGENTFLOW_CONVERSATION_DIR: path.join(DATA, 'conversations'),
    AGENTFLOW_CLARIFY_SESSION_DIR: path.join(DATA, 'clarify'),
    AGENTFLOW_RUNTIME_CLI_DIR: path.join(DATA, 'cli'),
    AGENTFLOW_MANAGED_CLI_ROOT: path.join(DATA, 'managed-cli'),
    AGENTFLOW_RUNNER_BINARY: path.join(BIN, 'agentflow-runner-{os}-{arch}' + ext),
    AGENTFLOW_GATE_MCP_BINARY: path.join(BIN, 'agentflow-gate-mcp-{os}-{arch}' + ext),
    LOOPFORGE_DESKTOP: '1',
    AGENTFLOW_DISABLE_DOCKER: '1',
  });
  delete env.AGENTFLOW_LOCAL_SANDBOX;
  delete env.AGENTFLOW_ISOLATED_IMAGE;
  if (isWin) {
    env.CHERE_INVOKING = '1';
    env.MSYS2_PATH_TYPE = env.MSYS2_PATH_TYPE || 'inherit';
  }
  for (const [k, v] of Object.entries(config.extraEnv || {})) {
    if (/^AGENTFLOW_(LOCAL_SANDBOX|ISOLATED_IMAGE|DOCKER_NETWORK)$/.test(k)) continue;
    env[k] = String(v);
  }
  return env;
}

// ---------- server ----------
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}
async function pickPort() {
  if (await portFree(config.port)) return config.port;
  for (let p = 18091; p < 18190; p++) {
    if (await portFree(p)) { config.port = p; saveConfig(config); return p; }
  }
  throw new Error('找不到可用端口（18090-18190）');
}

function openLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, 'server.log');
  try { if (fs.statSync(file).size > 10 * 1024 * 1024) fs.renameSync(file, file + '.1'); } catch (_) { /* none */ }
  return fs.createWriteStream(file, { flags: 'a' });
}
function tailLog(lines = 40) {
  try { return fs.readFileSync(path.join(LOG_DIR, 'server.log'), 'utf8').split(/\r?\n/).slice(-lines).join('\n'); } catch (_) { return ''; }
}

function serverBinary() {
  if (process.env.LOOPFORGE_SERVER_BIN) return process.env.LOOPFORGE_SERVER_BIN;
  return path.join(BIN, isWin ? 'agentflow.exe' : 'agentflow');
}

async function startServer() {
  const port = await pickPort();
  const bin = serverBinary();
  if (!fs.existsSync(bin)) throw new Error(`缺少服务程序：${bin}`);
  for (const d of ['db', 'workspaces', 'assistant', 'conversations', 'clarify', 'cli']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
  serverLog = openLog();
  serverLog.write(`\n===== ${new Date().toISOString()} starting ${bin} on 127.0.0.1:${port} (runtime=local, docker=off) =====\n`);
  const proc = spawn(bin, ['-addr', `127.0.0.1:${port}`, '-workspaces', path.join(DATA, 'workspaces')], {
    cwd: DATA, env: serverEnv(port), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const s = { proc, port, url: `http://127.0.0.1:${port}`, stopping: false, exited: false };
  server = s;
  proc.stdout.on('data', (b) => serverLog && serverLog.write(b));
  proc.stderr.on('data', (b) => serverLog && serverLog.write(b));
  proc.on('exit', (code, sig) => {
    s.exited = true;
    if (serverLog) serverLog.write(`===== server exited code=${code} signal=${sig} =====\n`);
    if (!s.stopping && !quitting && server === s) {
      showError('LoopForge 服务意外退出', `退出码：${code}\n\n${tailLog()}`);
    }
  });
  await waitHealthy(s, 120000);
  return s;
}

async function waitHealthy(s, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (s.exited) throw new Error('服务启动失败：\n' + tailLog());
    try {
      const res = await fetch(s.url + '/api/health', { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch (_) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('服务启动超时：\n' + tailLog());
}

function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (isWin) {
      execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, () => resolve());
    } else {
      try { process.kill(pid, 'SIGTERM'); } catch (_) { /* gone */ }
      setTimeout(resolve, 1500);
    }
  });
}
async function stopServer() {
  const s = server;
  if (!s) return;
  s.stopping = true;
  server = null;
  if (!s.exited) await killTree(s.proc.pid);
  if (serverLog) { serverLog.end(); serverLog = null; }
}

// ---------- windows ----------
function splashURL(message) {
  return 'file://' + path.join(__dirname, 'splash.html') + '?m=' + encodeURIComponent(message || '');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1024, minHeight: 680, show: false,
    title: 'LoopForge', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0f1115',
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(splashURL('正在启动 LoopForge 服务…'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (server && url.startsWith(server.url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 860, icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://')) return;
    if (server && url.startsWith(server.url)) return;
    if (/^https?:/i.test(url)) {
      // OAuth flows may legitimately leave the app; open them in the browser.
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openEnvCheck(firstRun) {
  // Stay in the main window so first launch doesn't stack a second popup
  // on top of the splash / app, and no extra BrowserWindow is created.
  if (!mainWindow) createMainWindow();
  const q = firstRun ? '1' : '0';
  mainWindow.setTitle(firstRun ? 'LoopForge 环境检查' : 'LoopForge 环境检查');
  mainWindow.loadFile(path.join(__dirname, 'envcheck.html'), { query: { first: q } });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showError(title, detail) {
  if (mainWindow) {
    mainWindow.loadURL('file://' + path.join(__dirname, 'error.html') + '?t=' + encodeURIComponent(title) + '&d=' + encodeURIComponent(detail));
  } else {
    dialog.showErrorBox(title, detail);
  }
}

async function bootServerIntoWindow(opts = {}) {
  const showEnv = !!opts.showEnv;
  try {
    if (mainWindow) mainWindow.loadURL(splashURL(showEnv
      ? '正在启动 LoopForge 服务，随后进行环境检查…（首次启动需初始化数据库，约 10–30 秒）'
      : '正在启动 LoopForge 服务…（首次启动需初始化数据库，约 10–30 秒）'));
    const s = await startServer();
    if (!mainWindow) return;
    if (showEnv) openEnvCheck(true);
    else mainWindow.loadURL(s.url + '/');
  } catch (e) {
    showError('LoopForge 服务启动失败', String(e && e.message || e));
  }
}

async function restartServer() {
  await stopServer();
  await bootServerIntoWindow();
}

// ---------- menu ----------
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '环境检查…', accelerator: 'CmdOrCtrl+Shift+E', click: () => openEnvCheck(false) },
        { type: 'separator' },
        { label: '在浏览器中打开', click: () => server && shell.openExternal(server.url) },
        { label: '打开数据目录', click: () => shell.openPath(DATA) },
        { label: '打开服务日志', click: () => shell.openPath(path.join(LOG_DIR, 'server.log')) },
        { label: '重启服务', click: () => restartServer() },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '设置',
      submenu: [
        { label: '安装 CLI 时使用国内 npm 镜像', type: 'checkbox', checked: !!config.npmMirror, click: (i) => { config.npmMirror = i.checked; saveConfig(config); } },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: 'LoopForge 项目主页', click: () => shell.openExternal('https://github.com/Tencent/LoopForge') },
        { label: '开源许可与第三方声明', click: () => shell.openPath(path.join(RES, 'licenses')) },
        { label: '关于', click: () => dialog.showMessageBox({ type: 'info', title: '关于 LoopForge 桌面版', message: `LoopForge 桌面版 ${app.getVersion()}`, detail: `上游：Tencent/LoopForge（MIT）\n数据目录：${DATA}\n服务地址：${server ? server.url : '未启动'}\n运行模式：本机执行（已内置 Git / Node.js / Python，不使用 Docker）\nElectron ${process.versions.electron}` }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function setMode(_mode) {
  // Desktop build is host-only. Kept so older UI messages are ignored.
  if (config.runtimeMode !== 'local') {
    config.runtimeMode = 'local';
    saveConfig(config);
  }
}

// ---------- IPC (env check page) ----------
// Only the app's own file:// pages may call these; the LoopForge web UI loaded
// from the local server never can. Commands must come from the last check.
let allowedActions = new Set();
function trusted(e) {
  const url = (e.senderFrame && e.senderFrame.url) || e.sender.getURL();
  return url.startsWith('file://');
}
function guard(fn) {
  return (e, ...args) => { if (!trusted(e)) throw new Error('forbidden'); return fn(e, ...args); };
}
ipcMain.handle('env:check', guard(async () => {
  const r = await runChecks({ env: childEnv(), dataDir: DATA, gitDir: GIT_DIR, nodeDir: NODE_DIR, pythonDir: PYTHON_DIR, serverUrl: server && server.url, mirror: config.npmMirror });
  allowedActions = new Set();
  for (const x of r.results) for (const a of x.actions || []) allowedActions.add(JSON.stringify(a));
  return { ...r, info: { dataDir: DATA, mode: config.runtimeMode, mirror: !!config.npmMirror, platform: process.platform, version: app.getVersion() } };
}));
ipcMain.handle('env:action', guard(async (_e, action) => {
  if (!action || typeof action !== 'object' || !allowedActions.has(JSON.stringify(action))) return false;
  if (action.type === 'url' && /^https:\/\//.test(action.url)) { await shell.openExternal(action.url); return true; }
  if (action.type === 'launch' && action.file && fs.existsSync(action.file)) { spawn(action.file, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return true; }
  if (action.type === 'cmd' && typeof action.command === 'string') {
    // Visible console so the user sees progress, prompts (UAC/winget) and errors.
    if (isWin) {
      const banner = `echo LoopForge 正在执行：${action.command.replace(/[&|<>^]/g, '^$&')} && echo.`;
      spawn('cmd.exe', ['/k', `chcp 65001>nul && ${banner} && ${action.command} && echo. && echo 完成，可关闭此窗口并在 LoopForge 中点击“重新检查”。`], { env: childEnv(), detached: true, stdio: 'ignore', windowsHide: false }).unref();
    } else {
      const term = ['x-terminal-emulator', 'gnome-terminal', 'xterm'].find((t) => require('./envcheck').which(t, process.env));
      if (term) spawn(term, ['-e', 'bash', '-lc', `${action.command}; read -p "按回车关闭"`], { env: childEnv(), detached: true, stdio: 'ignore' }).unref();
      else return false;
    }
    return true;
  }
  return false;
}));
ipcMain.handle('env:setMirror', guard((_e, on) => { config.npmMirror = !!on; saveConfig(config); buildMenu(); return true; }));
ipcMain.handle('env:setMode', guard(() => { setMode('local'); return true; }));
ipcMain.handle('env:done', guard(() => {
  config.firstRunDone = true;
  saveConfig(config);
  if (!mainWindow) createMainWindow();
  if (mainWindow) {
    mainWindow.setTitle('LoopForge');
    if (server) mainWindow.loadURL(server.url + '/');
    mainWindow.focus();
  }
  return true;
}));
ipcMain.handle('app:retry', guard(() => restartServer()));
ipcMain.handle('app:openLogs', guard(() => shell.openPath(path.join(LOG_DIR, 'server.log'))));
ipcMain.handle('app:openEnv', guard(() => openEnvCheck(false)));

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(async () => {
    config = loadConfig();
    buildMenu();
    const firstRun = !config.firstRunDone || process.argv.includes('--env-check');
    createMainWindow();
    bootServerIntoWindow({ showEnv: firstRun });
  });
  app.on('window-all-closed', () => { app.quit(); });
  app.on('before-quit', (e) => {
    if (server && !quitting) {
      quitting = true;
      e.preventDefault();
      stopServer().finally(() => app.quit());
    }
  });
}

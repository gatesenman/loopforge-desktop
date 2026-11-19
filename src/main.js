'use strict';
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { runChecks, pathKey, requiredReady, npmCliJs, firstExisting, which } = require('./envcheck');
const secret = require('./secret');
const { setupAutoUpdate } = require('./updater');
const { exportDiagnostics, backupDataDir } = require('./diagnostics');

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

const PORT_MIN = 18090;
const PORT_MAX = 18189;
const SUPERVISOR_MAX_RESTARTS = 5;
const SUPERVISOR_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];
const HEALTH_INTERVAL_MS = 15000;
const HEALTH_FAILS_BEFORE_RESTART = 3;
const STABLE_MS_BEFORE_RESET = 60000;

let mainWindow = null;
let server = null; // { proc, port, url, stopping, exited }
let serverLog = null;
let quitting = false;
let restartAttempts = 0;
let healthTimer = null;
let healthFails = 0;
let stableTimer = null;
let bootState = 'idle'; // idle | starting | running | envcheck | error
let updater = null;
let onboardingTimer = null;

// ---------- config ----------
function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { /* first run */ }
  secret.fromDisk(cfg, isWin);
  let dirty = false;
  if (!cfg.sessionSecret) {
    cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
    dirty = true;
  }
  if (!cfg.port) { cfg.port = PORT_MIN; dirty = true; }
  cfg.runtimeMode = 'local'; // desktop build is host-only; Docker is not offered
  if (cfg.npmMirror === undefined) { cfg.npmMirror = true; dirty = true; }
  if (dirty || (isWin && cfg.sessionSecret && !cfg.sessionSecretEnc && secret.canEncrypt(isWin))) {
    saveConfig(cfg);
  }
  return cfg;
}
function saveConfig(cfg) {
  fs.mkdirSync(DATA, { recursive: true });
  const disk = secret.toDisk({ ...cfg }, isWin);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(disk, null, 2));
}
let config;

function appendLog(line) {
  try {
    if (!serverLog) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      serverLog = fs.createWriteStream(path.join(LOG_DIR, 'server.log'), { flags: 'a' });
    }
    serverLog.write(String(line).endsWith('\n') ? line : line + '\n');
  } catch (_) { /* ignore */ }
}

// ---------- environment ----------
function childEnv() {
  const env = { ...process.env };
  const key = pathKey(env);
  const current = env[key] || '';
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path' && k !== key) delete env[k];
  const extra = [];
  if (isWin) {
    extra.push(path.join(GIT_DIR, 'cmd'), path.join(GIT_DIR, 'ucrt64', 'bin'), path.join(GIT_DIR, 'mingw64', 'bin'), path.join(GIT_DIR, 'usr', 'bin'));
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
    AGENTFLOW_RUNNER_BINARY: path.join(BIN, 'agentflow-runner-{os}-{arch}'),
    AGENTFLOW_GATE_MCP_BINARY: path.join(BIN, 'agentflow-gate-mcp-{os}-{arch}'),
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
  for (let p = PORT_MIN + 1; p <= PORT_MAX; p++) {
    if (await portFree(p)) { config.port = p; saveConfig(config); return p; }
  }
  throw new Error(`找不到可用端口（${PORT_MIN}-${PORT_MAX}）`);
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

function clearHealthTimers() {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
  healthFails = 0;
}

function startHealthWatch(s) {
  clearHealthTimers();
  healthTimer = setInterval(async () => {
    if (!s || s.stopping || s.exited || quitting || server !== s) return;
    try {
      const res = await fetch(s.url + '/api/health', { signal: AbortSignal.timeout(4000) });
      if (res.ok) { healthFails = 0; return; }
    } catch (_) { /* down */ }
    healthFails += 1;
    appendLog(`===== health check failed (${healthFails}/${HEALTH_FAILS_BEFORE_RESTART}) =====`);
    if (healthFails >= HEALTH_FAILS_BEFORE_RESTART) {
      clearHealthTimers();
      appendLog('===== health checks exhausted, restarting sidecar =====');
      await killTree(s.proc && s.proc.pid);
      // exit handler will schedule the supervisor restart
    }
  }, HEALTH_INTERVAL_MS);
  stableTimer = setTimeout(() => { restartAttempts = 0; }, STABLE_MS_BEFORE_RESET);
}

async function startServer() {
  const port = await pickPort();
  const bin = serverBinary();
  if (!fs.existsSync(bin)) throw new Error(`缺少服务程序：${bin}`);
  for (const d of ['db', 'workspaces', 'assistant', 'conversations', 'clarify', 'cli']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
  if (!serverLog) serverLog = openLog();
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
    clearHealthTimers();
    if (serverLog) serverLog.write(`===== server exited code=${code} signal=${sig} =====\n`);
    if (!s.stopping && !quitting && server === s) scheduleRestart(code);
  });
  await waitHealthy(s, 120000);
  startHealthWatch(s);
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

function killTree(pid, force) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (isWin) {
      const args = force ? ['/T', '/F', '/PID', String(pid)] : ['/PID', String(pid)];
      execFile('taskkill', args, { windowsHide: true, windowsVerbatimArguments: false }, () => resolve());
    } else {
      try { process.kill(pid, force ? 'SIGKILL' : 'SIGTERM'); } catch (_) { /* gone */ }
      setTimeout(resolve, force ? 200 : 1500);
    }
  });
}

async function stopServer() {
  const s = server;
  clearHealthTimers();
  if (!s) return;
  s.stopping = true;
  if (server === s) server = null;
  if (!s.exited && s.proc && s.proc.pid) {
    // Prefer a graceful WM_CLOSE / SIGTERM, then force-kill the tree.
    await killTree(s.proc.pid, false);
    const deadline = Date.now() + 5000;
    while (!s.exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    if (!s.exited) await killTree(s.proc.pid, true);
  }
  if (serverLog) { try { serverLog.end(); } catch (_) { /* ignore */ } serverLog = null; }
}

function scheduleRestart(code) {
  if (quitting) return;
  if (restartAttempts >= SUPERVISOR_MAX_RESTARTS) {
    showError('LoopForge 服务多次退出', `已连续重启 ${SUPERVISOR_MAX_RESTARTS} 次后仍然失败。退出码：${code}\n\n${tailLog()}`);
    return;
  }
  const delay = SUPERVISOR_BACKOFF_MS[Math.min(restartAttempts, SUPERVISOR_BACKOFF_MS.length - 1)];
  restartAttempts += 1;
  appendLog(`===== supervisor restart ${restartAttempts}/${SUPERVISOR_MAX_RESTARTS} in ${delay}ms =====`);
  if (mainWindow) mainWindow.loadURL(splashURL(`服务已退出，正在第 ${restartAttempts} 次自动重启…`));
  setTimeout(() => {
    if (quitting) return;
    bootServerIntoWindow({ resume: true, fromCrash: true }).catch((e) => {
      showError('LoopForge 服务重启失败', String(e && e.message || e));
    });
  }, delay);
}

// ---------- windows ----------
function splashURL(message) {
  return 'file://' + path.join(__dirname, 'splash.html') + '?m=' + encodeURIComponent(message || '');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1024, minHeight: 680, show: false,
    title: 'LoopForge', icon: path.join(__dirname, 'icon.ico'), backgroundColor: '#0f1115',
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(splashURL('正在启动 LoopForge 服务…'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (server && url.startsWith(server.url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 860, icon: path.join(__dirname, 'icon.ico'), autoHideMenuBar: true } };
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
  mainWindow.webContents.on('did-finish-load', () => {
    if (bootState === 'running') maybeOfferOnboarding();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openEnvCheck(firstRun) {
  // Stay in the main window so first launch doesn't stack a second popup
  // on top of the splash / app, and no extra BrowserWindow is created.
  if (!mainWindow) createMainWindow();
  bootState = 'envcheck';
  const q = firstRun ? '1' : '0';
  mainWindow.setTitle('LoopForge 环境检查');
  mainWindow.loadFile(path.join(__dirname, 'envcheck.html'), { query: { first: q } });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showError(title, detail) {
  bootState = 'error';
  if (mainWindow) {
    mainWindow.loadURL('file://' + path.join(__dirname, 'error.html') + '?t=' + encodeURIComponent(title) + '&d=' + encodeURIComponent(detail));
  } else {
    dialog.showErrorBox(title, detail);
  }
}

async function collectChecks() {
  return runChecks({
    env: childEnv(), dataDir: DATA, gitDir: GIT_DIR, nodeDir: NODE_DIR,
    pythonDir: PYTHON_DIR, serverUrl: server && server.url, mirror: config.npmMirror,
  });
}

async function bootServerIntoWindow(opts = {}) {
  const forceEnv = !!opts.forceEnv || process.argv.includes('--env-check');
  try {
    bootState = 'starting';
    if (mainWindow) mainWindow.loadURL(splashURL(
      opts.fromCrash
        ? '正在重新启动 LoopForge 服务…'
        : '正在启动 LoopForge 服务…（首次启动需初始化数据库，约 10–30 秒）'
    ));
    if (!server || server.exited) {
      if (server && server.exited) server = null;
      await startServer();
    }
    if (!mainWindow) return;
    if (forceEnv) {
      openEnvCheck(true);
      return;
    }
    // Required bundled tools are checked silently. Only open the env-check
    // page when a required item fails. Optional Agent CLIs never block startup.
    let report = null;
    try { report = await collectChecks(); } catch (e) { appendLog('silent env check failed: ' + e.message); }
    if (report && !requiredReady(report)) {
      openEnvCheck(true);
      return;
    }
    showWorkbench();
    if (!config.firstRunDone) { config.firstRunDone = true; saveConfig(config); }
  } catch (e) {
    showError('LoopForge 服务启动失败', String(e && e.message || e));
  }
}

function showWorkbench() {
  if (!mainWindow || !server) return;
  bootState = 'running';
  mainWindow.setTitle('LoopForge');
  mainWindow.loadURL(server.url + '/');
  mainWindow.focus();
}

async function restartServer() {
  restartAttempts = 0;
  await stopServer();
  await bootServerIntoWindow();
}

async function isLoggedIn() {
  if (!mainWindow || !server || mainWindow.webContents.isDestroyed()) return false;
  const url = mainWindow.webContents.getURL();
  if (!url || !url.startsWith(server.url)) return false;
  try {
    const data = await mainWindow.webContents.executeJavaScript(
      "fetch('/api/auth/current',{credentials:'same-origin'}).then(r=>r.json()).catch(()=>null)",
      true
    );
    const user = data && data.user;
    if (!user) return false;
    const guest = user.isGuest === true || user.IsGuest === true;
    const name = user.loginName || user.LoginName || user.id || user.ID;
    return !guest && !!name;
  } catch (_) { return false; }
}

function maybeOfferOnboarding() {
  if (config.cliOnboardingDone) return;
  if (!mainWindow || bootState !== 'running') return;
  if (onboardingTimer) return;
  let ticks = 0;
  onboardingTimer = setInterval(async () => {
    ticks += 1;
    if (config.cliOnboardingDone || bootState !== 'running' || !mainWindow) {
      clearInterval(onboardingTimer); onboardingTimer = null; return;
    }
    if (ticks > 120) { clearInterval(onboardingTimer); onboardingTimer = null; return; } // ~10 min
    const loggedIn = await isLoggedIn();
    if (!loggedIn) return;
    clearInterval(onboardingTimer); onboardingTimer = null;
    let anyAgent = false;
    try {
      const report = await collectChecks();
      anyAgent = !!(report.summary && report.summary.anyAgent);
    } catch (_) { /* ignore */ }
    if (anyAgent) { config.cliOnboardingDone = true; saveConfig(config); return; }
    const opts = {
      type: 'info',
      buttons: ['去安装', '稍后再说'],
      defaultId: 0,
      cancelId: 1,
      title: '安装编码 Agent CLI（可选）',
      message: '要使用 AI 对话或交付类 SOP，请安装至少一个编码 Agent CLI。',
      detail: '这不是必需步骤：现在可以先浏览平台、运行无需模型的示例 SOP。可随时通过“文件 → 环境检查”安装 CodeBuddy、Codex 等（使用内置 npm，不会弹出命令行窗口）。',
    };
    const { response } = await dialog.showMessageBox(mainWindow, opts);
    config.cliOnboardingDone = true;
    saveConfig(config);
    if (response === 0) openEnvCheck(false);
  }, 5000);
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
        { label: '导出诊断包…', click: () => doExportDiagnostics() },
        { label: '备份数据目录…', click: () => doBackupData() },
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
        { label: '检查更新…', click: () => updater && updater.check(true) },
        { label: 'LoopForge 项目主页', click: () => shell.openExternal('https://github.com/Tencent/LoopForge') },
        { label: '桌面版 Releases', click: () => shell.openExternal('https://github.com/gatesenman/loopforge-desktop/releases') },
        { label: '开源许可与第三方声明', click: () => shell.openPath(path.join(RES, 'licenses')) },
        { label: '关于', click: () => dialog.showMessageBox({ type: 'info', title: '关于 LoopForge 桌面版', message: `LoopForge 桌面版 ${app.getVersion()}`, detail: `上游：Tencent/LoopForge（MIT）\n数据目录：${DATA}\n服务地址：${server ? server.url : '未启动'}\n运行模式：本机执行（已内置 Git / Node.js / Python，不使用 Docker）\n自动更新：通过 GitHub Releases 检查（安装包默认未签名，SmartScreen 可能提示）\nElectron ${process.versions.electron}` }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function doExportDiagnostics() {
  try {
    const checks = await collectChecks();
    const file = await exportDiagnostics({
      dataDir: DATA, logDir: LOG_DIR, config, checks,
      getVersions: () => ({
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        serverUrl: server ? server.url : null,
        dataDir: DATA,
        exportedAt: new Date().toISOString(),
      }),
    });
    if (file) dialog.showMessageBox({ type: 'info', message: '诊断包已保存', detail: file });
  } catch (e) {
    dialog.showErrorBox('导出诊断包失败', String(e && e.message || e));
  }
}

async function doBackupData() {
  try {
    const file = await backupDataDir({ dataDir: DATA, config });
    if (file) dialog.showMessageBox({ type: 'info', message: '数据备份已保存', detail: file });
  } catch (e) {
    dialog.showErrorBox('备份失败', String(e && e.message || e));
  }
}

async function setMode(_mode) {
  // Desktop build is host-only. Kept so older UI messages are ignored.
  if (config.runtimeMode !== 'local') {
    config.runtimeMode = 'local';
    saveConfig(config);
  }
}

function bundledNode() {
  return firstExisting([path.join(NODE_DIR, 'node.exe'), path.join(NODE_DIR, 'node')]) || which('node', childEnv());
}

function parseActionCommand(command) {
  const env = childEnv();
  const trimmed = String(command || '').trim();
  const npmMatch = trimmed.match(/^npm\s+install\s+-g\s+(.+)$/i);
  if (npmMatch) {
    const npmCmd = firstExisting([path.join(NODE_DIR, 'npm.cmd'), path.join(NODE_DIR, 'npm')]) || which('npm', env);
    const cli = npmCmd && npmCliJs(npmCmd);
    const node = bundledNode();
    const parts = npmMatch[1].trim().split(/\s+/).filter(Boolean);
    if (cli && node) return { cmd: node, argv: [cli, 'install', '-g', ...parts], env };
  }
  if (isWin && /^powershell(?:\.exe)?\s+/i.test(trimmed)) {
    const m = trimmed.match(/^powershell(?:\.exe)?\s+(.*)$/is);
    const rest = (m && m[1]) || trimmed;
    // Already a full powershell invocation; keep -NoProfile / hidden.
    const argv = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
    if (/\s-Command\s/i.test(rest) || /^-Command\s/i.test(rest)) {
      const cmdArg = rest.replace(/^.*?-Command\s+/i, '');
      argv.push('-Command', cmdArg.replace(/^"|"$/g, ''));
    } else {
      argv.push('-Command', rest);
    }
    return { cmd: 'powershell.exe', argv, env };
  }
  if (isWin) {
    return {
      cmd: env.ComSpec || process.env.ComSpec || 'cmd.exe',
      argv: ['/d', '/s', '/c', trimmed],
      env,
      windowsVerbatimArguments: true,
    };
  }
  return { cmd: 'bash', argv: ['-lc', trimmed], env };
}

function runHiddenCommand(command, sender) {
  return new Promise((resolve) => {
    let plan;
    try { plan = parseActionCommand(command); }
    catch (e) { return resolve({ ok: false, out: String(e && e.message || e), code: -1 }); }
    const chunks = [];
    const send = (text) => {
      if (text && sender && !sender.isDestroyed()) sender.send('env:action-log', { text: String(text) });
    };
    send('> ' + command + '\n');
    const proc = spawn(plan.cmd, plan.argv, {
      env: plan.env,
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments: !!plan.windowsVerbatimArguments,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (b) => {
      const s = b.toString();
      chunks.push(s);
      send(s);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    const timer = setTimeout(() => { try { proc.kill(); } catch (_) { /* ignore */ } }, 10 * 60 * 1000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      const out = chunks.join('').trim();
      resolve({ ok: code === 0, out, code: code == null ? -1 : code });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, out: String(err && err.message || err), code: -1 });
    });
  });
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
  const r = await collectChecks();
  allowedActions = new Set();
  for (const x of r.results) for (const a of x.actions || []) allowedActions.add(JSON.stringify(a));
  return { ...r, info: { dataDir: DATA, mode: config.runtimeMode, mirror: !!config.npmMirror, platform: process.platform, version: app.getVersion() } };
}));
ipcMain.handle('env:action', guard(async (e, action) => {
  if (!action || typeof action !== 'object' || !allowedActions.has(JSON.stringify(action))) return { ok: false, out: '不允许的操作' };
  if (action.type === 'url' && /^https:\/\//.test(action.url)) { await shell.openExternal(action.url); return { ok: true }; }
  if (action.type === 'launch' && action.file && fs.existsSync(action.file)) { spawn(action.file, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return { ok: true }; }
  if (action.type === 'cmd' && typeof action.command === 'string') {
    // Run hidden in-process; surface stdout/stderr on the env-check page. Never `cmd /k`.
    return runHiddenCommand(action.command, e.sender);
  }
  return { ok: false };
}));
ipcMain.handle('env:setMirror', guard((_e, on) => { config.npmMirror = !!on; saveConfig(config); buildMenu(); return true; }));
ipcMain.handle('env:setMode', guard(() => { setMode('local'); return true; }));
ipcMain.handle('env:done', guard(() => {
  config.firstRunDone = true;
  saveConfig(config);
  if (!mainWindow) createMainWindow();
  showWorkbench();
  return true;
}));
ipcMain.handle('app:retry', guard(() => { restartAttempts = 0; return restartServer(); }));
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
    updater = setupAutoUpdate({
      isWin,
      getWindow: () => mainWindow,
      log: (m) => appendLog(m),
    });
    createMainWindow();
    bootServerIntoWindow({ forceEnv: process.argv.includes('--env-check') });
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

'use strict';
// Environment checks for LoopForge Desktop. Pure Node (no Electron imports) so
// it can be unit-run with `node src/envcheck.js` on any OS.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const isWin = process.platform === 'win32';

function pathKey(env) {
  return Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
}

function existingFile(p) {
  try { const st = fs.statSync(p); return st.isFile() && st.size > 0 ? p : ''; } catch (_) { return ''; }
}

function which(name, env) {
  const dirs = (env[pathKey(env)] || '').split(path.delimiter).filter(Boolean);
  const exts = isWin ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of dirs) {
    for (const ext of isWin && path.extname(name) ? [''] : exts) {
      const found = existingFile(path.join(dir, name + ext));
      if (found) return found;
    }
  }
  return '';
}

function npmCliJs(npmCmd) {
  const dir = path.dirname(npmCmd);
  return firstExisting([
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]);
}

// Hidden process, never `shell: true` — that flashes a Windows console.
function run(file, args, env, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let cmd = file;
    let argv = args || [];
    const opts = { env, timeout: timeoutMs, windowsHide: true, shell: false, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] };
    if (isWin && /\.(cmd|bat)$/i.test(file)) {
      const cli = /npm/i.test(path.basename(file)) ? npmCliJs(file) : '';
      const node = firstExisting(bundledCandidates(path.dirname(file), ['node.exe'])) || which('node', env);
      if (cli && node) {
        cmd = node;
        argv = [cli, ...argv];
      } else {
        cmd = env.ComSpec || process.env.ComSpec || 'cmd.exe';
        argv = ['/d', '/s', '/c', `"${file}" ${argv.map((a) => /\s/.test(a) ? `"${a}"` : a).join(' ')}`];
        opts.windowsVerbatimArguments = true;
      }
    }
    execFile(cmd, argv, opts, (err, stdout, stderr) => {
      const decode = (b) => {
        if (!b || !b.length) return '';
        if (b.length > 1 && b[1] === 0) return b.toString('utf16le');
        return b.toString('utf8');
      };
      resolve({ ok: !err, code: err && typeof err.code === 'number' ? err.code : (err ? -1 : 0), out: (decode(stdout) + '\n' + decode(stderr)).replace(/\0/g, '').trim() });
    });
  });
}

function firstLine(s) {
  return (s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || '';
}

function versionOf(s) {
  const m = (s || '').match(/\d+\.\d+(\.\d+)?([-.\w]*)?/);
  return m ? m[0] : firstLine(s).slice(0, 60);
}

function npmCmd(pkg, mirror) {
  return `npm install -g ${pkg}${mirror ? ' --registry=https://registry.npmmirror.com' : ''}`;
}

const AGENT_CLIS = [
  { id: 'codebuddy', name: 'CodeBuddy Code', bin: 'codebuddy', pkg: '@tencent-ai/codebuddy-code', note: '需求澄清默认使用 CodeBuddy，需登录对应账号' },
  { id: 'codex', name: 'OpenAI Codex CLI', bin: 'codex', pkg: '@openai/codex@0.162.1', note: '需 OpenAI 账号或密钥' },
  { id: 'claude', name: 'Claude Code', bin: 'claude', pkg: '@anthropic-ai/claude-code@2.1.300', note: '需 Anthropic 账号或密钥' },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode', pkg: 'opencode-ai' },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', pkg: '@google/gemini-cli', note: '需 Google 账号或密钥' },
  { id: 'dsh', name: 'DeepSeek Harness (dsh)', bin: 'dsh', pkg: '@deepseek-ai/dsh' },
  { id: 'cursor-agent', name: 'Cursor CLI', bin: 'cursor-agent', url: 'https://cursor.com/cli',
    cmd: isWin ? "powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm 'https://cursor.com/install?win32=true' | iex\"" : "curl https://cursor.com/install -fsS | bash",
    note: '需 Cursor 账号，由官方安装脚本提供' },
];

function bundledCandidates(dir, names) {
  if (!dir) return [];
  return names.map((n) => path.join(dir, n));
}

function firstExisting(paths) {
  for (const p of paths) {
    const f = existingFile(p);
    if (f) return f;
  }
  return '';
}

async function checkBundledOrPath({ id, name, level, purpose, bin, args, bundledPaths, okDetail }, env) {
  const bundled = firstExisting(bundledPaths || []);
  const found = bundled || which(bin, env);
  if (!found) {
    // Required runtimes are shipped in the installer. If they are missing, the
    // install is broken — do not send the user to winget.
    return { id, name, level, purpose, status: 'error', detail: `安装包内未找到 ${bin}，请重新安装 LoopForge` };
  }
  const isBundled = !!(bundled && found.toLowerCase() === bundled.toLowerCase()) ||
    (bundledPaths || []).some((p) => found.toLowerCase().startsWith(path.dirname(p).toLowerCase()) || found.toLowerCase() === p.toLowerCase());
  const v = await run(found, args || ['--version'], env);
  if (!v.ok) return { id, name, level, purpose, status: 'warn', path: found, bundled: isBundled, detail: `${bin} 无法运行：${firstLine(v.out)}` };
  const ver = /sh-ok/.test(v.out) ? '' : versionOf(v.out);
  return { id, name, level, purpose, status: 'ok', version: ver, path: found, bundled: isBundled, detail: isBundled ? (okDetail || '使用安装包内置版本，无需另行安装') : '使用系统已安装版本' };
}

async function checkPython(env, pythonDir) {
  const bundled = firstExisting(bundledCandidates(pythonDir, isWin ? ['python.exe', 'python3.exe'] : ['bin/python3', 'bin/python']));
  const tries = isWin ? [['py', ['-3', '--version']], ['python', ['--version']], ['python3', ['--version']]] : [['python3', ['--version']], ['python', ['--version']]];
  if (bundled) {
    const v = await run(bundled, ['--version'], env);
    if (v.ok && /Python 3/i.test(v.out)) return { id: 'python', name: 'Python 3', level: 'required', purpose: 'SOP 脚本与部分仓库命令', status: 'ok', version: versionOf(v.out), path: bundled, bundled: true, detail: '使用安装包内置版本，无需另行安装' };
    return { id: 'python', name: 'Python 3', level: 'required', purpose: 'SOP 脚本与部分仓库命令', status: 'warn', path: bundled, bundled: true, detail: `内置 Python 无法运行：${firstLine(v.out)}` };
  }
  for (const [name, args] of tries) {
    const bin = which(name, env);
    if (!bin) continue;
    const v = await run(bin, args, env);
    if (v.ok && /Python 3/i.test(v.out)) return { id: 'python', name: 'Python 3', level: 'required', purpose: 'SOP 脚本与部分仓库命令', status: 'ok', version: versionOf(v.out), path: bin, bundled: false, detail: '使用系统已安装版本' };
  }
  return { id: 'python', name: 'Python 3', level: 'required', purpose: 'SOP 脚本与部分仓库命令', status: 'error', detail: '安装包内未找到 Python，请重新安装 LoopForge' };
}

function checkDataDir(dataDir) {
  const r = { id: 'datadir', name: '数据目录', level: 'required', purpose: 'SQLite 数据库、工作区与日志', path: dataDir };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probe = path.join(dataDir, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (e) {
    return { ...r, status: 'error', detail: `不可写：${e.message}` };
  }
  let free = '';
  try {
    if (fs.statfsSync) {
      const st = fs.statfsSync(dataDir);
      const gb = (st.bavail * st.bsize) / 1024 ** 3;
      free = `可用空间 ${gb.toFixed(1)} GB`;
      if (gb < 2) return { ...r, status: 'warn', detail: `可写，但${free}（建议 ≥ 5 GB）` };
    }
  } catch (_) { /* ignore */ }
  return { ...r, status: 'ok', detail: `可写${free ? '，' + free : ''}` };
}

async function checkServer(serverUrl) {
  const r = { id: 'server', name: 'LoopForge 服务', level: 'required', purpose: '本地平台服务（已内置，使用 SQLite，无需数据库或 Docker）' };
  if (!serverUrl) return { ...r, status: 'warn', detail: '服务尚未启动' };
  try {
    const res = await fetch(serverUrl + '/api/health', { signal: AbortSignal.timeout(4000) });
    const body = await res.json();
    return { ...r, status: res.ok && body.status === 'ok' ? 'ok' : 'error', detail: `${serverUrl}（${body.status || res.status}）` };
  } catch (e) {
    return { ...r, status: 'error', detail: `无法连接 ${serverUrl}：${e.message}` };
  }
}

/**
 * runChecks returns a list of check results.
 * ctx: { env, dataDir, gitDir, nodeDir, pythonDir, serverUrl, mirror }
 */
async function runChecks(ctx) {
  const env = ctx.env || process.env;
  const mirror = !!ctx.mirror;
  const gitDir = ctx.gitDir || '';
  const nodeDir = ctx.nodeDir || '';
  const pythonDir = ctx.pythonDir || '';
  const jobs = [
    checkServer(ctx.serverUrl),
    Promise.resolve(checkDataDir(ctx.dataDir || path.join(os.tmpdir(), 'loopforge'))),
    checkBundledOrPath({
      id: 'git', name: 'Git', level: 'required', purpose: '克隆仓库、提交与交付', bin: 'git',
      bundledPaths: bundledCandidates(gitDir, isWin ? ['cmd/git.exe', 'cmd/git'] : ['bin/git']),
    }, env),
    checkBundledOrPath({
      id: 'sh', name: 'Bash / sh', level: 'required', purpose: '执行 SOP 脚本节点与 Agent 命令', bin: 'sh',
      args: ['-c', 'echo sh-ok'],
      bundledPaths: bundledCandidates(gitDir, isWin ? ['ucrt64/bin/sh.exe', 'ucrt64/bin/ash.exe', 'mingw64/bin/sh.exe', 'usr/bin/sh.exe', 'usr/bin/bash.exe', 'bin/sh.exe'] : ['bin/sh']),
    }, env),
    checkBundledOrPath({
      id: 'node', name: 'Node.js', level: 'required', purpose: '安装与运行编码 Agent CLI', bin: 'node',
      bundledPaths: bundledCandidates(nodeDir, isWin ? ['node.exe'] : ['bin/node']),
    }, env),
    checkBundledOrPath({
      id: 'npm', name: 'npm', level: 'required', purpose: '按需安装编码 Agent CLI', bin: 'npm',
      bundledPaths: bundledCandidates(nodeDir, isWin ? ['npm.cmd', 'npm'] : ['bin/npm']),
    }, env),
    checkPython(env, pythonDir),
  ];
  const agentJobs = (ctx.requiredOnly ? [] : AGENT_CLIS).map(async (c) => {
    const base = { id: 'cli-' + c.id, name: c.name, level: 'agent', purpose: c.note || '编码 Agent（任选其一即可，需自行登录）' };
    const found = which(c.bin, env);
    const installAction = c.pkg
      ? { label: `安装（${mirror ? 'npmmirror 镜像' : 'npm'}）`, type: 'cmd', command: npmCmd(c.pkg, mirror) }
      : { label: '运行官方安装脚本', type: 'cmd', command: c.cmd };
    const actions = [installAction, c.url && { label: '官网', type: 'url', url: c.url }].filter(Boolean);
    if (!found) return { ...base, status: 'missing', detail: c.pkg ? `可选：用内置 npm 安装 ${c.pkg}` : '可选：需官方安装脚本（并登录账号）', actions };
    // Presence is enough for optional CLIs; running --version on .cmd shims flashes a console.
    const isCmd = isWin && /\.(cmd|bat)$/i.test(found);
    let ver = '';
    if (!isCmd) {
      const v = await run(found, ['--version'], env, 8000);
      if (v.ok) ver = versionOf(v.out);
    }
    return { ...base, status: 'ok', path: found, version: ver, detail: ver ? undefined : '已安装', actions: c.pkg ? [{ label: '更新', type: 'cmd', command: npmCmd(c.pkg.replace(/@[\d.]+$/, '') + '@latest', mirror) }] : [] };
  });
  const results = await Promise.all([...jobs, ...agentJobs]);
  const agents = results.filter((r) => r.level === 'agent');
  const required = results.filter((r) => r.level === 'required');
  return {
    results,
    summary: {
      requiredOk: required.every((r) => r.status === 'ok'),
      anyAgent: agents.some((r) => r.status === 'ok'),
      checkedAt: new Date().toISOString(),
    },
  };
}

function requiredReady(report) {
  if (report && report.summary) return !!report.summary.requiredOk;
  const list = Array.isArray(report) ? report : [];
  const required = list.filter((r) => r.level === 'required');
  return required.length > 0 && required.every((r) => r.status === 'ok');
}

module.exports = { runChecks, which, pathKey, AGENT_CLIS, requiredReady, npmCliJs, firstExisting, bundledCandidates };

if (require.main === module) {
  runChecks({ dataDir: path.join(os.tmpdir(), 'loopforge-envcheck'), serverUrl: process.argv[2] || '' }).then((r) => {
    for (const x of r.results) console.log(`${x.status.padEnd(7)} ${x.level.padEnd(11)} ${x.name}${x.version ? ' ' + x.version : ''} — ${x.detail || ''}`);
    console.log(JSON.stringify(r.summary));
  });
}

#!/usr/bin/env node
'use strict';
// Native windows-latest command-line integration smoke tests, NOT GUI E2E.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { runChecks } = require('../src/envcheck');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32') throw Error('Requires native Windows (not Wine)');
const BASE = path.join(ROOT, '.smoke', 'LoopForge Runtime With Spaces');
fs.rmSync(BASE, { recursive: true, force: true }); fs.mkdirSync(BASE, { recursive: true });
const runtime = path.join(BASE, 'runtime');
for (const name of ['git', 'node', 'python']) fs.cpSync(path.join(ROOT, 'vendor-dl', name), path.join(runtime, name), { recursive: true });
const bins = path.join(BASE, 'bin'); fs.cpSync(path.join(ROOT, 'resources', 'bin'), bins, { recursive: true });
const git = path.join(runtime, 'git'), node = path.join(runtime, 'node'), python = path.join(runtime, 'python');
const trap = path.join(BASE, 'probe trap'); fs.mkdirSync(trap);
// If the service ever invokes Docker, fail with an evidence marker. No daemon.
const trapSrc = path.join(trap, 'trap.go'), marker = path.join(BASE, 'unexpected-docker-call');
fs.writeFileSync(trapSrc, 'package main\nimport("os")\nfunc main(){os.WriteFile(os.Getenv("LOOPFORGE_PROBE_MARKER"),[]byte("unexpected invocation"),0600);os.Exit(97)}\n');
function run(file, args, env = process.env) {
  const r = spawnSync(file, args, { env, windowsHide: true, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0 || r.error) throw Error(`${file} ${JSON.stringify(args)} failed: ${r.error || r.stderr || r.stdout}`);
  console.log(path.basename(file), JSON.stringify(args), r.stdout.trim().slice(0, 200));
  return r.stdout;
}
run('go', ['build', '-o', path.join(trap, 'docker.exe'), trapSrc]);
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.toLowerCase() === 'path' || k.startsWith('AGENTFLOW_')) delete env[k];
env.Path = [trap, path.join(git, 'cmd'), path.join(git, 'usr/bin'), path.join(git, 'ucrt64/bin'), node, python, path.join(env.SystemRoot, 'System32'), env.SystemRoot].join(';');
env.LOOPFORGE_PROBE_MARKER = marker;
env.MSYS2_PATH_TYPE = 'inherit'; env.CHERE_INVOKING = '1'; env.HOME = BASE;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(bins, 'build-manifest.json')));
assert.equal(manifest.commit, require('./vendor-lock.json').loopforge.commit);
assert.equal(manifest.patchSha256, sha(path.join(ROOT, 'patches/0001-desktop-no-docker-hide-console.patch')));
for (const [name, m] of Object.entries(manifest.bins)) assert.equal(sha(path.join(bins, name)), m.sha256);
assert.match(run(path.join(git, 'cmd/git.exe'), ['--version'], env), /2\.56\.1/);
assert.match(run(path.join(git, 'usr/bin/sh.exe'), ['-lc', 'printf sh-ok; git --version'], env), /sh-ok/);
assert.match(run(path.join(git, 'usr/bin/bash.exe'), ['-c', 'set -e; test -n "$BASH_VERSION"; a=(one two); [[ ${a[1]} == two ]]; printf "bash-arrays-ok %s\\n" "$BASH_VERSION"'], env), /bash-arrays-ok 5\./);
run(path.join(node, 'node.exe'), ['--version'], env);
run(path.join(node, 'node.exe'), [path.join(node, 'node_modules/npm/bin/npm-cli.js'), '--version'], env);
run(path.join(python, 'python.exe'), ['-c', 'import ssl,sqlite3; print("stdlib-ok")'], env);
assert.match(run(path.join(python, 'python.exe'), ['-m', 'pip', '--version'], env), /pip 24\.3\.1/);
run(path.join(python, 'python3.exe'), ['--version'], env);
(async () => {
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.on('error', reject); s.listen(18090, '127.0.0.1', () => s.close(() => resolve(18090)));
  });
  const data = path.join(BASE, 'data directory'); fs.mkdirSync(path.join(data, 'db'), { recursive: true });
  Object.assign(env, {
    LOOPFORGE_DESKTOP: '1', LOOPFORGE_DESKTOP_STDIN_CONTROL: '1', AGENTFLOW_DISABLE_DOCKER: '1',
    AGENTFLOW_SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    AGENTFLOW_SQLITE_PATH: path.join(data, 'db/loopforge.db'),
    AGENTFLOW_AUTH_REQUIRED: 'true', AGENTFLOW_ALLOW_SIGNUP: 'false',
    AGENTFLOW_HTTP_PORT: String(port), AGENTFLOW_SECURE_COOKIES: 'false',
  });
  const url = `http://127.0.0.1:${port}`;
  const proc = spawn(path.join(bins, 'agentflow.exe'), ['-addr', `127.0.0.1:${port}`, '-workspaces', path.join(data, 'workspaces')], { cwd: data, env, windowsHide: true });
  let exited = false, exitCode = null, log = '';
  proc.stdin.on('error', () => {});
  proc.on('error', (e) => { exited = true; log += e.message; });
  proc.on('exit', (code) => { exited = true; exitCode = code; });
  proc.stdout.on('data', (b) => { log += b.toString(); }); proc.stderr.on('data', (b) => { log += b.toString(); });
  try {
    let healthy = false;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && !exited) {
      try { const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1000) }); healthy = r.ok && (await r.json()).status === 'ok'; } catch (_) { /* startup */ }
      if (healthy) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    // Do not print service logs which might contain session/config values.
    assert.ok(healthy, `Sidecar health failed (exited=${exited}); log bytes=${log.length}`);
    assert.ok(fs.existsSync(path.join(data, 'db/loopforge.db')), 'SQLite database created');
    assert.equal((await fetch(url + '/api/auth/setup')).status, 200);
    const report = await runChecks({ env, dataDir: data, gitDir: git, nodeDir: node, pythonDir: python, serverUrl: url, requiredOnly: true });
    console.log('Required checks:', JSON.stringify(report));
    assert.equal(report.summary.requiredOk, true);
    assert.ok(!fs.existsSync(marker), 'No Docker invocation allowed');
    proc.stdin.end('shutdown\n');
    const stopDeadline = Date.now() + 30000;
    while (!exited && Date.now() < stopDeadline) await new Promise((r) => setTimeout(r, 100));
    assert.ok(exited && exitCode === 0, 'Sidecar graceful stdin shutdown');
    fs.writeFileSync(path.join(ROOT, '.smoke', 'result.json'), JSON.stringify({ nativeWindows: true, guiTest: false, requiredChecks: report, manifest, noDockerInvocation: true }, null, 2));
    console.log('Native Windows CLI/runtime smoke passed (not GUI E2E)');
  } finally {
    if (!exited) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });

#!/usr/bin/env node
'use strict';
// Build Windows LoopForge sidecar bins from the pinned upstream commit + desktop patch.
// Does not package Linux binaries or loopforge-account.exe.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOCK = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor-lock.json'), 'utf8'));
const DEST = path.join(ROOT, 'resources', 'bin');
const CACHE = path.join(ROOT, 'vendor-dl', '_src');
const skipVerify = process.argv.includes('--skip-hash-verify');
const forceBuild = process.argv.includes('--force');

function log(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write('error: ' + msg + '\n'); process.exit(1); }
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}
function run(cmd, args, opts) {
  log('+ ' + [cmd, ...args].join(' '));
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(cmd + ' exited ' + r.status);
}
function which(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.status === 0;
}

const WANTED = [
  { name: 'agentflow.exe', pkg: './cmd/agentflow' },
  { name: 'agentflow-mcp.exe', pkg: './cmd/agentflow-mcp' },
  { name: 'agentflow-runner-windows-amd64', pkg: './cmd/agentflow-runner' },
  { name: 'agentflow-gate-mcp-windows-amd64', pkg: './cmd/agentflow-gate-mcp' },
];

function existingMatch() {
  if (forceBuild) return false;
  const bins = LOCK.loopforge.bins || {};
  return WANTED.every((b) => {
    const p = path.join(DEST, b.name);
    if (!fs.existsSync(p) || !fs.statSync(p).size) return false;
    const expected = bins[b.name] && bins[b.name].sha256;
    if (!expected || skipVerify) return true;
    const got = sha256File(p);
    if (got !== expected) {
      log('hash mismatch for ' + b.name + ' (will rebuild)\n  expected ' + expected + '\n  got      ' + got);
      return false;
    }
    return true;
  });
}

function resolveSource() {
  const envSrc = process.env.LOOPFORGE_SRC;
  if (envSrc && fs.existsSync(path.join(envSrc, 'cmd', 'agentflow'))) return path.resolve(envSrc);
  // Local clone used during packaging on this machine.
  const local = '/workspace/LoopForge';
  if (fs.existsSync(path.join(local, 'cmd', 'agentflow'))) return local;
  return null;
}

function checkoutUpstream() {
  const dest = path.join(CACHE, 'LoopForge');
  const commit = LOCK.loopforge.commit;
  const repo = LOCK.loopforge.repo;
  fs.mkdirSync(CACHE, { recursive: true });
  if (!fs.existsSync(path.join(dest, '.git'))) {
    run('git', ['clone', '--filter=blob:none', repo, dest]);
  }
  run('git', ['fetch', '--depth', '1', 'origin', commit], { cwd: dest });
  run('git', ['checkout', '--force', commit], { cwd: dest });
  run('git', ['clean', '-fdx', '-e', '.git'], { cwd: dest });
  const patch = path.join(ROOT, LOCK.loopforge.patch);
  const check = spawnSync('git', ['apply', '--check', patch], { cwd: dest, encoding: 'utf8' });
  if (check.status === 0) run('git', ['apply', patch], { cwd: dest });
  else log('patch already applied or not applicable, continuing: ' + (check.stderr || check.stdout || '').trim());
  return dest;
}

function build(src) {
  if (!which('go') && !which('go.exe')) fail('go toolchain not found on PATH');
  fs.mkdirSync(DEST, { recursive: true });
  const env = {
    ...process.env,
    CGO_ENABLED: '0',
    GOOS: 'windows',
    GOARCH: 'amd64',
  };
  const ldflags = '-s -w -H=windowsgui -buildid=';
  for (const b of WANTED) {
    const out = path.join(DEST, b.name);
    run('go', ['build', '-trimpath', '-ldflags', ldflags, '-o', out, b.pkg], { cwd: src, env });
  }
}

function pruneUnwanted() {
  for (const name of fs.readdirSync(DEST)) {
    if (/-linux-/.test(name) || /^loopforge-account/i.test(name)) {
      fs.unlinkSync(path.join(DEST, name));
      log('removed unpackaged ' + name);
    }
  }
}

function report() {
  log('Windows bins in ' + DEST);
  const bins = LOCK.loopforge.bins || {};
  for (const b of WANTED) {
    const p = path.join(DEST, b.name);
    const st = fs.statSync(p);
    const got = sha256File(p);
    const expected = bins[b.name] && bins[b.name].sha256;
    const mark = !expected ? ' (no lock hash)' : (got === expected ? ' (matches lock)' : ' (differs from lock; rebuilds are not bit-reproducible)');
    log(got + '  ' + b.name + '  ' + st.size + ' bytes' + mark);
  }
}

if (existingMatch()) {
  log('existing Windows bins match vendor-lock.json, skipping build');
  pruneUnwanted();
  report();
  process.exit(0);
}

let src = resolveSource();
if (src) {
  log('using LoopForge source at ' + src);
  const patch = path.join(ROOT, LOCK.loopforge.patch);
  // Apply patch only when the working tree looks unpatched. Never wipe a local clone.
  const probe = spawnSync('git', ['apply', '--check', patch], { cwd: src, encoding: 'utf8' });
  if (probe.status === 0) {
    log('applying desktop patch');
    run('git', ['apply', patch], { cwd: src });
  }
} else {
  src = checkoutUpstream();
}
build(src);
pruneUnwanted();
report();

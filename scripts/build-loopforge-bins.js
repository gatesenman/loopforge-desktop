#!/usr/bin/env node
'use strict';
// No dirty clone reuse: archive an exact revision, apply the entire verified
// desktop delta, build frontend from its npm lock, then compile every binary.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const lock = require('./vendor-lock.json').loopforge;
const DEST = path.join(ROOT, 'resources', 'bin');
const OWN = path.join(ROOT, 'vendor-dl', '_src');
const SOURCE = path.join(OWN, 'prepared');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function run(cmd, args, opts = {}) {
  console.log('+', cmd, ...args);
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} exited ${result.status}`);
}
function output(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(r.stderr || `${cmd} failed`);
  return r.stdout.trim();
}
const patch = path.join(ROOT, lock.patch);
if (sha(patch) !== lock.patchSha256) throw new Error('Desktop patch SHA256 mismatch');
const goVersion = output('go', ['version']).split(' ')[2];
if (goVersion !== lock.goVersion) throw new Error(`Use pinned ${lock.goVersion}, found ${goVersion}`);
require('./prepare-source').prepareSource(ROOT, SOURCE, lock);
// npm.cmd must not be spawned directly or shell:true. Invoke npm-cli via node.
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!fs.existsSync(npmCli)) throw new Error(`npm-cli.js not found: ${npmCli}; invoke via npm run build-bins`);
run(process.execPath, [npmCli, '--prefix', 'chatbot', 'ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: SOURCE });
run(process.execPath, [npmCli, '--prefix', 'chatbot', 'run', 'build'], { cwd: SOURCE });
fs.mkdirSync(DEST, { recursive: true });
const wanted = {
  'agentflow.exe': './cmd/agentflow',
  'agentflow-mcp.exe': './cmd/agentflow-mcp',
  'agentflow-runner-windows-amd64': './cmd/agentflow-runner',
  'agentflow-gate-mcp-windows-amd64': './cmd/agentflow-gate-mcp',
};
const bins = {};
for (const [name, pkg] of Object.entries(wanted)) {
  const out = path.join(DEST, name);
  run('go', ['build', '-buildvcs=false', '-trimpath', '-ldflags=-s -w -H=windowsgui -buildid=', '-o', out, pkg], {
    cwd: SOURCE, env: { ...process.env, CGO_ENABLED: '0', GOOS: 'windows', GOARCH: 'amd64', GOTOOLCHAIN: 'local' },
  });
  bins[name] = { sha256: sha(out), bytes: fs.statSync(out).size };
}
for (const name of fs.readdirSync(DEST)) {
  if (/-linux-/.test(name) || /^loopforge-account/.test(name)) fs.rmSync(path.join(DEST, name));
}
fs.writeFileSync(path.join(DEST, 'build-manifest.json'), JSON.stringify({
  sourceUrl: lock.repo, commit: lock.commit, patchSha256: lock.patchSha256,
  goVersion, nodeVersion: process.versions.node,
  frontendLockSha256: sha(path.join(SOURCE, 'chatbot/package-lock.json')), bins,
}, null, 2) + '\n');
console.log('Build provenance:', JSON.stringify(bins, null, 2));

#!/usr/bin/env node
'use strict';
// Download and verify pinned runtimes into vendor-dl/. Works on Linux and Windows.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOCK = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor-lock.json'), 'utf8'));
const CACHE = path.join(ROOT, 'vendor-dl', '_cache');
const force = process.argv.includes('--force');

function log(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write('error: ' + msg + '\n'); process.exit(1); }

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return hash.digest('hex');
}

function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  return new Promise((resolve, reject) => {
    const tmp = dest + '.partial';
    const go = (u, redirects) => {
      if (redirects > 8) return reject(new Error('too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'loopforge-desktop-fetch' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(new URL(res.headers.location, u).href, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode + ' for ' + u));
        }
        const out = fs.createWriteStream(tmp);
        res.pipe(out);
        out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(); }));
        out.on('error', reject);
      }).on('error', reject);
    };
    go(url, 0);
  });
}

async function fetchVerified(entry, fileName) {
  const dest = path.join(CACHE, fileName);
  if (fs.existsSync(dest) && sha256File(dest) === entry.sha256) {
    log('cache hit ' + fileName);
    return dest;
  }
  log('downloading ' + entry.url);
  await download(entry.url, dest);
  const got = sha256File(dest);
  if (got !== entry.sha256) {
    fs.unlinkSync(dest);
    fail(fileName + ' sha256 mismatch\n  expected ' + entry.sha256 + '\n  got      ' + got);
  }
  return dest;
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(cmd + ' exited ' + r.status);
}

function extractZip(zip, dest, strip) {
  const tmp = dest + '.extract-tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  if (process.platform === 'win32') {
    run('tar', ['-xf', zip, '-C', tmp]);
  } else if (spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0) {
    run('unzip', ['-q', zip, '-d', tmp]);
  } else {
    run('python3', ['-c',
      'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, tmp]);
  }
  let src = tmp;
  if (strip > 0) {
    const kids = fs.readdirSync(tmp).filter((n) => n !== '__MACOSX');
    if (kids.length !== 1) throw new Error('expected 1 top-level entry to strip in ' + zip + ', got ' + kids.join(', '));
    src = path.join(tmp, kids[0]);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  if (src !== tmp) fs.rmSync(tmp, { recursive: true, force: true });
}

function looksPresent(dest, marker) {
  return fs.existsSync(path.join(dest, marker));
}

function postMingitShells(dest) {
  const bin = path.join(dest, 'ucrt64', 'bin');
  const wrapper = [
    path.join(dest, 'ucrt64', 'share', 'git', 'git-wrapper.exe'),
    path.join(bin, 'ash.exe'),
  ].find((p) => fs.existsSync(p));
  const busybox = path.join(bin, 'busybox.exe');
  if (!wrapper || !fs.existsSync(busybox)) {
    throw new Error('MinGit-busybox post-process: missing git-wrapper/ash.exe or busybox.exe under ' + dest);
  }
  fs.copyFileSync(wrapper, path.join(bin, 'sh.exe'));
  fs.copyFileSync(busybox, path.join(bin, 'bash.exe'));
  log('added ucrt64/bin/sh.exe (git-wrapper) and ucrt64/bin/bash.exe (busybox copy)');
}

function postPythonSite(dest) {
  const pths = fs.readdirSync(dest).filter((n) => n.endsWith('._pth'));
  if (!pths.length) throw new Error('python embed: no ._pth in ' + dest);
  for (const name of pths) {
    const file = path.join(dest, name);
    let text = fs.readFileSync(file, 'utf8');
    text = text.replace(/^#\s*import site\s*$/m, 'import site');
    if (!/^import site\s*$/m.test(text)) text = text.trimEnd() + '\nimport site\n';
    fs.writeFileSync(file, text);
    log('enabled import site in ' + name);
  }
}

async function maybeGetPip(pythonDest) {
  const extra = LOCK.getPip;
  if (!extra) return;
  try {
    const fileName = 'get-pip.py';
    const dest = path.join(CACHE, fileName);
    if (!(fs.existsSync(dest) && sha256File(dest) === extra.sha256)) {
      log('downloading ' + extra.url);
      await download(extra.url, dest);
    }
    const got = sha256File(dest);
    if (got !== extra.sha256) {
      log('warning: get-pip.py sha256 mismatch, skipping (optional)');
      return;
    }
    fs.copyFileSync(dest, path.join(pythonDest, 'get-pip.py'));
    log('copied get-pip.py into python dest');
  } catch (e) {
    log('warning: optional get-pip.py not fetched: ' + e.message);
  }
}

async function ensureRuntime(entry, marker) {
  const dest = path.join(ROOT, entry.dest);
  if (!force && looksPresent(dest, marker)) {
    log('keep existing ' + entry.dest);
    if (entry.postProcess === 'mingit-busybox-shells') {
      const sh = path.join(dest, 'ucrt64', 'bin', 'sh.exe');
      const bash = path.join(dest, 'ucrt64', 'bin', 'bash.exe');
      if (!fs.existsSync(sh) || !fs.existsSync(bash)) postMingitShells(dest);
    }
    return dest;
  }
  const zipName = path.basename(new URL(entry.url).pathname);
  const zip = await fetchVerified(entry, zipName);
  extractZip(zip, dest, entry.strip || 0);
  if (entry.postProcess === 'mingit-busybox-shells') postMingitShells(dest);
  if (entry.postProcess === 'python-embed-site') postPythonSite(dest);
  return dest;
}

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  await ensureRuntime(LOCK.git, path.join("ucrt64", "bin", "busybox.exe"));
  await ensureRuntime(LOCK.node, 'node.exe');
  const py = await ensureRuntime(LOCK.python, 'python.exe');
  await maybeGetPip(py);
  log('vendors ready');
})().catch((e) => fail(e.stack || e.message));

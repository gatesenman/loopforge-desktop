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
  // Official regular MinGit ships real GNU Bash named sh.exe.
  const bin = path.join(dest, 'usr', 'bin');
  fs.copyFileSync(path.join(bin, 'sh.exe'), path.join(bin, 'bash.exe'));
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

async function installPip(pythonDest) {
  // Pure-Python wheel unpacked deterministically: no get-pip script, bootstrap,
  // system Python, or install-time network request is required.
  const wheel = await fetchVerified(LOCK.pip, path.basename(new URL(LOCK.pip.url).pathname));
  const dest = path.join(pythonDest, 'Lib', 'site-packages');
  extractZip(wheel, dest, 0);
  for (const name of fs.readdirSync(pythonDest).filter((n) => n.endsWith('._pth'))) {
    const pth = path.join(pythonDest, name);
    let text = fs.readFileSync(pth, 'utf8');
    if (!text.includes('Lib/site-packages')) text += '\nLib/site-packages\n';
    fs.writeFileSync(pth, text);
  }
  fs.copyFileSync(path.join(pythonDest, 'python.exe'), path.join(pythonDest, 'python3.exe'));
  fs.rmSync(path.join(pythonDest, 'get-pip.py'), { force: true });
}

async function ensureRuntime(entry, marker) {
  const dest = path.join(ROOT, entry.dest);
  if (!force && looksPresent(dest, marker) && fs.existsSync(path.join(dest, '.vendor-sha256')) && fs.readFileSync(path.join(dest, '.vendor-sha256'), 'utf8') === entry.sha256) {
    log('keep existing ' + entry.dest);
    if (entry.postProcess === 'mingit-bash') {
      const sh = path.join(dest, 'usr', 'bin', 'sh.exe');
      const bash = path.join(dest, 'usr', 'bin', 'bash.exe');
      if (!fs.existsSync(sh) || !fs.existsSync(bash)) postMingitShells(dest);
    }
    return dest;
  }
  const zipName = path.basename(new URL(entry.url).pathname);
  const zip = await fetchVerified(entry, zipName);
  extractZip(zip, dest, entry.strip || 0);
  if (entry.postProcess === 'mingit-bash') postMingitShells(dest);
  if (entry.postProcess === 'python-embed-site') postPythonSite(dest);
  fs.writeFileSync(path.join(dest, '.vendor-sha256'), entry.sha256);
  return dest;
}

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  await ensureRuntime(LOCK.git, path.join('usr', 'bin', 'sh.exe'));
  await ensureRuntime(LOCK.node, 'node.exe');
  const py = await ensureRuntime(LOCK.python, 'python.exe');
  await installPip(py);
  log('vendors ready');
})().catch((e) => fail(e.stack || e.message));

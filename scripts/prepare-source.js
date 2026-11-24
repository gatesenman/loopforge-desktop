"use strict";
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { walkDir } = require('../src/zipfile');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function sourceHashes(dir) {
  return Object.fromEntries(walkDir(dir).sort((a,b) => a.name.localeCompare(b.name, 'en')).map(e => [e.name, sha(e.file)]));
}
function verifySource(dir, expected) {
  const actual = sourceHashes(dir);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Complete source content differs from its manifest');
}
function prepareSource(root, source, lock) {
  const patch = path.join(root, lock.patch);
  if (sha(patch) !== lock.patchSha256) throw new Error('Desktop patch SHA256 mismatch');
  const own = path.dirname(source);
  fs.mkdirSync(own, { recursive: true });
  if (process.env.LOOPFORGE_SOURCE_BUNDLE) {
    const bundle = path.resolve(process.env.LOOPFORGE_SOURCE_BUNDLE);
    const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'source-manifest.json')));
    if (manifest.upstreamCommit !== lock.commit || manifest.patchSha256 !== lock.patchSha256) throw new Error('Source bundle provenance differs');
    const upstream = path.join(bundle, 'upstream');
    verifySource(upstream, manifest.upstreamFiles);
    if (path.resolve(source) === upstream) throw new Error('Build destination must not overwrite source bundle');
    fs.rmSync(source, { recursive: true, force: true });
    fs.cpSync(upstream, source, { recursive: true });
    return { symlinks: manifest.upstreamSymlinks || {} };
  }
  let repo = process.env.LOOPFORGE_SRC;
  if (!repo && fs.existsSync('/workspace/LoopForge/.git')) repo = '/workspace/LoopForge';
  const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (!repo) {
    repo = path.join(own, 'upstream-cache');
    if (!fs.existsSync(path.join(repo, '.git'))) { fs.mkdirSync(repo, { recursive: true }); run('git', ['init', repo]); }
    run('git', ['-c', 'core.longpaths=true', 'fetch', '--depth=1', lock.repo, lock.commit], repo);
  }
  const actual = execFileSync('git', ['rev-parse', `${lock.commit}^{commit}`], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  if (actual !== lock.commit) throw new Error('Pinned commit unavailable');
  fs.rmSync(source, { recursive: true, force: true });
  fs.mkdirSync(source, { recursive: true });
  const archive = path.join(own, 'upstream.tar');
  run('git', ['archive', '--format=tar', '-o', archive, lock.commit], repo);
  run('tar', ['-xf', archive, '-C', source]);
  fs.unlinkSync(archive);
  // Preserve symlink blobs as portable pointer files on Windows; retain exact
  // original targets in the source manifest so POSIX links can be restored.
  const symlinks = {};
  const tree = execFileSync('git', ['ls-tree', '-rz', lock.commit], { cwd: repo, encoding: 'utf8', windowsHide: true });
  for (const row of tree.split('\0').filter(Boolean)) {
    if (!row.startsWith('120000 ')) continue;
    const name = row.slice(row.indexOf('\t') + 1);
    const target = execFileSync('git', ['show', `${lock.commit}:${name}`], { cwd: repo, encoding: 'utf8', windowsHide: true });
    symlinks[name] = target;
    const file = path.join(source, name);
    try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    fs.writeFileSync(file, target);
  }
  run('git', ['init', source]);
  run('git', ['config', 'core.longpaths', 'true'], source);
  run('git', ['apply', '--check', patch], source);
  run('git', ['apply', '--whitespace=nowarn', patch], source);
  fs.rmSync(path.join(source, '.git'), { recursive: true, force: true });
  return { symlinks };
}
module.exports = { prepareSource, sourceHashes, verifySource };

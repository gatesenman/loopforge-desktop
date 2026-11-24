#!/usr/bin/env node
"use strict";
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
function digest(file, algo = 'sha256', encoding = 'hex') { return crypto.createHash(algo).update(fs.readFileSync(file)).digest(encoding); }
function guiPE(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString('ascii',0,2), 'MZ', 'Expected PE executable: ' + file);
  const pe = data.readUInt32LE(0x3c);
  assert.equal(data.readUInt32LE(pe), 0x4550);
  assert.equal(data.readUInt16LE(pe + 24 + 68), 2, 'Console subsystem is forbidden: ' + file);
}
function verifyPackage(root) {
  const { extractFile } = require('@electron/asar');
  const yaml = require('js-yaml');
  const pkg = require(path.join(root, 'package.json'));
  const dir = path.join(root, 'dist/win-unpacked');
  const res = path.join(dir, 'resources');
  const archive = path.join(res, 'app.asar');
  assert.equal(JSON.parse(extractFile(archive, 'package.json')).version, pkg.version);
  for (const file of fs.readdirSync(path.join(root, 'src'))) {
    assert.deepEqual(extractFile(archive, 'src/' + file), fs.readFileSync(path.join(root, 'src', file)), 'Packaged source mismatch: ' + file);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(res, 'bin/build-manifest.json')));
  const lock = require(path.join(root, 'scripts/vendor-lock.json')).loopforge;
  assert.equal(manifest.commit, lock.commit); assert.equal(manifest.patchSha256, lock.patchSha256);
  for (const [name, info] of Object.entries(manifest.bins)) {
    const file = path.join(res, 'bin', name); assert.equal(digest(file), info.sha256); assert.equal(fs.statSync(file).size, info.bytes); guiPE(file);
  }
  guiPE(path.join(dir, 'LoopForge.exe'));
  for (const file of ['runtime/node/node.exe','runtime/node/node_modules/npm/bin/npm-cli.js','runtime/node/node_modules/npm/node_modules/semver/package.json','runtime/git/cmd/git.exe','runtime/git/usr/bin/bash.exe','runtime/python/python.exe','licenses/LICENSE-LoopForge.txt']) assert.ok(fs.statSync(path.join(res,file)).size > 0, 'Missing bundled resource: ' + file);
  assert.ok(!fs.readdirSync(path.join(res,'bin')).some(name => /-linux-|^loopforge-account/.test(name)));
  const installer = `LoopForge-Setup-${pkg.version}.exe`;
  const file = path.join(root, 'dist', installer);
  const latest = yaml.load(fs.readFileSync(path.join(root, 'dist/latest.yml'), 'utf8'));
  assert.equal(latest.version, pkg.version); assert.equal(latest.path, installer);
  assert.equal(latest.sha512, digest(file, 'sha512', 'base64'));
  const listed = latest.files.find(e => e.url === installer); assert.ok(listed);
  assert.equal(listed.sha512, latest.sha512); assert.equal(listed.size, fs.statSync(file).size);
  assert.ok(fs.statSync(file + '.blockmap').size > 0);
  const result = { version: pkg.version, sourceMatch: true, bundledResourcesPresent: true, guiSubsystems: true, binaryHashesMatch: true, updateMetadataMatch: true, installer, sha256: digest(file) };
  fs.writeFileSync(path.join(root,'dist/package-verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  return result;
}
if (require.main === module) verifyPackage(path.resolve(__dirname, '..'));
module.exports = { guiPE, verifyPackage };

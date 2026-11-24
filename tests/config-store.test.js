"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readConfig, writeConfig } = require('../src/config-store');
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-config-'));
  try { fn(path.join(dir, 'desktop-config.json'), dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('first run stays compatible and writes preserve unknown preferences and ciphertext', () => fixture((file) => {
  assert.deepEqual(readConfig(file), { config: {}, recovered: false });
  const cfg = { sessionSecretEnc: 'opaque-dpapi', extraEnv: { CUSTOM: 'value' }, npmMirror: false };
  writeConfig(file, cfg);
  assert.deepEqual(readConfig(file), { config: cfg, recovered: false });
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  writeConfig(file, { ...cfg, npmMirror: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak')), cfg);
}));
test('truncated primary recovers without rotating corruption over known-good backup', () => fixture((file) => {
  const cfg = { sessionSecret: 'original-secret', port: 18091 };
  writeConfig(file, cfg); writeConfig(file, { ...cfg, port: 18092 });
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(readConfig(file), { config: cfg, recovered: true });
  writeConfig(file, cfg);
  assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak')), cfg);
  assert.deepEqual(readConfig(file), { config: cfg, recovered: false });
}));
test('missing primary recovers valid backup rather than generating a new identity', () => fixture((file) => {
  fs.writeFileSync(file + '.bak', JSON.stringify({ sessionSecretEnc: 'old-protected-key' }));
  assert.equal(readConfig(file).recovered, true);
  assert.equal(readConfig(file).config.sessionSecretEnc, 'old-protected-key');
}));
test('invalid JSON roots and secret types fail closed and remain byte-for-byte intact', () => fixture((file) => {
  for (const bad of ['null', '[]', '42', '{truncated', '{"sessionSecret":42}']) {
    fs.writeFileSync(file, bad);
    assert.throws(() => readConfig(file), /原文件已保留/);
    assert.throws(() => writeConfig(file, {}), /保留原文件/);
    assert.equal(fs.readFileSync(file, 'utf8'), bad);
  }
}));
test('invalid backup cannot turn a missing primary into first run', () => fixture((file) => {
  fs.writeFileSync(file + '.bak', '{bad');
  assert.throws(() => readConfig(file));
  assert.throws(() => writeConfig(file, {}));
  assert.equal(fs.existsSync(file), false);
}));
test('rename failure leaves previous primary and backup readable and removes temporary files', () => fixture((file, dir) => {
  writeConfig(file, { sessionSecret: 'keep-me' });
  const rename = fs.renameSync;
  fs.renameSync = function(src, dst) {
    if (dst === file) throw Object.assign(new Error('simulated full disk/locked file'), { code: 'EACCES' });
    return rename(src, dst);
  };
  try { assert.throws(() => writeConfig(file, { sessionSecret: 'replacement' }), /simulated/); }
  finally { fs.renameSync = rename; }
  assert.equal(readConfig(file).config.sessionSecret, 'keep-me');
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak')).sessionSecret, 'keep-me');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['desktop-config.json', 'desktop-config.json.bak']);
}));
test('read permission errors are not swallowed into first-run defaults', () => fixture((file) => {
  const read = fs.readFileSync;
  fs.readFileSync = function(src, ...args) {
    if (src === file) throw Object.assign(new Error('simulated read denied'), { code: 'EACCES' });
    return read(src, ...args);
  };
  try { assert.throws(() => readConfig(file), /simulated read denied/); }
  finally { fs.readFileSync = read; }
}));
test('invalid replacement is rejected before existing config or backup changes', () => fixture((file) => {
  writeConfig(file, { port: 18090 });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => writeConfig(file, []));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(file + '.bak'), false);
}));

test('flush failure never replaces the primary and cleans the partial temporary file', () => fixture((file, dir) => {
  writeConfig(file, { port: 18090 });
  const flush = fs.fsyncSync;
  fs.fsyncSync = () => { throw Object.assign(new Error('simulated flush failure'), { code: 'ENOSPC' }); };
  try { assert.throws(() => writeConfig(file, { port: 18091 }), /simulated flush/); }
  finally { fs.fsyncSync = flush; }
  assert.equal(readConfig(file).config.port, 18090);
  assert.deepEqual(fs.readdirSync(dir), ['desktop-config.json']);
}));

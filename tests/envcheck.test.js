"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkDataDir, requiredReady } = require('../src/envcheck');
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-probe-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('environment write check never touches preexisting .write-test and cleans its own probe', () => fixture(dir => {
  fs.writeFileSync(path.join(dir, '.write-test'), 'USER DATA');
  assert.notEqual(checkDataDir(dir).status, 'error');
  assert.equal(fs.readFileSync(path.join(dir, '.write-test'), 'utf8'), 'USER DATA');
  assert.deepEqual(fs.readdirSync(dir), ['.write-test']);
}));
test('failed probe write cleans owned directory, reports IO code without leaking arbitrary error text', () => fixture(dir => {
  const write = fs.writeFileSync;
  fs.writeFileSync = () => { throw Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'ENOSPC' }); };
  let result;
  try { result = checkDataDir(dir); } finally { fs.writeFileSync = write; }
  assert.equal(result.status, 'error'); assert.match(result.detail, /ENOSPC/);
  assert.ok(!result.detail.includes('PRIVATE_SENTINEL'));
  assert.deepEqual(fs.readdirSync(dir), []);
}));
test('directory failures return errors and do not overwrite blocking user files', () => fixture(dir => {
  const file = path.join(dir, 'user.txt'); fs.writeFileSync(file, 'unchanged');
  assert.equal(checkDataDir(file).status, 'error');
  assert.equal(fs.readFileSync(file, 'utf8'), 'unchanged');
}));
test('readiness requires all actual required checks, never a stale or forged summary alone', () => {
  const results = ['server', 'datadir', 'git', 'sh', 'node', 'npm', 'python'].map(id => ({ id, level: 'required', status: 'ok' }));
  assert.equal(requiredReady({ results, summary: { requiredOk: true } }), true);
  assert.equal(requiredReady(results), true);
  assert.equal(requiredReady({ summary: { requiredOk: true } }), false);
  assert.equal(requiredReady({ results: results.slice(1), summary: { requiredOk: true } }), false);
  assert.equal(requiredReady({ results: results.map(r => r.id === 'npm' ? { ...r, status: 'error' } : r), summary: { requiredOk: true } }), false);
});

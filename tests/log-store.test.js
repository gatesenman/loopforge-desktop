"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readTail, openBoundedLog } = require('../src/log-store');
test('tail reader is bounded and missing logs are optional', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-tail-'));
  try {
    const file = path.join(dir, 'log'); fs.writeFileSync(file, 'x'.repeat(100000) + 'TAIL');
    assert.equal(readTail(file, 8), 'xxxxTAIL'); assert.equal(readTail(file + '.missing'), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('logger caps bytes, ignores writes after end, and rotates on next startup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-log-'));
  try {
    const file = path.join(dir, 'log');
    const log = openBoundedLog(file, { maxBytes: 256 });
    log.write('x'.repeat(1000)); log.write('ignored'); const closed = log.end(); log.write('late');
    await closed; assert.equal(fs.statSync(file).size, 256); assert.match(readTail(file), /log size limit/);
    const next = openBoundedLog(file, { maxBytes: 256 }); next.write('fresh'); await next.end();
    assert.equal(readTail(file), 'fresh'); assert.equal(fs.statSync(file + '.1').size, 256);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('asynchronous stream-open failure is handled once, without uncaught error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-error-'));
  try {
    let errors = 0; const log = openBoundedLog(dir, { onError: () => errors++ });
    log.write('test'); await log.end(); log.write('late');
    assert.equal(log.failed, true); assert.equal(errors, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

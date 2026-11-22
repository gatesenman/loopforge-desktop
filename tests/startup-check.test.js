'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requiredChecksPass } = require('../src/startup-check');
test('startup checks fail closed on unavailable, failed, or throwing checks', async () => {
  const ready = (r) => r.summary.requiredOk;
  assert.equal(await requiredChecksPass(async () => ({ summary: { requiredOk: true } }), ready), true);
  for (const report of [null, undefined, {}, { summary: { requiredOk: false } }]) {
    assert.equal(await requiredChecksPass(async () => report, ready), false);
  }
  const lines = [];
  assert.equal(await requiredChecksPass(async () => { throw Error('PRIVATE_ENV_VALUE'); }, ready, (s) => lines.push(s)), false);
  assert.equal(lines.length, 1);
  assert.ok(!lines.join('').includes('PRIVATE_ENV_VALUE'));
});

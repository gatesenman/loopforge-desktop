"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycle } = require('../src/lifecycle');
const tick = () => new Promise(setImmediate);
test('concurrent lifecycle operations are serialized, including recovery after rejection', async () => {
  const gate = createLifecycle(); const calls = []; let release;
  const first = gate.run(async () => { calls.push('start'); await new Promise(r => { release = r; }); calls.push('ready'); });
  const failed = gate.run(() => { calls.push('stop'); throw Error('stop failure'); });
  const handled = assert.rejects(failed, /stop failure/);
  const last = gate.run(() => calls.push('restart'));
  await tick(); assert.deepEqual(calls, ['start']);
  release(); await Promise.all([first, handled, last]);
  assert.deepEqual(calls, ['start', 'ready', 'stop', 'restart']);
});
test('manual cancellation invalidates a crash restart already queued behind startup', async () => {
  const timers = []; const gate = createLifecycle({ setTimer: fn => (timers.push(fn), timers.length), clearTimer: () => {} });
  let release; const calls = [];
  const active = gate.run(() => new Promise(r => { release = r; }));
  await tick(); gate.schedule(() => calls.push('obsolete'), 1); timers[0]();
  gate.cancelRestart(); release(); await active; await tick();
  assert.deepEqual(calls, []);
});
test('shutdown invalidates pending boot and late timer callbacks', async () => {
  const timers = []; const gate = createLifecycle({ setTimer: fn => (timers.push(fn), 1), clearTimer: () => {} });
  const calls = [];
  gate.schedule(() => calls.push('late restart'), 1);
  const boot = gate.run(() => calls.push('pending boot'));
  gate.close(); timers[0](); await boot; await tick();
  await gate.run(() => calls.push('after close'));
  assert.deepEqual(calls, []);
});
test('only the latest scheduled restart runs', async () => {
  const timers = []; const cleared = [];
  const gate = createLifecycle({ setTimer: fn => (timers.push(fn), timers.length), clearTimer: id => cleared.push(id) });
  const calls = [];
  gate.schedule(() => calls.push('old'), 1); gate.schedule(() => calls.push('new'), 1);
  timers[0](); timers[1](); await tick();
  assert.deepEqual(cleared, [1]); assert.deepEqual(calls, ['new']);
});

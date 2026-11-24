"use strict";
// Serialize user boots/restarts and own delayed crash restarts. Errors do not
// poison the queue. Closing invalidates queued and delayed work, not active IO.
function createLifecycle({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let tail = Promise.resolve();
  let closed = false;
  let timer = null;
  let generation = 0;
  function run(fn) {
    const next = tail.then(() => closed ? undefined : fn());
    tail = next.catch(() => {});
    return next;
  }
  function cancelRestart() {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function schedule(fn, delay) {
    cancelRestart();
    if (closed) return;
    const own = generation;
    timer = setTimer(() => {
      timer = null;
      // Cancellation also invalidates callbacks already waiting in the queue.
      run(() => { if (own === generation) return fn(); }).catch(() => {});
    }, delay);
  }
  function close() { closed = true; cancelRestart(); }
  return { run, schedule, cancelRestart, close };
}
module.exports = { createLifecycle };

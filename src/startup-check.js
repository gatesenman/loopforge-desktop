'use strict';
// A failed or unavailable required check must never bypass first-run validation.
async function requiredChecksPass(collect, ready, log = () => {}) {
  try {
    const report = await collect();
    return !!report && !!ready(report);
  } catch (_) {
    // Exceptions may include paths, commands or environment values: don't log them.
    log('silent required environment check failed; opening environment check');
    return false;
  }
}
module.exports = { requiredChecksPass };

 'use strict';
function sanitizeConfig(cfg = {}) {
  return { runtimeMode: 'local', npmMirror: cfg.npmMirror === true,
    firstRunDone: cfg.firstRunDone === true, port: Number.isInteger(cfg.port) ? cfg.port : null };
}
function sanitizeChecks(report = {}) {
  const levels = new Set(['required', 'agent', 'optional', 'recommended']);
  const states = new Set(['ok', 'warn', 'error', 'missing', 'skip']);
  return { results: (report.results || []).map((r) => ({
    id: /^[a-z0-9-]{1,40}$/.test(r.id || '') ? r.id : 'unknown',
    level: levels.has(r.level) ? r.level : 'unknown',
    status: states.has(r.status) ? r.status : 'unknown',
    bundled: r.bundled === true,
    version: /^\d+\.\d+(?:\.\d+)?$/.test(r.version || '') ? r.version : null,
  })) };
}
function lifecycleSummary(text = '') {
  // Export counts, never any part of a potentially secret-bearing line.
  return { exits: (text.match(/^===== server exited /gm) || []).length,
    restarts: (text.match(/^===== supervisor restart /gm) || []).length,
    healthFailures: (text.match(/^===== health check failed /gm) || []).length };
}
module.exports = { sanitizeConfig, sanitizeChecks, lifecycleSummary };

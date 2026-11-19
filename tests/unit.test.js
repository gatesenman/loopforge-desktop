'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { sanitizeConfig, sanitizeChecks, lifecycleSummary } = require('../src/redaction');
const { addFile, writeZip } = require('../src/zipfile');
function withElectron(mock, file, fn) {
  const old = Module._load;
  Module._load = function(id, ...args) { return id === 'electron' ? mock : old.call(this, id, ...args); };
  try { delete require.cache[require.resolve(file)]; fn(require(file)); }
  finally { Module._load = old; }
}
test('diagnostics allowlist excludes unknown secrets, nested extraEnv, raw log lines and check output', () => {
  const secret = 'SENSITIVE_SENTINEL_123';
  const report = {
    config: sanitizeConfig({ sessionSecret: secret, sessionSecretEnc: secret, extraEnv: { UNKNOWN: secret }, unexpected: secret }),
    checks: sanitizeChecks({ results: [{ id: 'git', level: 'required', status: 'ok', detail: secret, path: secret, version: secret, actions: [{ command: secret }] }] }),
    logs: lifecycleSummary('===== server exited code=1 secret=' + secret + '\nrandom=' + secret),
  };
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.equal(report.logs.exits, 1);
});
test('session secret migrates to ciphertext; failed encryption removes stale ciphertext but preserves working fallback', () => {
  withElectron({ safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('protected:' + s),
    decryptString: (b) => b.toString().replace('protected:', ''),
  } }, '../src/secret', (secret) => {
    const disk = secret.toDisk({ sessionSecret: 'value' }, true);
    assert.equal(disk.sessionSecret, undefined);
    assert.equal(secret.fromDisk(disk, true).sessionSecret, 'value');
  });
  withElectron({ safeStorage: { isEncryptionAvailable: () => true, encryptString: () => { throw Error('DPAPI unavailable'); } } }, '../src/secret', (secret) => {
    const disk = secret.toDisk({ sessionSecret: 'working', sessionSecretEnc: 'STALE' }, true);
    assert.equal(disk.sessionSecret, 'working');
    assert.equal(disk.sessionSecretEnc, undefined);
  });
});
test('ZIP uses standard CRC32 without Node22-only APIs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-zip-'));
  try {
    const entries = []; addFile(entries, 'crc.txt', '123456789');
    const dest = path.join(tmp, 'test.zip'); writeZip(entries, dest);
    const data = fs.readFileSync(dest);
    assert.equal(data.readUInt32LE(14), 0xcbf43926);
    assert.equal(data.readUInt32LE(0), 0x04034b50);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

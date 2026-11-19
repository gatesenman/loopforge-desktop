'use strict';
// Protect the sidecar session secret with Windows DPAPI via Electron safeStorage.
// If encryption is unavailable or fails, keep a plaintext fallback so startup never bricks.
const { safeStorage } = require('electron');

function canEncrypt(isWin) {
  if (!isWin) return false;
  try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); } catch (_) { return false; }
}

function toDisk(cfg, isWin) {
  const out = { ...cfg };
  if (out.sessionSecret && canEncrypt(isWin)) {
    try {
      out.sessionSecretEnc = safeStorage.encryptString(out.sessionSecret).toString('base64');
      delete out.sessionSecret;
    } catch (_) {
      // Leave sessionSecret in plaintext; do not delete the working value.
    }
  }
  return out;
}

function fromDisk(cfg, isWin) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  if (cfg.sessionSecretEnc && !cfg.sessionSecret && canEncrypt(isWin)) {
    try {
      cfg.sessionSecret = safeStorage.decryptString(Buffer.from(cfg.sessionSecretEnc, 'base64'));
    } catch (_) {
      // Caller should generate a new secret if this remains unset.
    }
  }
  return cfg;
}

module.exports = { canEncrypt, toDisk, fromDisk };

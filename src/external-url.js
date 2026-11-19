'use strict';

function parseWebUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0:0:0:0:0:0:0:1';
}

/**
 * URLs the desktop shell may open in the OS browser or navigate to.
 * https is allowed so in-app OAuth can continue in the system browser.
 * plain http is limited to the local LoopForge service on loopback.
 */
function isAllowedExternalUrl(value, { serverUrl } = {}) {
  const url = parseWebUrl(value);
  if (!url) return false;
  const target = String(value).trim();
  if (serverUrl && target.startsWith(serverUrl)) return true;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

module.exports = { parseWebUrl, isLoopbackHost, isAllowedExternalUrl };

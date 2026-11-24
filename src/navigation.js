"use strict";
const { pathToFileURL } = require('url');
const path = require('path');
function isLocalPage(raw, baseDir) {
  try {
    const url = new URL(raw);
    url.search = ''; url.hash = '';
    return ['envcheck.html', 'error.html', 'splash.html'].some(name => url.href === pathToFileURL(path.join(baseDir, name)).href);
  } catch (_) { return false; }
}
function navigationKind(raw, serverUrl, baseDir) {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return 'deny';
    if (isLocalPage(raw, baseDir)) return 'local';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'deny';
    if (serverUrl && url.origin === new URL(serverUrl).origin) return 'internal';
    return 'external';
  } catch (_) { return 'deny'; }
}
module.exports = { navigationKind, isLocalPage };

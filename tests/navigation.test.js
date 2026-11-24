"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { navigationKind, isLocalPage } = require('../src/navigation');
const base = path.resolve('fixture with spaces');
const server = 'http://127.0.0.1:18090';
const kind = raw => navigationKind(raw, server, base);
test('internal navigation compares exact origin, not prefix', () => {
  assert.equal(kind(server + '/projects?q=x#y'), 'internal');
  for (const raw of [server + '0/', server + '.evil.test/', 'http://127.0.0.1:18091/', 'https://127.0.0.1:18090/']) {
    assert.notEqual(kind(raw), 'internal');
  }
  assert.equal(kind('http://127.0.0.1:18090@evil.test/'), 'deny');
  assert.equal(kind('http://user:secret@127.0.0.1:18090/'), 'deny');
  assert.equal(navigationKind(server, null, base), 'external');
});
test('only exact local app pages are privileged, with queries and fragments supported', () => {
  const file = pathToFileURL(path.join(base, 'envcheck.html')).href;
  assert.equal(kind(file + '?first=1#top'), 'local');
  assert.equal(isLocalPage(file + '?first=1#top', base), true);
  for (const raw of [pathToFileURL(path.join(base, 'other.html')).href, file + '.evil', 'file:///etc/passwd', server + '/envcheck.html']) {
    assert.equal(isLocalPage(raw, base), false);
  }
});
test('unsafe schemes, malformed URLs and network file hosts are denied', () => {
  for (const raw of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/', 'file://evil/share/envcheck.html', 'not a URL', 'about:blank']) assert.equal(kind(raw), 'deny');
  assert.equal(kind('https://example.com/login'), 'external');
});

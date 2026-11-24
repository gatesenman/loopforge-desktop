"use strict";
const fs = require('fs');
const path = require('path');
function readTail(file, limit = 64 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const data = Buffer.alloc(Math.min(size, limit));
    const count = fs.readSync(fd, data, 0, data.length, Math.max(0, size - data.length));
    return data.subarray(0, count).toString('utf8');
  } catch (_) { return ''; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function openBoundedLog(file, { maxBytes = 10 * 1024 * 1024, onError = () => {} } = {}) {
  let stream; let ended = false; let failed = false; let bytes = 0;
  const fail = () => { if (!failed) { failed = true; onError(); } };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { bytes = fs.statSync(file).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (bytes >= maxBytes) { fs.renameSync(file, file + '.1'); bytes = 0; }
    stream = fs.createWriteStream(file, { flags: 'a', mode: 0o600 });
    stream.on('error', fail); // Disk-full/ACL errors must never crash Electron.
  } catch (_) { fail(); }
  return {
    write(value) {
      if (ended || failed || !stream || bytes >= maxBytes) return;
      const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      const marker = Buffer.from('\n===== log size limit reached; reopen app to rotate =====\n');
      const room = maxBytes - bytes;
      if (data.length >= room - marker.length) {
        const prefix = data.subarray(0, Math.max(0, room - marker.length));
        const final = Buffer.concat([prefix, marker]).subarray(0, room);
        bytes += final.length; stream.write(final);
      } else { bytes += data.length; stream.write(data); }
    },
    end() { if (!ended) { ended = true; if (stream) stream.end(); } },
    get failed() { return failed; },
  };
}
module.exports = { readTail, openBoundedLog };

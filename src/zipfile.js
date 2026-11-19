'use strict';
// Minimal ZIP writer (store + deflate). No third-party dependency.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
// Electron 33 uses Node 20, which does not expose zlib.crc32.
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date || new Date();
  const dosTime = (d.getSeconds() / 2) | (d.getMinutes() << 5) | (d.getHours() << 11);
  const dosDate = d.getDate() | ((d.getMonth() + 1) << 5) | ((d.getFullYear() - 1980) << 9);
  return { dosTime, dosDate };
}

function encodeName(name) {
  const utf8 = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
  return utf8;
}

function addFile(entries, name, data, date) {
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const compressed = zlib.deflateRawSync(raw);
  const useDeflate = compressed.length < raw.length;
  const payload = useDeflate ? compressed : raw;
  const { dosTime, dosDate } = dosDateTime(date);
  const nameBuf = encodeName(name);
  const crc = crc32(raw);
  entries.push({
    name: nameBuf, raw, payload, method: useDeflate ? 8 : 0,
    crc, rawSize: raw.length, compSize: payload.length, dosTime, dosDate,
  });
}

function addFileFromDisk(entries, name, filePath) {
  addFile(entries, name, fs.readFileSync(filePath), fs.statSync(filePath).mtime);
}

function writeZip(entries, dest) {
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(e.dosTime, 10);
    local.writeUInt16LE(e.dosDate, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.compSize, 18);
    local.writeUInt32LE(e.rawSize, 22);
    local.writeUInt16LE(e.name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, e.name, e.payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt16LE(e.dosTime, 12);
    central.writeUInt16LE(e.dosDate, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.compSize, 20);
    central.writeUInt32LE(e.rawSize, 24);
    central.writeUInt16LE(e.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, e.name);
    offset += 30 + e.name.length + e.compSize;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of centrals) centralSize += c.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.concat([...chunks, ...centrals, end]));
  return dest;
}

function walkDir(dir, skip) {
  const out = [];
  const walk = (cur, rel) => {
    for (const name of fs.readdirSync(cur)) {
      const relPath = rel ? rel + '/' + name : name;
      if (skip && skip(relPath, path.join(cur, name))) continue;
      const st = fs.lstatSync(path.join(cur, name));
      if (st.isDirectory()) walk(path.join(cur, name), relPath);
      else if (st.isFile()) out.push({ file: path.join(cur, name), name: relPath, mtime: st.mtime });
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
}

module.exports = { addFile, addFileFromDisk, writeZip, walkDir };

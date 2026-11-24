"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sourceHashes, verifySource } = require('../scripts/prepare-source');
const { guiPE } = require('../scripts/verify-package');
test('complete-source verification rejects modified, missing and extra files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-source-'));
  try {
    const file = path.join(dir,'source.txt'); fs.writeFileSync(file,'original');
    const manifest=sourceHashes(dir); verifySource(dir,manifest);
    fs.writeFileSync(file,'tampered'); assert.throws(()=>verifySource(dir,manifest));
    fs.writeFileSync(file,'original'); fs.writeFileSync(path.join(dir,'extra'),'unexpected'); assert.throws(()=>verifySource(dir,manifest));
    fs.unlinkSync(path.join(dir,'extra')); fs.unlinkSync(file); assert.throws(()=>verifySource(dir,manifest));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('PE gate accepts GUI subsystem and rejects console subsystem', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-pe-'));
  try {
    const file=path.join(dir,'fixture.exe'); const data=Buffer.alloc(256);
    data.write('MZ'); data.writeUInt32LE(64,0x3c); data.writeUInt32LE(0x4550,64); data.writeUInt16LE(2,64+24+68);
    fs.writeFileSync(file,data); guiPE(file);
    data.writeUInt16LE(3,64+24+68); fs.writeFileSync(file,data); assert.throws(()=>guiPE(file),/Console subsystem/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

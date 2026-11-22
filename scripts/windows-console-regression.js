#!/usr/bin/env node
'use strict';
// Native regression on the real prepared production runCommand function. No mocks.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
assert.equal(process.platform,'win32','Requires native Windows');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'vendor-dl/_src/prepared');
const file=path.join(source,'internal/runtime/process.go');
const original=fs.readFileSync(file);
const text=original.toString('utf8');
assert.equal((text.match(/\thideCommandWindow\(cmd\)/g)||[]).length,1,'Expected fixed production launch boundary');
const invoke=()=>spawnSync('go',['test','./internal/runtime','-run','^TestDesktopRunCommandHidesUngroupedWindowsChild$','-count=1'],{cwd:source,env:{...process.env,CGO_ENABLED:'0',GOTOOLCHAIN:'local'},encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:4*1024*1024});
const fixed=invoke();
if(fixed.status!==0) throw Error('Fixed native command regression failed: '+fixed.stdout+fixed.stderr);
let before;
try {
  // Intentionally restore the exact pre-fix omission, only in this script-owned
  // prepared source, then require this specific runtime assertion to fail.
  fs.writeFileSync(file,text.replace(/\thideCommandWindow\(cmd\)\r?\n/,''));
  before=invoke();
  assert.notEqual(before.status,0,'Regression must fail before fix');
  assert.match(before.stdout+before.stderr,/runCommand did not hide an ungrouped Windows script/,'Must reproduce real missing flags, not a compilation/network error');
} finally { fs.writeFileSync(file,original); }
assert.deepEqual(fs.readFileSync(file),original,'Production source must be restored byte-for-byte');
const out=path.join(root,'.smoke/console-regression.json');fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify({nativeWindows:true,mocked:false,source:'internal/runtime/process.go',test:'TestDesktopRunCommandHidesUngroupedWindowsChild',fixedPass:true,preFixFailureReproduced:true,sourceRestored:true},null,2)+'\n');
console.log('Native real ungrouped command regression passed; pre-fix failure reproduced; source restored.');

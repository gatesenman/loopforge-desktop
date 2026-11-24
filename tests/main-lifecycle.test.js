"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
test('real main before-quit cancels a startup awaiting port selection before any child spawn', async () => {
  const events = {}; let spawned = false;
  const app = { setName(){}, setPath(){}, getPath:()=>'/unused-fixture', requestSingleInstanceLock:()=>true,
    on:(name,fn)=>{events[name]=fn;}, whenReady:()=>new Promise(()=>{}), quit(){} };
  const file=path.resolve(__dirname,'../src/main.js'); const local=createRequire(file);
  const context=vm.createContext({require:id=>{
    if(id==='electron') return {app,ipcMain:{handle(){}}};
    if(id==='child_process') return {spawn(){spawned=true;throw Error('must not spawn');},execFile(){}};
    if(['./secret','./updater','./diagnostics'].includes(id)) return {};
    return local(id);
  }, __dirname:path.dirname(file),process:{platform:process.platform,env:{},argv:[]},setTimeout,clearTimeout,setInterval,clearInterval,console,URL,Buffer});
  vm.runInContext(fs.readFileSync(file,'utf8'),context);
  let release; context.portPromise=new Promise(r=>{release=r;});
  vm.runInContext('pickPort = () => portPromise',context);
  const start=vm.runInContext('startServer()',context);
  events['before-quit']({preventDefault(){throw Error('No child exists to drain yet');}});
  release(18090);
  await assert.rejects(start,/启动已取消/);
  assert.equal(vm.runInContext('quitting',context),true);
  assert.equal(spawned,false);
});

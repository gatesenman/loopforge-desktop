'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getFileMatchers, copyFiles } = require('app-builder-lib/out/fileMatcher');

test('real packager resource filters preserve bundled npm CLI and nested dependencies', async (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'LoopForge Packaging With Spaces '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const relative=['node.exe','npm.cmd','node_modules/npm/bin/npm-cli.js','node_modules/npm/node_modules/semver/index.js'];
  for(const file of relative){const p=path.join(root,'vendor-dl/node',file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fixture:'+file)}
  const resources=path.join(root,'resources');
  const config={extraResources:require('../package.json').build.extraResources.filter(r=>r.from.startsWith('vendor-dl/node'))};
  const matchers=getFileMatchers(config,'extraResources',resources,{defaultSrc:root,globalOutDir:path.join(root,'dist'),customBuildOptions:{},macroExpander:s=>s});
  await copyFiles(matchers);
  for(const file of relative) assert.equal(fs.readFileSync(path.join(resources,'runtime/node',file),'utf8'),'fixture:'+file);
});

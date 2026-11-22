'use strict';
// Real NSIS install + installed Electron + real SQLite/runner. No API/provider mocks.
// Never record traces, HAR, config, cookies, raw logs or password forms in artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { _electron: electron, expect } = require('@playwright/test');
const exec = promisify(execFile);
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '.e2e-evidence');
const TEMP = path.join(process.env.RUNNER_TEMP || process.env.TEMP, 'LoopForge Installed Acceptance');
const INSTALL = path.join(TEMP, 'Installed App With Spaces');
let DATA = path.join(process.env.APPDATA, 'LoopForge');
const version = require('../../package.json').version;
const skipLegacy = process.env.LOOPFORGE_ACCEPTANCE_SKIP_LEGACY === '1';
const currentInstaller = path.join(ROOT, 'dist', `LoopForge-Setup-${version}.exe`);
const oldInstaller = path.join(TEMP, 'LoopForge-Setup-0.4.0.exe');
const executablePath = path.join(INSTALL, 'LoopForge.exe');
const result = { buildRun:process.env.LOOPFORGE_ACCEPTANCE_BUILD_RUN || process.env.GITHUB_RUN_ID, testCommit:process.env.GITHUB_SHA, version, nativeWindows: true, installedBinary: false, mockedProviders: false, checks: [], limitations: [
  'NSIS silent installation tested; interactive installer GUI and SmartScreen not tested.',
  'External coding-agent CLI installation/login and paid AI execution not tested; no provider credentials used.',
  '0.3.10 and live auto-update download/restart not tested. Only completed assertions establish upgrade coverage.',
  'Console windows sampled every 20ms; sub-sampling-duration flashes cannot be excluded.',
] };
let app, page, origin, monitor, mainPid, mainHandle, stage=note('initialization'), runId, projectId;
let baselineVersion = '0.4.0';
let authenticated = false;
let workspaceFiles = [];
const password = 'Acceptance-' + crypto.randomBytes(20).toString('hex') + '!';
function note(value) { console.log('STAGE', value); if(monitor) fs.writeFileSync(path.join(TEMP,'acceptance-phase.txt'),value); return value; }
function pass(name, details = {}) { result.checks.push({ name, status: 'pass', ...details }); console.log('PASS', name); }
function filesBelow(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? filesBelow(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function ps(file, args = []) { const p=exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { windowsHide: true, timeout: 240000 }); (result.harnessHelpers ||= []).push({pid:p.child.pid,script:path.basename(file)}); return p; }
async function shot(name) { await page.screenshot({ path: path.join(OUT, name + '.png') }); }
async function install(file) {
  await ps(path.join(__dirname,'install.ps1'), ['-Installer',file,'-Destination',INSTALL,'-WaitSeconds',file===oldInstaller?'45':'120']);
  assert.ok(fs.existsSync(executablePath), 'Installed executable missing');
  assert.ok(fs.existsSync(path.join(INSTALL, 'resources/app.asar')), 'Installed app.asar missing');
}
function safeEnv() {
  const env = {};
  for (const key of ['SystemRoot','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH','PATHEXT','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  // No CI-installed coding agents or provider keys may leak into acceptance.
  env.USERPROFILE=path.join(TEMP,'clean-profile'); env.HOME=env.USERPROFILE;
  env.APPDATA=path.join(env.USERPROFILE,'AppData/Roaming'); env.LOCALAPPDATA=path.join(env.USERPROFILE,'AppData/Local');
  for(const dir of [env.USERPROFILE,env.APPDATA,env.LOCALAPPDATA]) fs.mkdirSync(dir,{recursive:true});
  env.PATH = [path.join(TEMP, 'trap'), path.join(env.SystemRoot, 'System32'), env.SystemRoot].join(';');
  env.LOOPFORGE_PROBE_MARKER = path.join(TEMP, 'unexpected-docker-call');
  return env;
}
async function launch(expectedVersion) {
  app = await electron.launch({ executablePath, env: safeEnv(), timeout: 90000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(45000);
  const metadata = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), data: app.getPath('userData'), mainPid:process.pid, versions:{electron:process.versions.electron,chrome:process.versions.chrome,embeddedNode:process.versions.node,platform:process.platform,arch:process.arch} }));
  result.electronRuntime=metadata.versions;
  mainPid=metadata.mainPid; (result.mainProcesses ||= []).push({pid:mainPid,version:expectedVersion});
  mainHandle=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  assert.equal(metadata.packaged, true); assert.equal(metadata.version, expectedVersion);
  // Chromium may resolve appData through the Windows known-folder API or APPDATA.
  assert.ok(path.resolve(metadata.data).toLowerCase()===DATA.toLowerCase() || path.resolve(metadata.data).toLowerCase().startsWith(TEMP.toLowerCase()+path.sep));
  DATA=metadata.data;
  await page.waitForURL(url => /^http:\/\/127\.0\.0\.1:\d+\//.test(url.href) || url.pathname.endsWith('/envcheck.html'), { timeout: 150000 });
  if (page.url().includes('envcheck.html')) {
    const report=await page.evaluate(()=>window.loopforgeDesktop.check());
    result.blockingRequiredChecks=report.results.filter(r=>r.level==='required').map(({id,status,name,detail,version})=>({id,status,name,detail,version}));
    await shot('blocking-required-checks');
    const failed=result.blockingRequiredChecks.filter(r=>r.status!=='ok');
    if(expectedVersion==='0.4.0' && failed.every(r=>r.id==='npm')) {
      result.legacyBlockingRequiredChecks=result.blockingRequiredChecks; delete result.blockingRequiredChecks;
      result.limitations.push('Legacy 0.4.0 omits bundled npm dependencies: explicitly continued through its real environment-check UI solely to seed migration data. Candidate startup must pass without this waiver.');
      await page.locator('#done').click(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//);
    } else assert.fail('Installed required checks did not pass: '+failed.map(r=>r.id+': '+r.detail).join('; '));
  }
  origin = new URL(page.url()).origin;
  assert.ok(!page.url().includes('envcheck'), 'Required checks must not open blocking wizard');
  if(expectedVersion===version) result.installedBinary=true;
  pass((expectedVersion==='0.4.0' && result.legacyBaselineMode==='published-installer-payload' ? 'published legacy payload GUI launch ' : 'installed GUI launch ') + expectedVersion, { packaged: metadata.packaged });
}
async function api(url) {
  return page.evaluate(async (url) => { const r = await fetch(url); if (!r.ok) throw Error('GET failed: ' + r.status); return r.json(); }, url);
}
async function ready() {
  await expect(page.locator('#projectSwitcher option').first()).toBeAttached({timeout:60000});
  await expect(page.locator('body')).not.toHaveClass(/booting/, {timeout:60000});
  await expect(page.locator('#bootLoader')).toBeHidden({timeout:60000});
}
async function quit() {
  const exited = once(app.process(), 'exit');
  await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu().items.find(i => i.label === '文件');
    const quit = file.submenu.items.find(i => i.role === 'quit');
    setTimeout(() => quit.click(), 0);
  });
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(Error('Graceful menu quit timed out')), 45000))]);
  await expect.poll(async () => { try { await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }); return false; } catch (_) { return true; } }).toBe(true);
  const log = fs.readFileSync(path.join(DATA, 'logs/server.log'), 'utf8');
  assert.equal([...log.matchAll(/server exited code=([^ ]+)/g)].at(-1)?.[1], '0');
  pass('graceful menu quit and sidecar exit');
  app = null;
}
async function loginIfNeeded() {
  if (page.url().includes('login.html')) {
    await page.locator('[name="login"]').fill('acceptance-local-admin');
    await page.locator('[name="password"]').fill(password);
    await page.locator('#loginSubmit').click();
  }
  await ready(); authenticated = true;
}
async function appIconFromInstalledExe() {
  const file=path.join(OUT,'installed-executable-icon.png');
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -AssemblyName System.Drawing; $i=[Drawing.Icon]::ExtractAssociatedIcon('${executablePath.replaceAll("'","''")}'); $b=$i.ToBitmap(); $b.Save('${file.replaceAll("'","''")}'); $b.Dispose(); $i.Dispose()`],{windowsHide:true});
  return fs.readFileSync(file);
}
async function main() {
  assert.equal(process.platform, 'win32', 'Native Windows only; Wine is not acceptance');
  assert.ok(!fs.existsSync(DATA), 'Refuse to touch pre-existing application data');
  assert.ok(!fs.existsSync(TEMP), 'Refuse to overwrite existing acceptance directory');
  fs.mkdirSync(TEMP, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(TEMP, 'trap'));
  fs.copyFileSync(path.join(ROOT, '.smoke/LoopForge Runtime With Spaces/probe trap/docker.exe'), path.join(TEMP, 'trap/docker.exe'));
  stage=note('download pinned previous installer');
  if(!skipLegacy) {
    const response = await fetch('https://github.com/gatesenman/loopforge-desktop/releases/download/v0.4.0/LoopForge-Setup-0.4.0.exe');
    assert.equal(response.status, 200); fs.writeFileSync(oldInstaller, Buffer.from(await response.arrayBuffer()));
    assert.equal(sha(oldInstaller), 'cf6cc71b2141aa59d0aaaef5b888d9c717ebfae021aefa6bda6ead0f85aa54fd');
  }
  result.installer = { file: path.basename(currentInstaller), sha256: sha(currentInstaller), bytes: fs.statSync(currentInstaller).size };
  stage=note('silent install previous release');
  if(skipLegacy) {
    baselineVersion=version;
    result.limitations.push('Fresh candidate and same-version repair mode: no legacy-version migration is claimed by this run.');
    await install(currentInstaller); pass('candidate NSIS fresh per-user installation in path with spaces');
  } else try {
    try { await install(oldInstaller); }
    catch (error) {
      result.legacyInstallerFirstAttemptError=String(error.message).slice(0,1500);
      result.limitations.push('Immutable 0.4.0 installer needed one retry after its known System.dll access violation; candidate installer is not retried.');
      await install(oldInstaller);
    }
    pass('NSIS 0.4.0 per-user silent install in path with spaces');
  } catch (error) {
    // A legacy installer failure must not prevent testing the actual new product.
    result.checks.push({name:'NSIS 0.4.0 baseline installation',status:'fail',error:String(error.message).slice(0,1500)});
    const events = await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-WinEvent -FilterHashtable @{LogName='Application';Id=1000;StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue | Where-Object {$_.Message -like '*LoopForge-Setup-0.4.0.exe*'} | ForEach-Object {$_.Message}) | ConvertTo-Json"],{windowsHide:true}).catch(()=>({stdout:''}));
    fs.writeFileSync(path.join(OUT,'legacy-installer-crash.json'),events.stdout || '[]');
    // A different, explicitly labeled data-only test: real bytes from the pinned
    // published installer, not a recreated/mocked old profile. Keep installer FAIL.
    result.legacyBaselineMode='published-installer-payload';
    result.limitations.push('Published 0.4.0 NSIS failed. Its checksum-pinned real application payload is extracted only to seed synthetic data through the actual old GUI. This is data-format migration coverage, NOT a legacy installer/registered-install upgrade pass.');
    stage=note('extract real published 0.4.0 payload for data-only migration');
    const sevenZip=path.join(process.env.ProgramFiles,'7-Zip/7z.exe');
    assert.ok(fs.existsSync(sevenZip),'7-Zip required for explicitly labeled published legacy payload fixture');
    const unpack=path.join(TEMP,'legacy-installer-payload');
    await exec(sevenZip,['x',oldInstaller,'-o'+unpack,'-y'],{windowsHide:true,timeout:120000});
    const payloads=filesBelow(unpack).filter(f=>/app-64\.7z$/i.test(f));
    assert.equal(payloads.length,1,'Expected exactly one x64 application payload in published NSIS');
    await exec(sevenZip,['x',payloads[0],'-o'+INSTALL,'-y'],{windowsHide:true,timeout:120000});
    assert.ok(fs.existsSync(executablePath)); assert.ok(fs.existsSync(path.join(INSTALL,'resources/app.asar')));
    pass('real published 0.4.0 payload extracted for data-only migration (not legacy installation)');
  }
  monitor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'console-monitor.ps1'), '-StopFile', path.join(TEMP, 'stop-monitor'), '-OutputFile', path.join(OUT, 'console-windows.json'), '-PhaseFile',path.join(TEMP,'acceptance-phase.txt')], { windowsHide: true, stdio: 'ignore' });
  await expect.poll(() => fs.existsSync(path.join(OUT, 'console-windows.json.ready')), {timeout:30000}).toBe(true);
  stage=note('first installed GUI launch'); await launch(baselineVersion);
  await expect(page.locator('#setupNotice')).toBeVisible(); await shot('01-first-account-empty');
  stage=note('first administrator through UI');
  await page.locator('[name="login"]').fill('acceptance-local-admin');
  await page.locator('[name="password"]').fill(password); await page.locator('[name="confirm"]').fill(password);
  await page.locator('#loginSubmit').click(); await ready(); authenticated = true;
  pass('first administrator created through real login UI');
  await expect(page.frameLocator('iframe[src*="/chatbot/"]').locator('.composer-column textarea')).toBeEditable();
  await shot('02-workbench');
  stage=note('optional native CLI onboarding skip');
  let skippedCliDialog=false;
  try {
    await ps(path.join(__dirname, 'native-dialog.ps1'), ['-AppPid', String(mainPid), '-MainWindowHandle',mainHandle,'-Evidence', path.join(OUT, '03-native-optional-cli.png')]);
    await expect.poll(()=>JSON.parse(fs.readFileSync(path.join(DATA,'desktop-config.json'),'utf8')).cliOnboardingDone,{timeout:15000}).toBe(true);
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isEnabled())).toBe(true);
    skippedCliDialog=true;
  } catch(error) {
    const cfg=JSON.parse(fs.readFileSync(path.join(DATA,'desktop-config.json'),'utf8'));
    const mainProbe=await app.evaluate(async ({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0];
      const auth=await win.webContents.executeJavaScript("fetch('/api/auth/current',{credentials:'same-origin'}).then(r=>r.json()).then(d=>({hasUser:!!d.user,guest:d.user?.isGuest,hasIdentity:!!(d.user?.loginName||d.user?.id)})).catch(()=>({failed:true}))",true);
      return {enabled:win.isEnabled(),auth};
    }).catch(e=>({error:e.message}));
    result.onboardingDiagnostic={cliOnboardingDone:!!cfg.cliOnboardingDone,firstRunDone:!!cfg.firstRunDone,...mainProbe};
    result.checks.push({name:'optional CLI onboarding offered and skipped',status:'fail',diagnostic:result.onboardingDiagnostic});
    // Continue other real GUI flows only when no native modal is disabling input.
    if(!mainProbe.enabled) throw error;
  }
  if(skippedCliDialog) pass('optional CLI native Later/cancel action persisted and re-enabled main window');
  stage=note('project UI creation');
  await page.goto(origin + '/#/projects'); await page.locator('#newProject').click();
  const wizard = page.locator('#projectWizard');
  await wizard.locator('[name="name"]').fill('Native Windows Acceptance');
  const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/projects');
  await wizard.locator('[data-pw-action="next"]').click();
  const projectResponse = await created; assert.equal(projectResponse.ok(), true);
  projectId = (await projectResponse.json()).id;
  for (let i = 0; i < 4; i++) {
    if (await wizard.locator('[data-pw-step="done"]').count()) break;
    await wizard.locator('[data-pw-action="skip"]').click();
  }
  await expect(wizard.locator('[data-pw-step="done"]')).toBeVisible();
  await shot('04-project-created'); await wizard.locator('[data-pw-action="close"]').last().click();
  assert.equal((await api('/api/projects/' + projectId)).name, 'Native Windows Acceptance');
  pass('minimal real project created via UI without remote repository');
  stage=note('real welcome workflow');
  await page.goto(origin + '/#/sops'); await page.locator('#projectSwitcher').selectOption('welcome', { force: true });
  // Open the existing welcome SOP in the designer, then the visible Run control.
  await page.goto(origin + '/#/flow/welcome-workflow');
  await page.locator('#runButton').click();
  await page.locator('#runWorkflowChoice').selectOption('welcome-workflow');
  await page.locator('#runInput').fill('Native Windows acceptance: produce artifacts, approve and continue.');
  const started = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs');
  await page.locator('#confirmRun').click();
  const startedResponse = await started; assert.ok(startedResponse.ok()); runId = (await startedResponse.json()).id;
  await expect.poll(async () => (await api('/api/runs/' + runId)).status, { timeout: 90000 }).toBe('waiting');
  let run = await api('/api/runs/' + runId); assert.equal(run.nodes.prepare.status, 'succeeded');
  const artifact = run.artifacts.find(a => a.name === 'welcome'); assert.ok(artifact);
  const artifactText = await page.evaluate(async url => (await fetch(url)).text(), `/api/runs/${runId}/artifacts/${encodeURIComponent(artifact.id)}`);
  assert.match(artifactText, /LoopForge/); fs.writeFileSync(path.join(OUT, 'welcome-artifact.txt'), artifactText);
  await page.goto(origin + '/#/runs/' + runId); await page.locator('[data-run-node="approve"]').click();
  const approval = page.locator('#runDetail .approval-callout.human'); await expect(approval).toBeVisible();
  await shot('05-real-workflow-approval');
  await approval.locator('[data-human-context]').fill('Verified native artifact');
  await approval.locator('[data-approve="approve"]').click();
  await expect.poll(async () => (await api('/api/runs/' + runId)).status, { timeout: 90000 }).toBe('succeeded');
  run = await api('/api/runs/' + runId); assert.equal(run.nodes.finish.status, 'succeeded');
  assert.ok(run.artifacts.some(a => a.name === 'completed')); await shot('06-workflow-succeeded');
  const workspace = path.join(DATA, 'workspaces');
  assert.ok(fs.readdirSync(workspace).length > 0, 'Real workflow workspace persisted');
  workspaceFiles = filesBelow(workspace).map(file => ({ relative: path.relative(workspace,file), sha256: sha(file) }));
  assert.ok(workspaceFiles.length > 0);
  pass('real Bash welcome workflow, artifact, human approval, completion and workspace', {workspaceFileCount:workspaceFiles.length});
  stage=note('graceful quit before upgrade'); await quit(); authenticated = false;
  // Keep synthetic backup runner-local only; never upload DB, cookies or config.
  fs.cpSync(DATA, path.join(TEMP, 'synthetic-backup'), { recursive: true }); pass('synthetic data backup before installer upgrade');
  stage=note('install current over prior release'); await install(currentInstaller);
  pass(baselineVersion==='0.4.0' ? (result.legacyBaselineMode==='published-installer-payload' ? 'candidate NSIS installation over legacy payload directory (not registered legacy upgrade)' : 'NSIS in-place upgrade from 0.4.0') : 'NSIS same-version repair install');
  stage=note('upgraded GUI persistence'); await launch(version); await loginIfNeeded();
  assert.equal((await api('/api/projects/' + projectId)).name, 'Native Windows Acceptance');
  assert.equal((await api('/api/runs/' + runId)).status, 'succeeded');
  await page.goto(origin + '/#/runs/' + runId); await shot('07-upgraded-persistence');
  for (const file of workspaceFiles) assert.equal(sha(path.join(DATA,'workspaces',file.relative)), file.sha256);
  pass(baselineVersion==='0.4.0' ? 'account, project, completed run and workspace survive real 0.4.0 data migration' : 'account, project, completed run and workspace survive repair install');
  if(baselineVersion==='0.4.0') result.dataMigration={from:baselineVersion,to:version,baseline:result.legacyBaselineMode || 'nsis-installation',status:'pass'};
  stage=note('no-provider chat guard');
  await page.goto(origin + '/#/collaboration');
  const chat = page.frameLocator('iframe[src*="/chatbot/"]');
  const composer = chat.locator('.composer-column textarea');
  await expect(composer).toBeEditable(); await page.waitForLoadState('networkidle');
  let generations = 0;
  const countGenerations = r => { if(r.method()==='POST' && new URL(r.url()).pathname==='/api/assistant/generations') generations++; };
  page.on('request',countGenerations);
  await composer.fill('Acceptance without provider credentials must not start a model.');
  await chat.locator('.send-button').click();
  await expect(chat.getByRole('button',{name:'去配置 CodeBuddy API Key'})).toBeVisible();
  await expect(composer).toHaveValue('Acceptance without provider credentials must not start a model.');
  assert.equal(generations,0); page.off('request',countGenerations);
  await shot('07b-no-provider-guard'); await composer.fill('');
  pass('missing-provider UI guard retains draft and does not submit generation');
  stage=note('required runtime UI checks');
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.find(i=>i.label==='文件').submenu.items.find(i=>i.label==='环境检查…').click());
  await page.waitForURL(/envcheck\.html/);
  await expect.poll(() => page.locator('body').innerText(), { timeout: 90000 }).toContain('Git');
  await shot('08-environment-check');
  // Validate actual production check module against installed bundled paths.
  const checks = await app.evaluate(async ({ app }, serverUrl) => {
    const path = process.getBuiltinModule('path');
    const require = process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
    const { runChecks } = require(path.join(app.getAppPath(), 'src/envcheck.js'));
    const res = process.resourcesPath, runtime = path.join(res, 'runtime');
    const env = { ...process.env };
    env.PATH = [path.join(runtime,'git/cmd'),path.join(runtime,'git/usr/bin'),path.join(runtime,'node'),path.join(runtime,'python'),path.join(process.env.SystemRoot,'System32')].join(';');
    const execFileSync=require('child_process').execFileSync;
    const pip=execFileSync(path.join(runtime,'python/python.exe'),['-m','pip','--version'],{env,windowsHide:true,encoding:'utf8',timeout:30000});
    if(!/pip 24\.3\.1/.test(pip)) throw Error('Installed offline pip unavailable');
    const bash=execFileSync(path.join(runtime,'git/usr/bin/bash.exe'),['-c','a=(one two); [[ ${a[1]} == two ]] && printf "bash-arrays-ok %s" "$BASH_VERSION"'],{env,windowsHide:true,encoding:'utf8',timeout:30000});
    if(!bash.includes('bash-arrays-ok')) throw Error('Installed Bash arrays unavailable');
    const report=await runChecks({env, dataDir:app.getPath('userData'), gitDir:path.join(runtime,'git'), nodeDir:path.join(runtime,'node'), pythonDir:path.join(runtime,'python'), serverUrl, requiredOnly:true });
    report.additionalVersions={pip:pip.match(/^pip\s+\S+/)?.[0],bash:bash.trim().replace('bash-arrays-ok ','')};
    return report;
  }, origin);
  assert.equal(checks.summary.requiredOk, true);
  result.requiredTools = checks.results.map(({id,status,level,version}) => ({id,status,level,version}));
  result.additionalRuntimeVersions=checks.additionalVersions;
  pass('installed bundled Git Bash arrays Node npm Python offline pip and service checks');
  stage=note('return to workbench');
  await app.evaluate(({ Menu }) => { const file=Menu.getApplicationMenu().items.find(i=>i.label==='文件'); file.submenu.items.find(i=>i.label==='重启服务').click(); });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 150000 }); origin = new URL(page.url()).origin; await loginIfNeeded();
  pass('environment-check navigation and menu service restart');
  stage=note('sidecar fault recovery');
  const config = JSON.parse(fs.readFileSync(path.join(DATA, 'desktop-config.json')));
  assert.equal(config.secretStorage, 'dpapi'); assert.ok(config.sessionSecretEnc); assert.ok(!config.sessionSecret);
  pass('session secret stored encrypted with DPAPI');
  const processList = JSON.parse((await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='agentflow.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"], {windowsHide:true})).stdout);
  const sidecars = (Array.isArray(processList) ? processList : [processList]).filter(p => p && p.ExecutablePath && p.ExecutablePath.toLowerCase().startsWith(INSTALL.toLowerCase()));
  assert.equal(sidecars.length, 1);
  await exec('taskkill.exe', ['/PID', String(sidecars[0].ProcessId), '/F'], {windowsHide:true});
  await expect.poll(() => fs.readFileSync(path.join(DATA, 'logs/server.log'), 'utf8').includes('supervisor restart'), { timeout: 30000 }).toBe(true);
  await expect.poll(async () => { try { const r=await fetch(origin+'/api/health'); return r.ok; } catch (_) { return false; } }, { timeout: 120000 }).toBe(true);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, {timeout:150000}); origin=new URL(page.url()).origin; await loginIfNeeded();
  assert.equal((await api('/api/projects/' + projectId)).name, 'Native Windows Acceptance');
  await shot('09-recovered'); pass('real sidecar process fault automatically recovered with project intact');
  stage=note('current graceful quit and relaunch'); await quit(); authenticated = false;
  await launch(version); await loginIfNeeded(); assert.equal((await api('/api/runs/'+runId)).status, 'succeeded');
  await shot('10-relaunched'); pass('current version quit/relaunch persistence'); await quit(); authenticated = false;
  stage=note('Docker console and shortcut gates');
  assert.ok(!fs.existsSync(path.join(TEMP,'unexpected-docker-call'))); pass('no Docker invocation throughout GUI acceptance');
  fs.writeFileSync(path.join(TEMP,'stop-monitor'), 'stop'); await once(monitor,'exit'); monitor=null;
  const consoles=JSON.parse(fs.readFileSync(path.join(OUT,'console-windows.json'),'utf8').replace(/^\uFEFF/,'')); assert.deepEqual(consoles,[]); pass('no new visible console windows observed at 20ms sampling');
  const shortcutEvidence = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `$s=New-Object -ComObject WScript.Shell; $paths=@(\"$env:USERPROFILE\\Desktop\\LoopForge.lnk\",\"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\LoopForge.lnk\"); @($paths | ForEach-Object { if(Test-Path $_){$l=$s.CreateShortcut($_); [PSCustomObject]@{name=[IO.Path]::GetFileName($_);target=$l.TargetPath;icon=$l.IconLocation}} }) | ConvertTo-Json`], {windowsHide:true});
  fs.writeFileSync(path.join(OUT,'shortcuts.json'),shortcutEvidence.stdout);
  const shortcutData=JSON.parse(shortcutEvidence.stdout); const shortcuts=Array.isArray(shortcutData)?shortcutData:[shortcutData];
  assert.equal(shortcuts.length,2);
  for(const shortcut of shortcuts) assert.equal(shortcut.target.toLowerCase(),executablePath.toLowerCase());
  const icon=await appIconFromInstalledExe();
  fs.writeFileSync(path.join(OUT,'installed-executable-icon.png'),icon);
  for(const file of [executablePath,path.join(INSTALL,'resources/bin/agentflow.exe')]) {
    const pe=fs.readFileSync(file),offset=pe.readUInt32LE(0x3c);
    assert.equal(pe.readUInt16LE(offset+24+68),2,'PE must use Windows GUI subsystem');
  }
  pass('desktop and Start Menu shortcut targets, extracted executable icon, GUI PE subsystem');
  result.status=result.checks.some(c=>c.status==='fail')?'partial':'pass';
  if(result.status==='partial') process.exitCode=1;
}
main().catch(async (error) => {
  result.status='fail'; result.failedStage=stage;
  // Keep error output free of call logs and values typed into password controls.
  result.error = String(error.message).replaceAll(password, '[REDACTED]').split('Call log:')[0].slice(0, 1500);
  console.error('FAIL acceptance stage:', stage, result.error);
  if (page && authenticated && !page.isClosed()) await shot('failure').catch(()=>{});
  process.exitCode=1;
}).finally(async () => {
  if(app) await app.close().catch(()=>{});
  if(monitor){fs.writeFileSync(path.join(TEMP,'stop-monitor'),'stop'); await Promise.race([once(monitor,'exit'),new Promise(r=>setTimeout(r,5000))]);}
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(result,null,2));
});

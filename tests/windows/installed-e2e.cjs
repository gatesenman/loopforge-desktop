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
const DATA = path.join(process.env.APPDATA, 'LoopForge');
const version = require('../../package.json').version;
const currentInstaller = path.join(ROOT, 'dist', `LoopForge-Setup-${version}.exe`);
const oldInstaller = path.join(TEMP, 'LoopForge-Setup-0.4.0.exe');
const executablePath = path.join(INSTALL, 'LoopForge.exe');
const result = { version, nativeWindows: true, installedBinary: true, mockedProviders: false, checks: [], limitations: [
  'NSIS silent installation tested; interactive installer GUI and SmartScreen not tested.',
  'External coding-agent CLI installation/login and paid AI execution not tested; no provider credentials used.',
  '0.4.0 to current in-place installer upgrade tested; 0.3.10 and live auto-update download/restart not tested.',
  'Console windows sampled every 20ms; sub-sampling-duration flashes cannot be excluded.',
] };
let app, page, origin, monitor, stage = 'initialization', runId, projectId;
let authenticated = false;
const password = 'Acceptance-' + crypto.randomBytes(20).toString('hex') + '!';
function pass(name, details = {}) { result.checks.push({ name, status: 'pass', ...details }); console.log('PASS', name); }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function ps(file, args = []) { return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { windowsHide: true, timeout: 90000 }); }
async function shot(name) { await page.screenshot({ path: path.join(OUT, name + '.png') }); }
async function install(file) {
  await exec(file, ['/S', `/D=${INSTALL}`], { windowsHide: true, windowsVerbatimArguments: true, timeout: 180000 });
  assert.ok(fs.existsSync(executablePath), 'Installed executable missing');
  assert.ok(fs.existsSync(path.join(INSTALL, 'resources/app.asar')), 'Installed app.asar missing');
}
function safeEnv() {
  const env = {};
  for (const key of ['SystemRoot','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH','PATHEXT','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  // No CI-installed coding agents or provider keys may leak into acceptance.
  env.PATH = [path.join(TEMP, 'trap'), path.join(env.SystemRoot, 'System32'), env.SystemRoot].join(';');
  env.LOOPFORGE_PROBE_MARKER = path.join(TEMP, 'unexpected-docker-call');
  return env;
}
async function launch(expectedVersion) {
  app = await electron.launch({ executablePath, env: safeEnv(), timeout: 90000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(45000);
  const metadata = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), data: app.getPath('userData') }));
  assert.equal(metadata.packaged, true); assert.equal(metadata.version, expectedVersion);
  assert.equal(path.resolve(metadata.data).toLowerCase(), DATA.toLowerCase());
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 150000 });
  origin = new URL(page.url()).origin;
  assert.ok(!page.url().includes('envcheck'), 'Required checks must not open blocking wizard');
  pass('installed GUI launch ' + expectedVersion, { packaged: metadata.packaged });
}
async function api(url) {
  return page.evaluate(async (url) => { const r = await fetch(url); if (!r.ok) throw Error('GET failed: ' + r.status); return r.json(); }, url);
}
async function ready() { await expect(page.locator('#projectSwitcher option').first()).toBeAttached({ timeout: 60000 }); }
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
  assert.match(log, /server exited code=0/);
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
async function main() {
  assert.equal(process.platform, 'win32', 'Native Windows only; Wine is not acceptance');
  assert.ok(!fs.existsSync(DATA), 'Refuse to touch pre-existing application data');
  assert.ok(!fs.existsSync(TEMP), 'Refuse to overwrite existing acceptance directory');
  fs.mkdirSync(TEMP, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(TEMP, 'trap'));
  fs.copyFileSync(path.join(ROOT, '.smoke/LoopForge Runtime With Spaces/probe trap/docker.exe'), path.join(TEMP, 'trap/docker.exe'));
  stage = 'download pinned previous installer';
  const response = await fetch('https://github.com/gatesenman/loopforge-desktop/releases/download/v0.4.0/LoopForge-Setup-0.4.0.exe');
  assert.equal(response.status, 200); fs.writeFileSync(oldInstaller, Buffer.from(await response.arrayBuffer()));
  assert.equal(sha(oldInstaller), 'cf6cc71b2141aa59d0aaaef5b888d9c717ebfae021aefa6bda6ead0f85aa54fd');
  result.installer = { file: path.basename(currentInstaller), sha256: sha(currentInstaller), bytes: fs.statSync(currentInstaller).size };
  stage = 'silent install previous release'; await install(oldInstaller); pass('NSIS 0.4.0 per-user silent install in path with spaces');
  monitor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'console-monitor.ps1'), '-StopFile', path.join(TEMP, 'stop-monitor'), '-OutputFile', path.join(OUT, 'console-windows.json')], { windowsHide: true, stdio: 'ignore' });
  await expect.poll(() => fs.existsSync(path.join(OUT, 'console-windows.json.ready')), {timeout:30000}).toBe(true);
  stage = 'first installed GUI launch'; await launch('0.4.0');
  await expect(page.locator('#setupNotice')).toBeVisible(); await shot('01-first-account-empty');
  stage = 'first administrator through UI';
  await page.locator('[name="login"]').fill('acceptance-local-admin');
  await page.locator('[name="password"]').fill(password); await page.locator('[name="confirm"]').fill(password);
  await page.locator('#loginSubmit').click(); await ready(); authenticated = true;
  pass('first administrator created through real login UI'); await shot('02-workbench');
  stage = 'optional native CLI onboarding skip';
  await ps(path.join(__dirname, 'native-dialog.ps1'), ['-AppPid', String(app.process().pid), '-Evidence', path.join(OUT, '03-native-optional-cli.png')]);
  pass('optional CLI onboarding skipped with real Windows UI Automation');
  stage = 'project UI creation';
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
  stage = 'real welcome workflow';
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
  pass('real Bash welcome workflow, artifact, human approval, completion and workspace');
  stage = 'graceful quit before upgrade'; await quit(); authenticated = false;
  // Keep synthetic backup runner-local only; never upload DB, cookies or config.
  fs.cpSync(DATA, path.join(TEMP, 'synthetic-backup'), { recursive: true }); pass('synthetic data backup before installer upgrade');
  stage = 'install current over prior release'; await install(currentInstaller);
  pass('NSIS in-place upgrade from 0.4.0');
  stage = 'upgraded GUI persistence'; await launch(version); await loginIfNeeded();
  assert.equal((await api('/api/projects/' + projectId)).name, 'Native Windows Acceptance');
  assert.equal((await api('/api/runs/' + runId)).status, 'succeeded');
  await page.goto(origin + '/#/runs/' + runId); await shot('07-upgraded-persistence');
  pass('account, project, completed run and workspace survive installer upgrade');
  stage = 'required runtime UI checks';
  await page.keyboard.press('Control+Shift+E'); await page.waitForURL(/envcheck\.html/);
  await expect.poll(() => page.locator('body').innerText(), { timeout: 90000 }).toContain('Git');
  await shot('08-environment-check');
  // Validate actual production check module against installed bundled paths.
  const checks = await app.evaluate(async ({ app }, serverUrl) => {
    const path = require('path');
    const { runChecks } = require(path.join(app.getAppPath(), 'src/envcheck.js'));
    const res = process.resourcesPath, runtime = path.join(res, 'runtime');
    const env = { ...process.env };
    env.PATH = [path.join(runtime,'git/cmd'),path.join(runtime,'git/usr/bin'),path.join(runtime,'node'),path.join(runtime,'python'),path.join(process.env.SystemRoot,'System32')].join(';');
    return runChecks({env, dataDir:app.getPath('userData'), gitDir:path.join(runtime,'git'), nodeDir:path.join(runtime,'node'), pythonDir:path.join(runtime,'python'), serverUrl, requiredOnly:true });
  }, origin);
  assert.equal(checks.summary.requiredOk, true);
  result.requiredTools = checks.results.map(({id,status,level}) => ({id,status,level}));
  pass('installed bundled Git Bash Node npm Python pip and service required checks');
  stage = 'return to workbench';
  await app.evaluate(({ Menu }) => { const file=Menu.getApplicationMenu().items.find(i=>i.label==='文件'); file.submenu.items.find(i=>i.label==='重启服务').click(); });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 150000 }); origin = new URL(page.url()).origin; await loginIfNeeded();
  pass('environment-check navigation and menu service restart');
  stage = 'sidecar fault recovery';
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
  stage = 'current graceful quit and relaunch'; await quit(); authenticated = false;
  await launch(version); await loginIfNeeded(); assert.equal((await api('/api/runs/'+runId)).status, 'succeeded');
  await shot('10-relaunched'); pass('current version quit/relaunch persistence'); await quit(); authenticated = false;
  assert.ok(!fs.existsSync(path.join(TEMP,'unexpected-docker-call'))); pass('no Docker invocation throughout GUI acceptance');
  fs.writeFileSync(path.join(TEMP,'stop-monitor'), 'stop'); await once(monitor,'exit'); monitor=null;
  const consoles=JSON.parse(fs.readFileSync(path.join(OUT,'console-windows.json'),'utf8').replace(/^\uFEFF/,'')); assert.deepEqual(consoles,[]); pass('no new visible console windows observed at 20ms sampling');
  const shortcutEvidence = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `$s=New-Object -ComObject WScript.Shell; $paths=@(\"$env:USERPROFILE\\Desktop\\LoopForge.lnk\",\"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\LoopForge.lnk\"); @($paths | ForEach-Object { if(Test-Path $_){$l=$s.CreateShortcut($_); [PSCustomObject]@{name=[IO.Path]::GetFileName($_);target=$l.TargetPath;icon=$l.IconLocation}} }) | ConvertTo-Json`], {windowsHide:true});
  fs.writeFileSync(path.join(OUT,'shortcuts.json'),shortcutEvidence.stdout);
  pass('shortcut metadata captured (visual inspection separate)');
  result.status='pass';
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

# Installed Windows acceptance gate

`tests/windows/installed-e2e.cjs` runs only on a disposable native Windows GitHub
Actions runner. It refuses pre-existing `%APPDATA%\LoopForge` data and never
runs on the owner's PC. No provider or service is mocked.

## What the gate does

1. Use the newly built candidate (fresh-install gate). A separate explicit
   legacy mode downloads 0.4.0 and verifies its pinned SHA256.
2. Silently install into a per-user temporary path containing spaces; launch
   **that installed executable**, not a development Electron or sidecar-only UI.
3. Check packaged version and actual data path. Required checks must pass without
   a blocking environment wizard. Create the first local administrator in the UI
   using a random, runner-local synthetic password.
4. Dismiss the actual optional CLI native dialog using Windows UI Automation,
   with a screenshot. This is not a mocked `dialog.showMessageBox` response.
5. Create a real project through its wizard, skipping remote repository, members,
   and integrations. Run the built-in `welcome-workflow` through its Run controls:
   real Bash script -> artifact -> UI human approval -> real finishing script.
6. Quit through the application menu and verify a zero-exit sidecar. Back up the
   synthetic application data **inside runner temp only**, then reinstall the
   candidate. Verify project, run and workspace file hashes. In explicit legacy
   mode this is instead an actual 0.4.0-to-candidate upgrade.
7. Check missing-provider chat guard, installed required tools, environment-check
   navigation, menu service restart, DPAPI storage, deliberate real sidecar crash
   recovery, and quit/relaunch persistence.
8. Keep Docker absent, with a marker-writing trap to detect invocation. Sample
   visible console-window classes every 20ms. Verify shortcut targets, extract
   the installed executable's icon, and check Windows GUI PE subsystem flags.

The workflow must finish successfully before an installer is considered verified.
`result.json` records only completed assertions, not intended coverage.

## Evidence and privacy

Artifact `Windows-installed-GUI-evidence` contains allowlisted screenshots, a
result summary, deterministic welcome-script output, shortcut metadata and the
console-window sample result. It excludes database, config/session secret,
passwords, cookies, raw application logs, HAR and Playwright traces. The empty
first-account form is captured **before** typing. Failure screenshots are only
captured after authentication. No CI secret/provider environment is passed into
the app; its child environment is allowlisted.

Artifact `LoopForge-Setup` contains the candidate installer, update metadata,
source build manifest and the independent command-line runtime smoke result.
No public release is created by this workflow (`--publish never`).

## Boundaries: do not describe these as tested

- Silent NSIS installation is tested; interactive installer pages and SmartScreen
  are not visually tested. The installer remains unsigned.
- Default gate covers candidate fresh install and same-version repair, not a
  legacy upgrade. Explicit legacy mode attempts 0.4.0 -> candidate with synthetic
  data. Only its completed assertions establish migration coverage. 0.3.10 and
  actual updater feed/download/restart remain separate acceptance work.
- No external coding-agent CLI is installed or authenticated. AI chat needs one
  supported CLI (for example CodeBuddy or Codex) and its own account/API key.
  No paid model execution is attempted, and welcome-script success is not an AI
  task success claim.
- 20ms console sampling cannot prove absence of shorter-lived windows.
- Icon extraction/shortcut metadata are evidence for manual visual inspection,
  not a guarantee of the owner's existing Windows icon cache.

## Local execution (disposable Windows machine only)

After the pinned clean build and `npm run smoke:windows`:

```powershell
node tests/windows/installed-e2e.cjs
```

It intentionally refuses non-Windows and pre-existing app data. Do not remove
that guard to run it against a real user's profile.

## Defects discovered by genuine installed-product testing

- **Required checks failed open on exceptions**: fixed in `src/startup-check.js`,
  with unavailable/false/throwing checks covered by a regression.
- **Bundled npm was omitted from installed resources**: electron-builder filters
  a resource mapping's root `node_modules` directory. Raw vendor smoke tests did
  not catch this. An explicit mapping of `vendor-dl/node/node_modules` preserves
  npm and its nested dependencies; the regression uses the real packager copier.
- **Published 0.4.0 NSIS access violation**: native diagnosis reproduced
  `System.dll`, exception `0xc0000005`, on Windows Server 2025 (26100). Windows
  Server 2022 (20348) did not reproduce the access violation in the probe. The
  candidate upgrades electron-builder to 26.18.0, whose template includes the
  bounded known-folder copy fixing this upstream defect:
  <https://github.com/electron-userland/electron-builder/pull/9769>.
  The immutable old package may need a retry solely to construct legacy test
  fixtures. Its missing-npm check may also need explicit UI Continue; candidate
  required checks are never waived. These legacy limitations are recorded.
- **Security maintenance**: wrapper uses Electron 45.4.1, electron-builder
  26.18.0 and electron-updater 6.8.11. Audit at implementation time: zero runtime
  dependency findings, zero high/critical wrapper findings; six moderate
  build-tool-chain findings remain. This is not a vulnerability-free claim for
  every bundled runtime or the upstream application.

`Retest built Windows GUI artifact` can run test-only changes against a specific
native packaging run without rebuilding or modifying its installer. Its result
records both build-run provenance and test commit. The final clean-build workflow
must still pass before publication.

## Published legacy payload data migration (separate from installer upgrade)

The optional legacy gate keeps the published 0.4.0 NSIS failure as a FAIL. To
continue a narrower data-format test, it can extract the actual checksum-pinned
published installer payload with 7-Zip, launch that real 0.4.0 application and
create all synthetic accounts/projects/runs through its GUI. The new candidate
NSIS then installs into that directory and must reopen the old data and workspace.
This is not a mocked profile, but it is also **not** a registered legacy-install
upgrade test: the legacy NSIS installation/registry phase was not successful.
The run remains partial/non-green when the immutable old installer failed, even
if real data migration and all candidate assertions succeed. Fresh/repair remains
a separate clean-build blocking gate.

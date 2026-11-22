# Installed Windows acceptance gate

`tests/windows/installed-e2e.cjs` runs only on a disposable native Windows GitHub
Actions runner. It refuses pre-existing `%APPDATA%\LoopForge` data and never
runs on the owner's PC. No provider or service is mocked.

## What the gate does

1. Download the released 0.4.0 NSIS installer and verify its pinned SHA256.
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
   synthetic application data **inside runner temp only**, then install the newly
   built candidate over 0.4.0. Verify project, run and workspace file hashes.
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
- Upgrade coverage is 0.4.0 -> candidate with synthetic data. 0.3.10 migrations and
  actual updater feed/download/restart are separate acceptance work.
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

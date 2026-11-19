# LoopForge Desktop (Windows x64)

[English](README.md) · [简体中文](README.zh-CN.md)

A one-installer Windows desktop build of [Tencent/LoopForge](https://github.com/Tencent/LoopForge) (MIT). Install it, open it, and start working — **no Docker, no MySQL, no separate runtime setup**.

This is a community desktop package, not an official Tencent release.

[Download LoopForge-Setup-0.4.0.exe](https://github.com/gatesenman/loopforge-desktop/releases/latest)

<p align="center">
  <img src="docs/screenshots/startup.png" alt="LoopForge Desktop starting up" width="720">
</p>

## What you get

| | Desktop build 0.4.0 |
| --- | --- |
| Runtime | Local process + SQLite under `%APPDATA%\LoopForge` |
| Bundled tools | Git for Windows **MinGit-busybox** (git + sh/bash applets), Node.js 22 (with npm), Python 3.11 |
| Docker | Not used and not required. The app never starts or probes Docker, so it will not flash black console windows. |
| Startup | Required bundled tools are checked silently. If they pass, the app goes straight to the workbench (no blocking wizard). |
| Updates | In-app check against GitHub Releases (notify, download, then a restart prompt). |
| Coding-agent CLIs | Optional. Install from **File → Environment check** with the bundled npm, then sign in. Install runs inside the app (no `cmd` window). |

<p align="center">
  <img src="docs/screenshots/envcheck.png" alt="Built-in environment check" width="720">
</p>

The environment-check page is shown automatically only when a required check fails, or when you open it from the menu (`Ctrl+Shift+E`). After you sign in, the app may once offer optional CLI onboarding; you can skip it.

<p align="center">
  <img src="docs/screenshots/workbench.png" alt="LoopForge workbench inside the desktop app" width="720">
</p>

The workbench above is the in-app LoopForge UI (upstream interface) after you create the first admin account.

## Install and first run

1. Download `LoopForge-Setup-0.4.0.exe` from [Releases](https://github.com/gatesenman/loopforge-desktop/releases) and run it (per-user install, Start Menu and desktop shortcuts).
2. The installer is **not code-signed**. Windows SmartScreen may warn you — choose **Run anyway**. The same prompt can appear again after an in-app update.
3. On first start the app boots the local server (about 10–30 seconds while it initializes the database) and, when the bundled tools are healthy, opens the login / workbench directly.
4. Create the first administrator account on the login page.
5. Try the built-in sample SOP `welcome-workflow` in the LoopForge experience project — it does not need a model key.
6. To use AI chat or delivery SOPs, install at least one coding-agent CLI from the environment check (CodeBuddy or Codex recommended), sign in or paste a key in settings, then click **Recheck**.

Data stays in `%APPDATA%\LoopForge` and is kept on uninstall by default. Use **File → Export diagnostics** (logs, versions, env-check results; no secrets) or **File → Back up data directory** if you need a zip. The session secret is stored with Windows DPAPI when available.

The sidecar process is supervised: if it crashes, the app retries a few times with backoff, then shows the error page. Quitting stops the service gracefully (force-kill is the last resort).

## Environment check

| Item | Source | If missing |
| --- | --- | --- |
| LoopForge server, data directory | The app itself | Check the service log; retry start |
| Git, bash/sh, Node.js, npm, Python 3 | **Bundled in the installer** | Reinstall the app. You are not asked to install these with winget. |
| CodeBuddy, Codex, Claude Code, OpenCode, Gemini CLI, dsh | Optional, one-click via bundled npm | Does not block startup |
| Cursor CLI | Optional, official script (account required) | Does not block startup |

The app does not detect, recommend, or install Docker / Docker Desktop / WSL.

## Runtime differences

The only mode is **local execution**. Features that officially need a Docker sandbox are unavailable or reduced: container isolation, image-based reproducible environments, Linux toolchains preinstalled in a sandbox, and anything that must talk to a Docker daemon. Use this build only with trusted repositories and tasks.

The bundled shell is BusyBox (from official MinGit-busybox), not a full Git Bash / MSYS2 userland. Typical POSIX SOP scripts work; scripts that need Perl, Git GUI, or uncommon GNU extensions may not.

## Build from source

This repository holds the Electron / NSIS wrapper. Large runtimes (`vendor-dl/`, `resources/bin/`) are not stored in Git; they are packed into the installer. See [docs/PACKAGING.md](docs/PACKAGING.md) for the vendor lockfile, MinGit decision, CI, and auto-update artifact list.

```bash
node scripts/fetch-vendors.js
node scripts/build-loopforge-bins.js   # or set LOOPFORGE_SRC to a patched LoopForge checkout
npm ci
npm run dist
```

The output is `dist/LoopForge-Setup-<version>.exe` plus `latest.yml` (for GitHub Releases auto-update).

## Changelog

### 0.4.0

- Slim runtimes: official Git for Windows MinGit-busybox instead of full PortableGit; Windows-only sidecar bins (no Linux runner/gate-mcp, no `loopforge-account.exe`). The NSIS installer is about **166 MB** (174,038,056 bytes; down from about 246 MB in 0.3.10).
- Silent startup when bundled Git / Node / Python and the local service are healthy. Optional Agent CLIs no longer block first launch; post-login onboarding can be skipped.
- Sidecar supervisor: HTTP health checks, limited crash restarts with backoff, graceful stop on quit.
- In-app CLI installs (hidden process, no visible `cmd` window).
- Auto-update from GitHub Releases (`electron-updater`, notify + download + restart prompt). Default builds are unsigned.
- Session secret protected with Windows DPAPI when available. Diagnostic zip and data-directory backup from the File menu.
- Reproducible vendor lockfile and Windows CI workflow.

## License

Upstream LoopForge is MIT. The installer also includes Git for Windows, Node.js, CPython, and Electron/Chromium under their own licenses — see `licenses/` and **Help → Open-source licenses**. This packaging does not change the upstream license.

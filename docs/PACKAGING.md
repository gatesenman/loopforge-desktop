# Packaging LoopForge Desktop

English notes for maintainers. End-user docs live in the root README files.

## Layout

- Electron 33 shell in `src/`. The Go sidecar (`agentflow.exe`) and helper bins are copied from a pinned LoopForge commit plus `patches/0001-desktop-no-docker-hide-console.patch`.
- Runtimes (Git / Node / Python) are **not** stored in Git. They are fetched from `scripts/vendor-lock.json` into `vendor-dl/` (gitignored) and packed as `extraResources`.
- The Windows NSIS installer is a single x64 `.exe`. Docker is not bundled, probed, or documented as a requirement.

## Reproducible vendor fetch

```bash
node scripts/fetch-vendors.js          # download + sha256-verify into vendor-dl/
node scripts/fetch-vendors.js --force  # re-extract even if dest already exists
```

Pinned today:

| Runtime | Bundle | Version |
| --- | --- | --- |
| Git | Official **MinGit-busybox** 64-bit zip (not full PortableGit) | 2.56.1.windows.1 |
| Node.js | Official Windows x64 zip | 22.23.5 |
| Python | Official embeddable amd64 zip (`import site` enabled) | 3.11.9 |

**Why MinGit-busybox, not plain MinGit?** LoopForge SOP script nodes run as `sh -lc`, git SSH helpers call `sh -c`, and some on-demand CLI installers run `bash -c`. Plain MinGit only has `git.exe`. MinGit-busybox is the smallest official Git for Windows bundle that still provides a POSIX shell (~84 MB unpacked vs ~323 MB for PortableGit). After extract, `fetch-vendors.js` adds:

- `ucrt64/bin/sh.exe` — copy of the official `git-wrapper.exe` / `ash.exe` (argv0 selects busybox `sh`)
- `ucrt64/bin/bash.exe` — copy of `busybox.exe` (argv0 selects the bash applet). Do **not** copy the wrapper as `bash.exe` (it re-execs itself).

BusyBox is not full GNU bash/coreutils. Unusual SOP scripts that need perl, git-gui, or bash arrays may fail; that is an accepted trade-off of the slim runtime.

## LoopForge Windows binaries

```bash
# Uses LOOPFORGE_SRC if set, else a local clone, else clones the pinned commit.
node scripts/build-loopforge-bins.js
```

Only these files are packaged:

- `agentflow.exe`
- `agentflow-mcp.exe`
- `agentflow-runner-windows-amd64`
- `agentflow-gate-mcp-windows-amd64`

Linux `*-linux-*` binaries and `loopforge-account.exe` are deleted and also filtered out of `extraResources`. The first admin account is created in the app; the legacy account CLI is not shipped.

Hashes in `vendor-lock.json` describe the pre-built set used for a given desktop release. Fresh `go build` output is not bit-reproducible; CI builds from the pinned commit + patch and skips hash comparison (`--skip-hash-verify`).

## Build the installer

```bash
npm ci
npm run dist
```

Output:

- `dist/LoopForge-Setup-<version>.exe`
- `dist/LoopForge-Setup-<version>.exe.blockmap`
- `dist/latest.yml` — consumed by `electron-updater` on GitHub Releases

The app is **unsigned** unless `CSC_LINK` / `CSC_KEY_PASSWORD` are set. Leave `signAndEditExecutable` at its default so rcedit can stamp `build/icon.ico`. Windows SmartScreen may warn; that is expected for unsigned builds.

## Auto-update

The packaged app uses `electron-updater` 6.3.9 with `publish.provider = github` for `gatesenman/loopforge-desktop`. It checks GitHub Releases for `latest.yml`, downloads `LoopForge-Setup-<version>.exe`, then **prompts** before `quitAndInstall`. It does not restart mid-work. Signature verification is disabled because default builds are unsigned.

A GitHub Release for `vX.Y.Z` must include:

- `LoopForge-Setup-X.Y.Z.exe`
- `LoopForge-Setup-X.Y.Z.exe.blockmap`
- `latest.yml`

## CI

`.github/workflows/windows-installer.yml` runs on `windows-latest`: fetch vendors, build Windows bins, `npm ci`, `npm run dist` (unsigned unless signing secrets exist), and uploads the three artifacts above. No secrets are required.

# Reproducible Windows packaging

Electron 33.4.11 + electron-builder 25.1.8 + Go sidecar. Runtime archives,
source checkout, node_modules, build outputs and executables are gitignored.

## Clean builds

Use Node 22.23.5 and Go **1.27.3**, then:

```sh
npm ci
npm run fetch-vendors
npm run build-bins
npm test
# On real Windows:
npm run smoke:windows
npm run dist
```

`dist` always uses `--publish never`. No release is created by CI.
`LOOPFORGE_SRC` can identify an existing clone solely as a source of git
objects: the build script archives the exact pinned revision, never its dirty
working tree. Otherwise it fetches that revision into its own cache.
A fresh isolated repository receives the complete SHA256-verified desktop
patch (SQLite migrations, no-container path, Windows compile helpers, hidden
console execution, stdin graceful shutdown). Patch failure is fatal.
The chatbot is built using upstream `npm ci` and Vite **before Go embedding**.
All four binaries are always rebuilt, with trimpath, buildvcs=false and no
buildid. `resources/bin/build-manifest.json` records source commit, patch hash,
Go/Node versions, frontend npm lock hash, binary sizes and SHA256 values.
Old prebuilt binary hashes are not treated as reproducible source pins.
Cross-host byte-identical binary hashes are not promised (frontend platform
output can vary); provenance and native runtime smoke tests are the gate.

## Real Bash, not a BusyBox alias

`scripts/vendor-lock.json` pins official regular **MinGit 2.56.1** (64-bit zip,
SHA256 from Git for Windows release notes). Unlike the BusyBox variant it ships
real GNU Bash as `usr/bin/sh.exe`. Copying those bytes to `usr/bin/bash.exe`
selects Bash's normal mode. There is no shell shim or BusyBox masquerading as
Bash. Windows smoke tests check BASH_VERSION, arrays, [[ ]], `bash -c`, and
`sh -lc` with executable paths containing spaces.

Audit at upstream `69e4bf0`: `internal/engine/node_execute.go` uses `sh -lc`;
`internal/runtime/git_ssh.go` uses `sh -c`; `cli_ondemand.go` explicitly uses
`bash -c` and pipes provider installers through Bash; sandbox environment files
also discuss Bash startup files. Consequently POSIX ash cannot be assumed
compatible with arbitrary provider scripts. True Bash is retained even if it
costs some size. MinGit omits Git GUI and Perl. External provider scripts still
have their own account, OS support and network requirements; they are not
validated as installed/authenticated by our smoke test.

## Python and pip: no bootstrap

Python 3.11.9 embedded amd64 and pip 24.3.1's pure-Python wheel have pinned
HTTPS URLs and SHA256. The wheel is unpacked directly into Lib/site-packages,
that directory is added to `python311._pth`, `import site` is enabled, and
python3.exe is an identical copy of python.exe. `python -m pip --version` works
offline. No get-pip.py, pip bootstrap request, or best-effort warning fallback.
Runtime archive cache markers identify the exact lock; fresh extraction fails
on a checksum/download error. Do not manually edit an extracted vendor tree.

## CI and tests

`.github/workflows/windows-installer.yml` builds on windows-latest with pinned
Node/Go and workflow_dispatch. It fetches clean vendors, builds pristine source,
runs security/ZIP unit tests, then native Windows runtime smoke tests, and only
then builds NSIS. Artifacts include installer, .blockmap, latest.yml,
build-manifest.json, and smoke result.json. This is **not GUI E2E testing**.
The smoke tests isolate PATH from preinstalled Git/Node/Python, use directories
with spaces, verify binary hashes, test required env checks and SQLite service
health, and put a trap docker.exe first on PATH to fail if it is invoked. It
also tests parent-owned stdin graceful drain/shutdown. No daemon is used.

## Security and updating

Only allowlisted config/check fields and lifecycle **counts** enter diagnostics.
Raw logs, extraEnv, database, workspaces and config ciphertext are never exported.
ZIP CRC32 is implemented locally because Electron 33's Node 20 lacks zlib.crc32.
Data backup is deferred: copying databases/workspaces can copy credentials.

safeStorage uses Windows DPAPI. Failed encryption removes stale ciphertext and
keeps a working plaintext fallback with an explicit warning. Failed decryption
rotates the session secret (invalidates sessions, not project data) with a warning.

GitHub Releases provider: gatesenman/loopforge-desktop. Upload together:
`LoopForge-Setup-X.Y.Z.exe`, `.exe.blockmap`, and `latest.yml`.
Updates download and prompt; “Later” never installs automatically on quit.
Explicit restart drains/stops the sidecar before quitAndInstall.
Builds are unsigned unless CSC_LINK/CSC_KEY_PASSWORD are configured. SmartScreen
may warn. Never disable rcedit/signAndEditExecutable: icons must remain stamped.

## Complete-source delivery (0.4.2+)

`npm run export-source` requires a clean committed checkout. It archives the
desktop commit, obtains the pinned upstream tree from Git objects (never the
dirty checkout), verifies/applies the locked patch, and exports every upstream
file including VS Code static assets. Three upstream POSIX skill symlinks are
portable target-text files; `upstreamSymlinks` retains their original targets.
The resulting ZIP contains desktop/, upstream/, per-file SHA256 source manifest,
and Chinese rebuild instructions. Generated dependencies/binaries are excluded.

To rebuild from the bundle on Windows, use the pinned Node/Go toolchains, enter
desktop/, run `npm ci`, set `LOOPFORGE_SOURCE_BUNDLE` to the parent directory, then
run fetch-vendors, build-bins, test, smoke:windows, dist and verify-package. The
build checks the bundled upstream file set and hashes before copying it to its
own prepared build directory. Internet access is needed for locked dependencies.
This is reproducible provenance, not a promise of identical cross-OS PE bytes.

`npm run verify-package` checks app.asar files against the source checkout,
package version, pinned build provenance, all binary hashes/lengths, GUI PE
subsystems, required offline runtime resources, and latest.yml SHA512/size.
Windows CI performs this before installed GUI acceptance. GUI acceptance also
checks real installed configuration recovery, non-destructive probes, production
navigation handler denial and two simultaneous menu restarts with persisted data.
Windows CI/Server evidence does not replace Windows 10/11 human acceptance,
SmartScreen/interactive installer testing or real provider account testing.

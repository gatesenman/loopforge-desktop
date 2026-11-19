# 0.4.0 release-readiness corrections

Do not use the first 174,038,056-byte candidate or its checksum. It is superseded.

Corrected local Wine-built installer:

- `dist/LoopForge-Setup-0.4.0.exe`
- 189,957,485 bytes (189.96 MB; 181.16 MiB), below 200 MB
- SHA256 `98934f8edfadbea059bf863bb72e5e1557e3b3469086aa490a61da1a35752277`
- Unpacked file bytes: 667,116,138 (~636.21 MiB)
- Verified MZ/PE signature, latest.yml SHA512, and packaged JS source equality
- Node 22.23.5 / Go 1.27.3; source `69e4bf093cf26dc72a2b0bc5d7452f86ce96f660`
- Full patch SHA256 `c3ad93e0dcb0507002b0f3d603c26ea3bb5485c9a70beed467fe8e1ebc21aae8`
- Binary provenance: resources/bin/build-manifest.json (also in installer)

Initial CI run 44494444067 failed because the original script did not build
web/native-chat before Go embedding. The original patch also omitted existing
Windows/SQLite adaptations from the reused sidecar. Both were fixed: clean
pinned source archive + complete checked patch + frontend build + all-bin rebuild.

Native windows-latest run for code commit 1adba11:
https://github.com/gatesenman/loopforge-desktop/actions/runs/44495436731

Observed successful steps at 17:22 Asia/Shanghai (UTC+8), November 19, 2026:
- Clean pinned vendor fetch
- Clean frontend and all four Windows binary builds
- Four security/ZIP/updater unit tests
- Native Windows CLI/runtime integration smoke: real Bash arrays and -c,
  sh -lc + git, node/npm, Python stdlib/pip, required checks, SQLite service
  health with Docker invocation trap, and graceful stdin shutdown. All runtime
  paths contain spaces. This is NOT Windows GUI end-to-end testing.

At last inspection the CI NSIS packaging step was still running; final CI
artifact upload/success must be checked before publication. No release was
published. Local installer is unsigned and built through Wine; prefer the native
CI installer if its final packaging/upload succeeds, and remeasure its checksum.
Authenticode verification is retained for future signed builds; unsigned builds
have no publisherName. SmartScreen may warn.

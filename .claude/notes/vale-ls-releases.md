# vale-ls release pinning and checksums

`src/utils.ts` hardcodes `LSP_TAG` (currently `v0.5.0`) and an
`EXPECTED_CHECKSUMS` map of SHA-256 digests, one per platform/arch release
asset. `downloadLSP` in `src/lsp.ts` refuses to install a binary whose
downloaded bytes don't match the recorded digest for its filename — this is
the fix for the "harden the vale-ls download" finding in `PROJECT_AUDIT.md`
(previously: no status check, no checksum, extracted straight into the
extension's own install directory).

## Why hardcoded checksums instead of an upstream checksums file

`vale-cli/vale-ls` releases do not currently publish a `SHA256SUMS` file, but
GitHub's release API publishes a SHA-256 digest for each asset. The v0.5.0
values were taken from
`gh api repos/vale-cli/vale-ls/releases/tags/v0.5.0` and embedded in source,
so a compromised or corrupted download is rejected before extraction.

## Bumping `LSP_TAG`

Whenever `LSP_TAG` changes, `EXPECTED_CHECKSUMS` must be regenerated or the
extension will refuse to install (fails closed — see
`getExpectedChecksum`/`downloadLSP`). To regenerate:

```sh
TAG=vX.Y.Z
for f in vale-ls-aarch64-apple-darwin.zip \
         vale-ls-aarch64-pc-windows-msvc.zip \
         vale-ls-aarch64-unknown-linux-gnu.zip \
         vale-ls-x86_64-apple-darwin.zip \
         vale-ls-x86_64-pc-windows-gnu.zip \
         vale-ls-x86_64-unknown-linux-gnu.zip; do
  curl -sL -o "$f" "https://github.com/vale-cli/vale-ls/releases/download/$TAG/$f"
done
shasum -a 256 *.zip
```

Update `LSP_TAG` and every entry in `EXPECTED_CHECKSUMS` in `src/utils.ts`
together, in the same commit. `src/utils.test.ts`'s
`buildDownloadAssetName` suite asserts every producible platform/arch
combination has a matching checksum entry — it will fail if one is missed.
The installer also writes `.vale-ls-version` beside the binary and replaces
the binary whenever that marker differs from `LSP_TAG`.

## Install location

The binary is installed into `context.globalStorageUri.fsPath` (via
`getInstallDir` in `src/lsp.ts`), not the extension's own install directory
(`context.extensionPath`). The extension install directory can be read-only
post-install on some platforms/configurations, and mixing downloaded
binaries into it made "verify what's actually installed" harder. Users
upgrading from a version that stored `vale-ls` next to the extension files
will see a one-time re-download after upgrading, since the old binary won't
be found at the new path. Documented in `README.md`.

## Issues #61 and #83: wrong-architecture binary, already fixed on `main`

https://github.com/ChrisChinchilla/vale-vscode/issues/61 and
https://github.com/ChrisChinchilla/vale-vscode/issues/83 are the same bug:
a macOS/ARM64 (or otherwise wrong-platform) `vale-ls` binary ends up
installed on a Linux x86_64 machine, so the server fails immediately
(`cannot execute binary file`, exit 126, or "Mach-O 64-bit arm64 executable"
via `file`). Reports span v0.30.0 through v0.32.0 and are commonly, though
not exclusively, from Remote-WSL/Remote-SSH setups. Every reporter who tried
it found the same workaround: delete the installed `vale-ls` and let the
extension redownload it, which always produces the correct binary.

**Root cause**: the pre-hardening `downloadLSP` wrote the downloaded binary
into `context.extensionPath` - the extension's own versioned install
directory - rather than dedicated per-machine writable storage. That
directory isn't guaranteed to be treated as pure local, dynamic state by
VS Code; several reports come from Remote-WSL/Remote-SSH sessions, where
extension-install caching/replication between the local and remote side is
a known source of exactly this kind of cross-platform file mixup. This is a
plausible mechanism inferred from the symptoms (matches every report:
wrong-platform binary specifically at the extension's own install path,
self-heals on delete-and-redownload), not something independently proven
against VS Code's internals from here - but it doesn't matter which exact
mechanism caused it, because the fix removes the shared directory entirely.

**Fix, already on `main`** (commit `916bfbe` at time of writing, still
unreleased - latest published tag is v0.34.0): the binary now installs to
`context.globalStorageUri.fsPath` (see "Install location" above) via an
atomic, checksum-verified install, with a `.vale-ls-version` marker that
forces replacement of any stale or wrong-platform install left over from
before this fix shipped. `buildDownloadAssetName(process.platform,
process.arch)` (unchanged) also means the extension can only ever *request*
the correct platform's asset in the first place - the old bug was about a
wrong binary already on disk surviving, which the new install path no
longer allows.

Next release should close both issues.

## Download hardening, end to end

`downloadLSP` (src/lsp.ts):
1. Resolves the asset name and expected checksum for the current
   platform/arch (`buildDownloadAssetName`, `getExpectedChecksum` in
   `src/utils.ts`); refuses to proceed if either is unknown.
2. Checks `response.ok` (HTTP status) before trusting the body.
3. Buffers the full response, cross-checks its length against
   `Content-Length` if present (catches truncated transfers early).
4. Hashes the buffer and compares against the expected digest
   (`sha256Hex`/checksum compare in `src/utils.ts`) before touching disk.
5. Extracts only the single expected executable entry from the zip (not
   `directory.extract()` over the whole archive) to a temp file in the
   install directory, `chmod 0o755`, then `rename`s it into place — the
   rename is atomic on the same filesystem, so a failed/interrupted
   download never leaves a partially-written `vale-ls` binary at the path
   the extension will later execute.

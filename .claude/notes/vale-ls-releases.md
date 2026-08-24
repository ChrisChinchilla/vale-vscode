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

## Issue #61: both root causes confirmed, both already fixed on `main`

https://github.com/ChrisChinchilla/vale-vscode/issues/61 has two distinct
threads across its comments, spanning v0.30.0 through the currently-released
v0.34.0 (tagged 2026-02-25). As of that release, **neither fix below had
shipped yet** - both landed on `main` afterwards (the storage fix on
2026-08-05, the `LSP_TAG` bump earlier in the same session as this note) -
so v0.34.0 users can still hit both. Next release should close this issue.

**Thread 1: wrong-architecture binary (a macOS/ARM `vale-ls` on x86_64
Linux), "fixed" by deleting the file and letting it re-download.** The
pre-hardening `downloadLSP` (`src/lsp.ts` before the "Fix security concerns"
commit) wrote the downloaded binary into `context.extensionPath` - the
extension's own versioned install directory - rather than a dedicated
per-machine writable location. That directory isn't guaranteed to be treated
as pure local, dynamic state by VS Code; multiple user reports are from
Remote-WSL/Remote-SSH sessions, where extension-install caching/replication
between the local and remote side is a known source of exactly this kind of
cross-platform file mixup. This is a plausible mechanism, not something
independently proven against VS Code's internals from here - but it fits
every symptom (wrong-platform binary specifically in `.vscode-server/.../
<ext-dir>/vale-ls`, self-heals on delete-and-redownload, one user's dir
literally named `...-0.34.0-universal`, i.e. a non-platform-specific
package). Moving the install to `context.globalStorageUri` (see "Install
location" above, already on `main`) removes the extension's own install
directory from the picture entirely, which resolves this regardless of the
exact prior mechanism.

**Thread 2: `GLIBC_2.38'/'GLIBC_2.39' not found`, still reported as of
2026-06-05 against the released v0.34.0.** Confirmed by direct testing, not
just reading code: downloaded the exact `vale-ls-x86_64-unknown-linux-gnu.zip`
v0.4.0 asset shipped in v0.34.0 (checksum and ELF BuildID
`80842559373b03488701aa7efc9ab991dfb5d0b5` both match what reporters pasted)
and ran it under Docker across `ubuntu:22.04` (glibc 2.35), `ubuntu:24.04`
(2.39), `debian:11` (2.31), and `debian:12` (2.36). It failed with the exact
reported `GLIBC_2.38`/`GLIBC_2.39` error everywhere except `ubuntu:24.04` -
`objdump -T` confirms it references glibc symbols up to `GLIBC_2.39`. The
same test against the `v0.5.0` binary already pinned by `LSP_TAG` succeeded
on every one of those four distros (`objdump -T` tops out at `GLIBC_2.17`,
i.e. RHEL 7/2012-era) - so the `LSP_TAG` bump to `v0.5.0` (done for the
unrelated `valeBinaryPath` initialization-option bug, see
`.claude/notes/workspace-trust.md`) independently and fully fixes this
thread too, for every glibc-based Linux distro in realistic current use.
`aarch64-unknown-linux-gnu` was unaffected at both versions (only the
x86_64 v0.4.0 build had the inflated glibc requirement) - no reports were
ARM-Linux-specific either, consistent with that.

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

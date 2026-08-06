# vale-ls release pinning and checksums

`src/utils.ts` hardcodes `LSP_TAG` (currently `v0.4.0`) and a
`EXPECTED_CHECKSUMS` map of SHA-256 digests, one per platform/arch release
asset. `downloadLSP` in `src/lsp.ts` refuses to install a binary whose
downloaded bytes don't match the recorded digest for its filename — this is
the fix for the "harden the vale-ls download" finding in `PROJECT_AUDIT.md`
(previously: no status check, no checksum, extracted straight into the
extension's own install directory).

## Why hardcoded checksums instead of an upstream checksums file

`errata-ai/vale-ls` releases do not currently publish a `SHA256SUMS` (or
similar) file alongside the platform zips — checked via
`gh api repos/errata-ai/vale-ls/releases/tags/v0.4.0`, which only lists the
six per-platform `.zip` assets. Without an upstream-published, signed digest
to pin against, the digests are computed once (by downloading each asset
directly from the GitHub release and hashing it) and embedded in source, so
a compromised or corrupted download can be detected and rejected before
extraction.

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
  curl -sL -o "$f" "https://github.com/errata-ai/vale-ls/releases/download/$TAG/$f"
done
shasum -a 256 *.zip
```

Update `LSP_TAG` and every entry in `EXPECTED_CHECKSUMS` in `src/utils.ts`
together, in the same commit. `src/utils.test.ts`'s
`buildDownloadAssetName` suite asserts every producible platform/arch
combination has a matching checksum entry — it will fail if one is missed.

## Install location

The binary is installed into `context.globalStorageUri.fsPath` (via
`getInstallDir` in `src/lsp.ts`), not the extension's own install directory
(`context.extensionPath`). The extension install directory can be read-only
post-install on some platforms/configurations, and mixing downloaded
binaries into it made "verify what's actually installed" harder. Users
upgrading from a version that stored `vale-ls` next to the extension files
will see a one-time re-download after upgrading, since the old binary won't
be found at the new path. Documented in `README.md`.

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

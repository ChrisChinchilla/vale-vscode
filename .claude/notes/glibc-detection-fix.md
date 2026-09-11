# glibc/musl detection fix (issue #123)

## What broke

`isUnsupportedLinuxLibc` (added for the earlier "handle unsupported Linux
libc explicitly" audit item) blocked activation whenever
`process.report?.getReport().header.glibcVersionRuntime` came back empty,
treating that as "this is musl". But `process.report` is unavailable inside
the **VS Code extension host** - it's not just missing
`glibcVersionRuntime`, `process.report` itself is `undefined` there, unlike
in a plain Node process. So on genuinely glibc-based hosts (confirmed: a
Debian trixie Dev Container, and plain Ubuntu 22.04) the check always failed
closed and refused to activate, even though nothing about the environment
was actually musl. See
https://github.com/ChrisChinchilla/vale-vscode/issues/123.

The pure unit tests for `isUnsupportedLinuxLibc` all still passed the whole
time - they exercise the boolean logic directly with hand-picked inputs, not
the real detection path inside a real extension host. `node --test`
(`npm test`) runs in plain Node, where `process.report` normally *is*
defined, so it never observed the actual failure mode. This is the general
limit of `src/utils.ts`'s test setup (see the repo's `.claude/CLAUDE.md`):
it's excellent for pinning down policy/logic, but structurally cannot catch
a bug that only exists in the gap between plain Node and the extension host.

## The fix

- Detection now goes through the [`detect-libc`](https://github.com/lovell/detect-libc)
  package instead of reading `process.report` directly. It tries, in order:
  the ELF interpreter path embedded in `/proc/self/exe` (the running Node
  binary's own dynamic linker - `/lib64/ld-linux-*` for glibc,
  `/lib/ld-musl-*` for musl), then the byte content of the `/usr/bin/ldd`
  binary itself (which embeds `"GNU C Library"` or `"musl"`), *then*
  `process.report` (still tried, still useless here, but harmless), then
  spawning `getconf`/`ldd --version` as a last resort. The first two are
  plain filesystem reads with no dependency on `process.report`, so they
  work fine inside the extension host.
- `isUnsupportedLinuxLibc(processPlatform, libcFamily)` (`src/utils.ts`) now
  takes `detect-libc`'s result directly (`"glibc" | "musl" | null`) and
  **fails open**: it only returns `true` when the family is confirmedly
  `"musl"`. `null` ("couldn't determine it") is treated as supported, not as
  unsupported. This is the actual policy fix - even with a better detection
  library, defaulting "unknown" to "blocked" would reproduce the same class
  of bug the moment detection is inconclusive on some future host.
- `ensureLanguageServerBinary` (`src/languageServer.ts`) logs a diagnostic
  line when the family can't be determined on Linux, so an inconclusive
  result is still visible via **Vale: Show Diagnostics** even though it no
  longer blocks activation.
- The `[diagnostics] Extension host: ...` banner in `src/lifecycle.ts` uses
  the same `detect-libc` calls (`family()`/`version()`) instead of
  duplicating the old raw `process.report` read, so it reports real values
  in the same environments where the old code silently printed "not
  detected".

## Test plan, now and going forward

1. **Pure unit tests** (`src/utils.test.ts`, `isUnsupportedLinuxLibc`
   describe block): cover confirmed musl on Linux (blocked), confirmed glibc
   on Linux (allowed), non-Linux (always allowed), and - the actual
   regression test for this issue - **undetermined (`null`) libc family on
   Linux must be allowed, not blocked**. This locks in the fail-open policy,
   which is the part that actually broke; it does not (and structurally
   cannot) test whether `detect-libc` itself correctly detects a given host.
2. **Real extension host assertion** (`test/integration/suite/index.ts`,
   runs via `@vscode/test-electron` under `npm run test:integration`, which
   CI's `build.yaml` runs under `xvfb-run` on `ubuntu-latest`): calls the
   production `ensureLanguageServerBinary()` with temporary global storage
   containing a placeholder binary and the current version marker. It
   asserts that the cached binary path is returned, without downloading or
   starting a server. This exercises the extension's actual libc gate in
   the extension host, so restoring the original false-positive rejection
   on Linux fails the test even if `detect-libc` itself still works.
   The same test runs on non-Linux hosts to check cached binary resolution;
   only the Linux CI run covers the libc regression. Temporary storage and
   the test output channel are cleaned up after the assertion.
3. **What CI still can't reach**: `ubuntu-latest`'s GitHub-hosted extension
   host is not a Dev Container / remote extension host - the original
   report was specifically against `remoteName: dev-container`. If
   the production libc gate or detection fallbacks are ever found to behave
   differently under a *remote* extension host specifically (as opposed to
   extension-host-in-general), that gap needs a real devcontainer run to
   catch, the same limitation already documented for Workspace Trust in
   `.claude/notes/workspace-trust.md`. Add a devcontainer-based CI job (or
   extend `.devcontainer/issue-54`'s manual matrix to explicitly re-check
   **Vale: Show Diagnostics**' libc line) if this ever regresses again in a
   way the `ubuntu-latest` job doesn't catch.
4. **Manual verification**: the existing manual release matrix in
   `.claude/notes/workspace-trust.md` (item 1, "Debian/Ubuntu devcontainer,
   fresh extension install, trusted workspace") remains the closest
   real-world check; confirm **Vale: Show Diagnostics** now reports
   `libc: glibc <version>` rather than `libc: not detected` on such a host
   before closing out a release that touches this path.

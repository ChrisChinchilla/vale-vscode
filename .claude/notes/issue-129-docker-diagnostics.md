# Issue #129: libc diagnostics crash and Docker diagnostics

Reporter on Fedora 44 (glibc, native VS Code) saw no commands registered (1.2.1),
then `Cannot read properties of undefined (reading 'header')` and, with
`vale.docker.enabled`, vale-ls's `expected value at line 1 column 1` (1.3.1).

## Confirmed

- `detect-libc`'s `version()` falls back to `process.report.getReport().header`.
  In the extension host `getReport()` can return `undefined`, so it throws.
  `lifecycle.ts` ran this outside any try/catch (1.3.1 had one; it was lost),
  aborting `activate()` before `registerCommands`. The libc diagnostics are now
  guarded, and `languageServer.ts`'s `family()` call fails open.
- `vale.trace.server` output went to a per-client channel, not "Vale". Server and
  trace output now go to one "Vale Language Server" log channel (the client
  requires a `LogOutputChannel`, so it can't be the plain "Vale" channel).

## Not confirmed - diagnostics only

The Docker failure cause is unknown. Hypotheses: podman-docker short-name
resolution without a TTY, SELinux denying the bind mount (needs `:z`/`:Z` or
`label=disable`), rootless user mapping, or vale-ls temp files outside the
mounted workspace. Docker mode now runs `--version` and `ls-config` through the
wrapper at startup and logs exit code/stdout/stderr (`logDockerPreflight`).
Wait for the reporter's output before adding SELinux/podman options.

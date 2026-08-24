# Vale CLI minimum-version check for filters

Fixes the confusing part of https://github.com/ChrisChinchilla/vale-vscode/issues/63
("`:0:0: filter '.Level in [...]' not found`", linting silently breaks).

## Root cause (confirmed upstream, not an extension bug)

`vale-ls` forwards this extension's `filter` initialization option straight
through as `vale --filter=<value>` (`src/server.rs`/`vale.rs` in
`vale-cli/vale-ls`, verified against a local checkout). Before Vale CLI
**v3.10.0** (released 2025-03-18), `--filter` only accepted a file path or a
named asset on `StylesPath` - passing a raw expression like
`.Level in ["suggestion", "warning", "error"]` (exactly what
`buildValeFilterExpression` in `utils.ts` builds) fell through to
`filter '%s' not found`. Fixed upstream in
[errata-ai/vale#967](https://github.com/errata-ai/vale/commit/c33614918)
("fix: support filters through strings or files"), which explicitly adds
"Case 3: Assume the user has provided a string" - confirmed by running the
exact filter expressions this extension generates against a current Vale
install, which now works. This was never a bug in `buildValeFilterExpression`
or vale-ls's forwarding - the expressions were always valid Vale filter
syntax, just unsupported by Vale CLI before that fix.

**This still bites people on defaults.** `vale.enableSpellcheck` defaults to
`false`, and `buildValeFilterExpression` always emits
`.Extends != "spelling"` whenever spellcheck is off - so *every* user on
default settings sends a non-empty filter, regardless of
`minAlertLevel`. Anyone on a Vale CLI older than 3.10.0 (plausible for
projects that pin an exact Vale version via `mise`/`asdf`/CI, as in the
original report) hits this immediately, out of the box, with linting
completely broken and only the cryptic passthrough error to go on.

One reporter (Ravlen, Vale 3.11.2 - technically past the fix) saw the same
error anyway; the likely explanation is a PATH mismatch between their
interactive shell (with `mise` shims active) and whatever `vale` the
extension host's spawned subprocess actually resolved to, not a second bug
in Vale itself. That's a separate, generic problem `vale.valeCLI.path`
already exists to work around.

## What was added

`MIN_VALE_FILTER_VERSION = [3, 10, 0]`, `parseValeVersion`, and
`isVersionAtLeast` in `utils.ts` (pure, unit-tested in `utils.test.ts`).
`getValeVersionOutput` in `cli.ts` runs `vale --version` through the same
`spawnVale` used by every other direct CLI invocation (so it honors Docker
mode, the Windows proxy, and `vale.valeCLI.path` identically). 
`warnIfValeTooOldForFilters` in `languageServer.ts` ties them together and
is called from `startClientForFolder`, once per client start.

**Only runs when a filter is actually being sent** (`valeConfig.filter` is
non-empty) - a user with `vale.valeCLI.minAlertLevel: inherited` and
`vale.enableSpellcheck: true` never sends a filter and isn't affected, so
they shouldn't be warned about an old Vale that works fine for them.

**Fails silent, not loud, when the version can't be determined** - a missing
binary, Docker being unavailable, or unparseable `--version` output all
resolve to "can't check" (`getValeVersionOutput`/`getValeVersion` return
`null`) rather than a check-specific error. In particular, when
`vale.valeCLI.installVale` is managing its own Vale binary internally
(not necessarily on `$PATH`), `execution.binaryPath` falls back to the bare
`"vale"` command, which may not resolve to anything on this machine's
`$PATH` at all - `spawnVale` then fails with ENOENT, which is treated the
same as "can't check" rather than a false alarm. `client.start()` will
still surface the real error if one exists either way; this check exists to
make *why* clearer, not to replace that error.

**Non-blocking.** The check warns (`vscode.window.showWarningMessage`) and
logs to the Vale output channel; it never prevents `client.start()`. An old
Vale might still work for other things (Sync, non-filtered linting), and
the check itself could be wrong (e.g. a custom `vale` wrapper script that
doesn't support `--version` the same way) - better to warn once than to
block startup on a heuristic.

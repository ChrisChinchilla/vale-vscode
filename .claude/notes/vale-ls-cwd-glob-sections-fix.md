# vale-ls working directory and file-glob sections (#73)

[Issue #73](https://github.com/ChrisChinchilla/vale-vscode/issues/73):
per-file section overrides in `.vale.ini` (e.g. `[CHANGELOG*.md]` or
`[docs/**/*.md]` with their own `BasedOnStyles`/rule overrides) are ignored
by the extension even though `vale` on the CLI, run from the project root,
respects them. A related report describes nested directory globs (e.g.
`[docs/**/*.md]` plus `[docs/notes/**/*.md]`) causing linting to stop
entirely for those sections rather than just ignoring the override.

Root cause: `vale` (and therefore `vale-ls`, which wraps it) matches a
section's glob pattern against each file's path relative to the process's
current working directory. `startClientForFolder` in `src/languageServer.ts`
spawned `vale-ls` via `ServerOptions.run`/`debug` without an `options.cwd`,
so the child process inherited the extension host's own cwd (typically the
VS Code install directory, not the workspace) instead of the workspace
folder. Relative section globs therefore never matched, silently falling
back to the top-level (sectionless) config. When a section's
`BasedOnStyles` only appears inside the section itself (as in the second
report), a non-matching section means no styles at all, i.e. that section's
files stop being linted.

Every other place this extension shells out to `vale` (`src/cli.ts`'s
`runValeCommand`/`getStylesPathsFromVale`, via
`buildValeSpawnOptions(cwd)`) already passes an explicit `cwd`; the
language server spawn was the one path that didn't.

Fix: `startClientForFolder` now passes `options: { cwd: workspaceRoot }` on
both `run` and `debug` in `ServerOptions`, using the same
`folder?.uri.fsPath` already used to resolve `configPath`. In the no-folder
(single-file) case there's no workspace root to scope to, so `cwd` is left
unset, matching prior behavior.

Not unit tested: `startClientForFolder` depends on `vscode`/
`LanguageClient` state and isn't mockable with the current `vscode`-free
`src/utils.ts` test setup (same caveat as
`duplicate-sync-on-startup-fix.md`).

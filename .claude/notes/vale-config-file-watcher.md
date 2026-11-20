# Vale config file watcher (`.config/vale.ini`, Vale 3.25.1)

## What changed
- Removed the `**/.clientrc` file watcher passed to the language client as
  `synchronize.fileEvents` (`src/languageServer.ts`). `.clientrc` is a leftover
  from the VS Code language-client sample and nothing in Vale uses it. It was
  dead code, and vale-ls ignores `workspace/didChangeWatchedFiles` anyway, so
  it would not have helped even with the right pattern.
- Added `registerValeConfigFileWatcher` (wired in `src/lifecycle.ts` with the
  other watchers): one workspace-wide watcher on `VALE_CONFIG_FILE_GLOB`
  (`src/utils.ts`) = `**/{.vale.ini,_vale.ini,.config/vale.ini}`. A
  create/change/delete restarts the owning folder's client, debounced 500ms
  per folder, and only if that client is currently running.

## Why restart at all
vale-ls spawns `vale` fresh for each lint, so a config edit already applies
to the *next* lint. What it can't do is refresh diagnostics already shown in
open documents. Restarting the client re-opens and re-lints them.

## Gotchas
- `resolveConfigPath` only expands `~`, `${env:...}`, `${workspaceFolder}`;
  it assumes no filename, so `.config/vale.ini` needed no change there.
- A config with a custom name (via `vale.valeCLI.config`, e.g. `team.ini`) is
  not matched by the glob and is not watched. Possible follow-up: also watch
  the explicit path.
- Keep `VALE_CONFIG_FILE_PATTERNS` in step with Vale's own discovery.
- Not unit tested beyond the glob constant: the watcher itself lives in
  `vscode`-dependent code. Verify manually: edit `.config/vale.ini` with a
  file open and confirm diagnostics refresh.

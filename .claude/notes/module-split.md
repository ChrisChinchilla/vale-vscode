# Splitting src/lsp.ts

`src/lsp.ts` grew to ~770 lines (the multi-root fix in
`multi-root-workspaces.md` added most of the recent growth on top of an
already-large file) and was split into focused modules, per the "Split
src/lsp.ts" item in `PROJECT_AUDIT.md`.

## Module boundaries and why

- `workspaceFolders.ts` — folder-identity helpers (`clientKeyFor`,
  `noFolderClientKey`, `getRelevantWorkspaceFolder`). Split out on its own
  because both `languageServer.ts` (keying the client map) and `commands.ts`
  (picking which folder a command acts on) need the exact same "which folder
  does this belong to" logic; duplicating it risked the two drifting apart.
- `ui.ts` — the output channel and the "Vale" tree view. Owns the
  module-level `valeOutputChannel` (via `createValeOutputChannel`/
  `getValeOutputChannel`) since `cli.ts` and `commands.ts` both need to write
  to the same channel instance without importing each other.
- `config.ts` — `buildValeConfig`, turning a `vscode.WorkspaceConfiguration`
  plus a workspace root into vale-ls `initializationOptions`. Kept separate
  from `languageServer.ts` so the (non-trivial) settings-to-filter-string
  translation isn't buried inside client start/stop plumbing.
- `cli.ts` — direct `vale` CLI invocations (`runValeCommand`,
  `getStylesPathsFromVale`), as opposed to talking to vale-ls over LSP.
- `vocabulary.ts` — reading/writing vocabulary files; depends on `cli.ts`
  for `getStylesPathsFromVale`.
- `languageServer.ts` — the largest remaining module (~290 lines): binary
  download/install (`ensureLanguageServerBinary`) and the per-folder
  `LanguageClient` map (`startClientForFolder`, `stopAndRemoveClient`,
  `registerWorkspaceFolderWatcher`). Left as one module rather than split
  further because download and client-lifecycle code both need to agree on
  the same `clients` map and are tightly sequenced in `activate()`.
- `commands.ts` — registers the five `vscode.commands.registerCommand` calls
  and the tree view; each command's own logic is only a few lines, so it
  wasn't worth further splitting per-command.
- `lifecycle.ts` — `activate`/`deactivate`. Contains no logic of its own,
  only calls into the other modules in order — this is what a reader should
  open first to see the overall startup sequence.
- `lsp.ts` — reduced to `export { activate, deactivate } from "./lifecycle"`.
  Kept as a real (if trivial) file, rather than renaming it away, because
  `webpack.config.js`'s `entry` and `package.json`'s `main` both point at the
  compiled output of this file; changing that path wasn't worth the
  build-config edit for a pure rename.

## Testability side effect

While splitting `config.ts` out, the `minAlertLevel`/`enableSpellcheck` →
Vale filter-expression logic was pulled into a new pure function,
`buildValeFilterExpression` in `utils.ts` (with tests in `utils.test.ts`),
since it had no actual dependency on `vscode` types once the
`WorkspaceConfiguration` reads were done by the caller. `config.ts`'s
`buildValeConfig` is now a thin `vscode`-facing wrapper around it.

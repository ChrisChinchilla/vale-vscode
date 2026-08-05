# Multi-root workspace support

Fixes the "Support multi-root workspaces correctly" item in `PROJECT_AUDIT.md`
and the underlying bugs behind GitHub issues #10 and #55 (folder-scoped
`vale.valeCLI.config`/`${workspaceFolder}` and per-folder settings.json being
ignored in multi-root windows).

## Why one `LanguageClient` per workspace folder

Checked via `docs.vale.sh/guides/lsp`: vale-ls resolves configuration per
document by walking up to the innermost folder containing it, and exposes a
single `configPath` override that applies to *every* document server-wide
once set. It does not document support for `workspace/configuration` pull
requests scoped by `scopeUri`, so a single shared server process has no way
to be told "use this config for folder A, that config for folder B."

This is exactly the situation VS Code's own language-extension guidance
describes for servers without native multi-root support: run one
`LanguageClient` per workspace folder, each restricted via `documentSelector`
(and the `workspaceFolder` client option) to that folder's files, with its
own `initializationOptions` resolved from that folder's settings. That's the
approach taken here (`src/lsp.ts`, `startClientForFolder` /
`buildValeConfig`).

## What changed

- `clients: Map<string, LanguageClient>` (keyed by `folder.uri.toString()`,
  or a sentinel key for the no-workspace/single-file case) replaced the
  single module-level `client`.
- `vscode.workspace.getConfiguration(undefined, folder?.uri)` (resource-scoped)
  replaced the unscoped `vscode.workspace.getConfiguration()`, so a folder's
  own `.vscode/settings.json` is respected instead of only the first folder's
  or the user/workspace-level value.
- `resolveConfigPath`'s `${workspaceFolder}` substitution and relative-path
  resolution now use the specific folder's root, not always
  `workspaceFolders[0]`.
- `vscode.workspace.onDidChangeWorkspaceFolders` starts/stops clients as
  folders are added/removed after activation, instead of doing nothing
  (previously a no-op — folders added later were never linted until a window
  reload).
- Commands (`vale.sync`, `vale.showConfig`, `vale.showMetrics`, the two
  vocabulary commands) now resolve their target folder via
  `getRelevantWorkspaceFolder()` — the folder containing the active editor's
  document, falling back to the first workspace folder — instead of always
  using `workspaceFolders[0]`.

## Known remaining limitation

`vale.valeCLI.path` (custom Vale binary path) still isn't wired up per the
README's existing warning — unrelated to this fix, vale-ls doesn't support a
custom binary path at all currently.

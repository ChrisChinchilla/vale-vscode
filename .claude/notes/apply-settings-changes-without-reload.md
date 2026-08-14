# Apply settings changes without a window reload

`PROJECT_AUDIT.md`'s "apply settings changes" finding (originally reported
as [#35](https://github.com/ChrisChinchilla/vale-vscode/issues/35), tested
against toggling `vale.enableSpellcheck`): settings are only read once, at
client-start time inside `startClientForFolder` (`src/languageServer.ts`),
via `buildValeConfig` (`src/config.ts`). Nothing reacted to
`vscode.workspace.onDidChangeConfiguration`, so changing any
`initializationOptions`-feeding setting required "Reload Window" to take
effect.

Fix: `registerConfigurationWatcher` in `src/languageServer.ts` (wired up in
`src/lifecycle.ts` alongside the existing `registerWorkspaceFolderWatcher`)
listens for `onDidChangeConfiguration` and restarts the relevant client(s)
via `startClientForFolder` - the same stop-then-recreate primitive the
workspace-folder-added path already uses; there's no separate "update
options on a live client" API in vscode-languageclient.

- Watches a fixed list, `VALE_CONFIG_SETTINGS`: every setting
  `buildValeConfig` reads (`vale.enableSpellcheck`,
  `vale.valeCLI.minAlertLevel`, `vale.valeCLI.config`,
  `vale.valeCLI.syncOnStartup`, `vale.valeCLI.installVale`). Add new
  settings to both lists together if `buildValeConfig` grows more inputs.
- Checks `event.affectsConfiguration(setting, folder.uri)` per workspace
  folder (not a single window-wide check), so a folder-scoped override in
  one folder's `.vscode/settings.json` only restarts that folder's client -
  consistent with how multi-root workspaces already scope these settings
  per folder (see `multi-root-workspaces.md`).
- In no-folder (single-file) mode, checks `affectsConfiguration(setting)`
  with no resource scope and restarts the single no-folder client.

Not unit tested: like the sync-on-startup fix, this lives entirely inside
`vscode`-dependent client-management code with no pure-function extraction
point. See `.claude/CLAUDE.md`'s Testing section.

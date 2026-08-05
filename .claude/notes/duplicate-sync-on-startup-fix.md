# Duplicate `vale sync` on startup

`PROJECT_AUDIT.md`'s "prevent duplicate startup synchronization" finding:
when `vale.valeCLI.syncOnStartup` was enabled, sync ran twice on every
extension startup.

- `activate()` builds `valeConfig` from settings and passes it as
  `initializationOptions` to the `LanguageClient`, including
  `syncOnStartup: configuration.get("vale.valeCLI.syncOnStartup")`. Per the
  [Vale LSP docs](https://docs.vale.sh/guides/lsp) ("Run `vale sync` when
  the server starts"), `vale-ls` itself runs `vale sync` on startup when
  this initialization option is set — confirmed by fetching that page
  directly rather than trusting the audit's citation at face value.
- Separately, after `client.start()` resolved, `activate()` also called the
  extension's own `runValeSync()` helper (the same one behind the
  **Vale: Sync** command) whenever the setting was on. That ran `vale sync`
  a second time via the CLI directly, redundant with what `vale-ls` had
  just done.

Fix: removed the extension-side `runValeSync()` call in `activate()`'s
startup path. `vale.valeCLI.syncOnStartup` now only reaches `vale-ls` via
`initializationOptions`; the **Vale: Sync** command (`runValeSync` /
`vale.sync`) is unchanged and still available for manual syncs.

Not unit tested: this removal lives entirely inside `activate()`, which
depends on `vscode`/`LanguageClient` state (module-level `client`,
`ExtensionContext`) that isn't mockable with the current
`vscode`-free `src/utils.ts` test setup. See `.claude/CLAUDE.md`'s
Testing section — worth revisiting if `lsp.ts`'s startup logic gets
extracted into a testable, dependency-injected function.

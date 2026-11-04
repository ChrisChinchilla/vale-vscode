# Roadmap from the Vale 3.16-3.26 / vale-ls 0.5-0.6 review (2026-11)

Research summary: most Vale engine changes (native MDX, Typst/Quarto/MyST/
Jupyter formats, Sphinx, speed, spelling) arrive via the `vale` binary with no
extension work. Gaps are in what vale-ls exposes and the extension ignores.
Server commands: `cli.sync`, `cli.compile`, `cli.install`, `vocab.add`,
`vocab.reject`, `doc.metrics` (extension calls none via `executeCommand`).
vale-ls defaults: lint-on-change on, debounce 300ms, metrics code lens on.

## Status

### Tier 1
- [x] Config file watcher: drop dead `.clientrc`, watch `.vale.ini`,
      `_vale.ini`, `.config/vale.ini`, restart on change. See
      `vale-config-file-watcher.md`. README updated. Needs manual check in a
      real extension host.
- [x] Send `lintOnChange`, `debounceMs`, `showMetrics` to vale-ls. Decision:
      honour the documented defaults (both booleans `false`, debounce 300),
      which is a behaviour change for existing users (see
      `editor-behaviour-settings.md`). Needs manual check in a real host.
- [ ] Moved to `rule-authoring-plan.md` (considered optional): `Vale: Open
      Rule in Regex101`. It wraps an existing vale-ls command (`cli.compile`),
      not a new Vale feature.

### Tier 2 (scope not confirmed)
- [ ] `Vale: Run Rule Tests` and rule-file menu visibility: moved to
      `rule-authoring-plan.md`.
- [x] Surface detected Vale version in Show Diagnostics; warn below feature
      minimums (filters 3.10.0, `.config/vale.ini` 3.25.1). See
      `vale-version-awareness.md`. Needs manual check in a real host.
- [x] UI audit items: language status item, Select Configuration File,
      Vale editor submenu, cancellable progress, tree view removal, config as
      JSON, settings reorganisation. See `ui-status-and-settings.md`. Needs
      manual check in a real host. (Open Vale Settings is under Future work.)

### Parked
- Lint-on-demand CLI mode (server already lints on change/save).
- WASM / web extension (Vale 3.26 ships a WASM build).
- YAML vocabulary support (Vale 3.25; `accept.txt`/`reject.txt` still work).

## Possible follow-up from the watcher work
- Also watch an explicit `vale.valeCLI.config` path with a non-standard name.

## Future work (owner wants to think about it first)
- **Open Vale Settings command**: opens Settings filtered to this extension
  (`workbench.action.openSettings` with `@ext:<publisher>.vale-vscode`).
  Trivial to build; deferred pending a decision on whether to add it.

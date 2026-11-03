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
- [ ] Send `lintOnChange`, `debounceMs`, `showMetrics` to vale-ls
      (`ValeInitializationOptions`/`buildValeConfig`, `VALE_CONFIG_SETTINGS`).
      They are declared in `package.json` but never sent, so the server's
      defaults always win (the metrics lens shows even with `showMetrics`
      false). Open decision: keep the `false` default for `showMetrics` or
      match the server (shown).
- [ ] `Vale: Open Rule in Regex101` via server command `cli.compile` (YAML rule
      files only; editor title/context menu).

### Tier 2 (scope not confirmed)
- [ ] `Vale: Run Rule Tests` (`vale test`, needs Vale >= 3.24; `--coverage`
      variant). Undecided whether it belongs in the extension.
- [ ] Contextual menu visibility for rule-file commands.
- [ ] Surface detected Vale version in Show Diagnostics; warn below feature
      minimums.
- [ ] Open UI audit items: LanguageStatusItem, Select Configuration File,
      Vale editor submenu.

### Parked
- Lint-on-demand CLI mode (server already lints on change/save).
- WASM / web extension (Vale 3.26 ships a WASM build).
- YAML vocabulary support (Vale 3.25; `accept.txt`/`reject.txt` still work).

## Possible follow-up from the watcher work
- Also watch an explicit `vale.valeCLI.config` path with a non-standard name.

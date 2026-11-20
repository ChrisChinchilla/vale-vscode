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
      `lintOnChange` defaults to `true` (long-standing behaviour),
      `showMetrics` to `false`, debounce 300; the metrics lens turning off is
      a behaviour change for existing users (see
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
      manual check in a real host. (Open Vale Settings is done: `vale.openSettings`.)

### Parked
- Lint-on-demand CLI mode (server already lints on change/save).
- WASM / web extension (Vale 3.26 ships a WASM build).
- YAML vocabulary support (Vale 3.25; `accept.txt`/`reject.txt` still work).

## Possible follow-up from the watcher work
- Also watch an explicit `vale.valeCLI.config` path with a non-standard name.

## Ideas backlog (not scheduled)
UI:
- Show the Vale in use (source and version) in the language status item.
- Add a **Select Configuration File** action to the status item, beside the
  click-through to Show Diagnostics; link "Not running" to **Vale: Open
  Settings**.
- First-run prompt before the managed Vale is downloaded when none is found
  (also in the source-selection backlog below).
- A download/update channel setting (for example opting in to pre-release
  vale-ls builds), from the original settings layout proposal.
Efficiency gaps found while building lazy start and sync routing:
- `startIfRelevant` (`lifecycle.ts`) ignores a trigger that arrives while the
  config-file search is running, so a listed-language file opened mid-check
  can be missed if the search finds nothing. Fix: re-run the check once when a
  trigger arrives while checking, with a test.
- **Vale: Sync** syncs only the resolved folder in a multi-root workspace in
  both routes. A loop over every folder (with the direct route's progress and
  Cancel) would sync them all.
- A failed server start is not retried until **Vale: Restart Language
  Server**; the error message could say so.

## Backlog: Vale source selection (think more before building)
Recorded in `PROJECT_AUDIT.md` (Efficiency). Default is now "Vale on PATH,
else managed"; open questions: confirm before auto-downloading, show source
and version in the status item, warn on PATH-vs-managed version mismatch,
per-folder choice, selector after first managed install. Design and
trade-offs: `lazy-activation-and-cli-runner.md`.

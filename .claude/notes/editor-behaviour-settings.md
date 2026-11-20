# lintOnChange / debounceMs / showMetrics now reach vale-ls

## Problem
`vale.valeCLI.lintOnChange` (default false), `debounceMs` (300) and
`showMetrics` (default false) were declared in `package.json` and the README
but never put into `initializationOptions`. vale-ls (v0.5.0+) treats an
*absent* `lintOnChange` or `showMetrics` as ON (`!= Some(false)` in
`server.rs`), so users always got lint-as-you-type and the metrics code lens,
contradicting the documented defaults and the README line "Linting runs on
save by default".

## Fix
- `resolveEditorBehaviorOptions` (`src/utils.ts`, unit tested) normalises the
  three values: `lintOnChange` defaults to `true`, `showMetrics` to `false`;
  `debounceMs` must be a finite number >= 0 (rounded), else 300.
- `buildValeConfig` (`src/config.ts`) spreads the result into
  `ValeInitializationOptions`, so they are always sent explicitly.
- Added to `VALE_CONFIG_SETTINGS` (`src/languageServer.ts`) so changing them
  restarts the client (vale-ls reads them from the options at start).

## Decision: lintOnChange defaults to TRUE (revised)
The first version honoured the old documented default (`false`). In use,
underlines stopped showing in the editor while the Problems panel still
listed issues, because diagnostics went stale between saves. Users have had
lint-as-you-type for years, so the default is now `true` (package.json, README,
`resolveEditorBehaviorOptions`). `showMetrics` stays `false` (the code lens was
only ever on by accident).

## Lint when lintOnChange is off
vale-ls lints on `didOpen` and on `didSave` (it advertises
`save.includeText`) regardless of `lintOnChange`; the setting only gates the
debounced lint in `didChange`. So with it off, an initial lint still runs when
a document opens, and underlines update on save. No client change was needed.
Not verified in a real host: that the open-time underlines survive edits until
the next save.

## Not verified
Not exercised in a real extension host. Check: with defaults, underlines
update as you type; with `lintOnChange` off, underlines appear on open and
refresh on save; no metrics lens by default.

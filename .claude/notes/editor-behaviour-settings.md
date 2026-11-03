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
  three values: booleans default to `false`; `debounceMs` must be a finite
  number >= 0 (rounded), else 300.
- `buildValeConfig` (`src/config.ts`) spreads the result into
  `ValeInitializationOptions`, so they are always sent explicitly.
- Added to `VALE_CONFIG_SETTINGS` (`src/languageServer.ts`) so changing them
  restarts the client (vale-ls reads them from the options at start).

## Behaviour change to flag in release notes
Existing users who never touched these settings previously got
lint-as-you-type and the metrics lens by accident. After this change they get
lint-on-save and no lens, until they enable the settings. The alternative
(flip the package.json defaults to true) was rejected because it would
contradict the README and the original intent.

## Not verified
Not exercised in a real extension host. Check: with defaults, typing does not
re-lint until save and no metrics lens appears; enabling each setting takes
effect after the automatic restart.

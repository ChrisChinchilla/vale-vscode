# Vale version awareness

## What it does
`checkValeVersion` (`src/languageServer.ts`, replaces the old
`warnIfValeTooOldForFilters`) probes `vale --version` once per client start,
always logs `Vale X.Y.Z` to the Vale output channel, then warns for:
- filters sent while Vale < `MIN_VALE_FILTER_VERSION` (3.10.0) - unchanged
  behaviour from the earlier check, see `vale-filter-version-check.md`;
- a folder whose only config is `.config/vale.ini` (no explicit
  `vale.valeCLI.config`, no root `.vale.ini`/`_vale.ini`) while Vale <
  `MIN_VALE_CONFIG_DIR_VERSION` (3.25.1), because older Vale silently ignores
  that file.
**Vale: Show Diagnostics** now also re-probes and appends the version, so a
Vale upgraded mid-session shows correctly. It skips the probe in an
untrusted workspace (the executable path is workspace-configurable).

## Pure helpers (`src/utils.ts`, tested)
`describeValeVersion`, `formatValeVersion`, `MIN_VALE_CONFIG_DIR_VERSION`,
alongside the existing `parseValeVersion`/`isVersionAtLeast`.

## Limitations
- With no `vale.valeCLI.path` and no Docker, the probe runs `vale` on PATH,
  not the managed binary vale-ls installs (`installVale`). The managed copy's
  location is internal to vale-ls. So the shown version can differ from what
  actually lints. The README says so.
- No probe cache: one `--version` spawn per client start/restart.
- Adding a new threshold: add a `MIN_...` constant plus a check in
  `checkValeVersion`; the planned `vale test` command (see
  `rule-authoring-plan.md`) needs 3.24.0.

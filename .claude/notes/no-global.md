# `vale.valeCLI.noGlobal` (issue #132)

vale-ls v0.6.0 added a `noGlobal` initialization option that makes every Vale
call it makes pass `--no-global`, so Vale stops merging the user-level
`.vale.ini` into the project configuration (even when `--config` is given).

- `buildValeConfig` (`src/config.ts`) sends `noGlobal` to vale-ls.
- The extension's own direct CLI calls (Sync, Show Configuration, readability
  metrics, vocabulary lookups) pass `--no-global` via
  `buildValeConfigArgs(configPath, noGlobal)` (`src/utils.ts`), because
  vale-ls doesn't run those. `CommandContext.noGlobal` carries the setting.
- Changing the setting restarts the client (`VALE_CONFIG_SETTINGS`).
- Deliberately *not* in `restrictedConfigurations`: it only narrows which
  config Vale reads and doesn't change what executable runs.
- Docker mode: the global `.vale.ini` is visible inside the container, so
  the setting applies there too. Nothing special is needed.
- Requires vale-ls >= v0.6.0, so `LSP_TAG` was bumped to v0.6.0 (checksums
  regenerated per `vale-ls-releases.md`).

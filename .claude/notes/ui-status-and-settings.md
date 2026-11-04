# Language status item, command/UI cleanup, settings reorganisation

Closes the "UI" section of `PROJECT_AUDIT.md` (except Open Vale Settings,
which is deferred: see `vale-updates-roadmap.md`).

## Language status item (`src/ui.ts`)
- One `LanguageStatusItem` (`vale.status`, selector `{scheme: "file"}`)
  summarised by the pure `summarizeLanguageStatus` (`src/utils.ts`):
  Error > Configuration error > Starting > Ready > Not running.
- `languageServer.ts` calls `setClientStatus(key, name, state, detail)` on
  start / ready / failure and `clearClientStatus` in `stopClient`, keyed like
  `clients`. `client.onDidChangeState` reports a server that stops on its own
  (`clients.get(key) === client` guards intentional stops).
- "Configuration error" = any diagnostic with `source === "vale-ls"`,
  severity Error, and code matching `E\d+` (`isValeConfigErrorCode`). vale-ls
  publishes Vale load failures that way (`place_error` /
  `error_to_diagnostic` in vale-ls). Tracked per URI via
  `onDidChangeDiagnostics`.
- One aggregate item for all folders, not per document folder. Click opens
  Show Diagnostics.

## Commands
- **Select Configuration File** (`vale.selectConfigFile`): quick pick (choose
  / clear), open dialog, stored as a workspace-relative forward-slash path
  when inside the folder (`toConfigSettingValue`). Target: WorkspaceFolder in
  multi-root, Workspace in a single-folder window, Global with no folder.
  Updating the setting triggers the existing config-watcher restart.
- **Show Configuration** captures stdout (`runValeCommandCapture`) and opens
  it via `formatConfigOutput` as JSON (plain text fallback).
- **Sync** runs under `withProgress` (Notification, cancellable).
  `runValeCommand` takes an optional `CancellationToken` and kills the
  process, rejecting with `ValeCommandCancelledError`. The vale-ls download
  uses an `AbortController` tied to the progress token.
- Success confirmations (Sync, Restart) use `setStatusBarMessage`; only
  failures are pop-ups.
- Removed the Explorer "Vale" tree (`ValeCommandsProvider`, the `views`
  contribution, `view/title` menu). Commands remain in the palette; trust
  gating is unchanged.
- Editor context: `vale.editorContext` submenu holds Accept/Reject.

## Settings (`package.json`)
Four `configuration` objects (Setup, Linting, Vocabulary, Advanced) with
`order`. **No setting IDs changed.** `null` string defaults became `""`
(all readers already used `|| ""`). Added Markdown descriptions,
`minimum`/`maximum`, `enumItemLabels`, `enumDescriptions`. Keep every
property in exactly one category (the build has no check; I verified with a
script that the union equals the old key set).

## Known gaps
- `vale.install` ("Vale: Install or Update Vale") was declared and documented
  but never registered. Fixed: `installValeCommand` (`src/commands.ts`) calls
  vale-ls's `cli.install` through the shared server-command registry
  (`executeCommand("cli.install")`, routed to the active editor's folder's
  client). Warns instead if no client is running. The server itself reports
  the result and skips when a custom path or Docker is in use.
- Only unit tests for the pure helpers; the UI itself needs a manual pass in
  a real extension host (status item states, cancel buttons, submenu, config
  tab).

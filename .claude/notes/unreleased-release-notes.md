# Draft GitHub release notes (next release)

Release notes live on the GitHub Releases page (see README "Changelog"), not
in a file. Paste and edit this when cutting the release; delete entries once
shipped.

## Behaviour change: metrics code lens off by default
`vale.valeCLI.lintOnChange`, `vale.valeCLI.debounceMs` and
`vale.valeCLI.showMetrics` were documented but never reached the language
server, which treats them as ON when unset. They are now sent explicitly.
Linting as you type stays on by default (`lintOnChange` is `true`), but the
metrics code lens (`showMetrics`) is off unless you enable it:

```json
{
  "vale.valeCLI.showMetrics": true
}
```

If you disable `vale.valeCLI.lintOnChange`, Vale still lints when a file is
opened and when it is saved.

Changing any of these now restarts the language server automatically.

## Improvements
- Vale config files (`.vale.ini`, `_vale.ini`, and `.config/vale.ini`, the
  latter supported from Vale 3.25.1) are watched. Creating, editing, or
  deleting one restarts the server so diagnostics in open files refresh.
- **Vale: Show Diagnostics** and the startup log now report the detected
  Vale version. The extension warns when your Vale is too old for the
  `.config/vale.ini` location (needs 3.25.1) or for the filter settings
  (needs 3.10.0).

## Behaviour changes: when it starts, and which Vale runs
- **The language server starts when needed**, not in every window: when the
  workspace has a Vale config file or `vale.valeCLI.config` is set (even to
  an external file), when you open a file in a language listed
  in the new `vale.startOnLanguages` setting (Markdown, MDX, text,
  reStructuredText, AsciiDoc, HTML, XML, LaTeX, Org by default), or when you
  run a Vale command. If you lint code files with only a user-level
  `~/.vale.ini`, add those languages (for example `go`), or set it to `["*"]`
  to always start.
- **Only files your Vale config can lint are sent to the server.** The
  patterns come from sections enabling styles or individual rules and
  `[formats]`. Global styles or individual checks keep all files eligible. If the config has
  no sections or can't be read, every file is sent, as before.
- **The Vale on your `PATH` is used by default.** The managed copy is used when
  there is no Vale on `PATH`, or when `vale.valeCLI.installVale` is on (now
  described as "always use the managed copy"). **If you have no Vale at all,
  the extension now downloads one automatically** instead of failing. If you
  had both installed and relied on the managed copy without setting
  `installVale`, turn that setting on to keep using it.

- **Vale: Sync uses the language server when there is no Vale on `PATH`,**
  or when you turn on the new `vale.valeCLI.syncViaLanguageServer` setting. It
  then uses exactly the Vale and configuration the server lints with, but
  can't be cancelled and shows its result as a message instead of streaming
  output. With Vale on `PATH` Sync is unchanged.

## Performance
- Direct Vale commands (Sync, Show Configuration, version and metrics
  checks) now time out, are stopped if they print too much, and are
  stopped when VS Code closes. Running **Vale: Sync** twice at once is
  refused.

## UI changes
- **Language status entry** shows Vale as Starting, Ready, Error, or
  Configuration error; click it for diagnostics.
- **Removed the Vale panel from the Explorer sidebar.** Every command is
  still in the command palette (Cmd/Ctrl+Shift+P, type "Vale").
- New **Vale: Select Configuration File** and **Vale: Open Settings** commands. `vale.trace.server` moved to a new **Troubleshooting** settings page.
- **Vale: Show Configuration** now opens the configuration as JSON in an
  editor tab instead of the output panel.
- **Vale: Sync** and the Vale language server download show a cancellable
  progress notification. Success confirmations for Sync and Restart now
  appear briefly in the status bar instead of as pop-ups.
- Add to Accept List / Reject List moved into a **Vale** submenu in the editor
  context menu.
- Settings are grouped into Setup, Linting, Vocabulary and Advanced pages,
  with fuller descriptions. Setting names are unchanged, so nothing needs
  migrating. Empty text settings now default to `""` instead of `null`.

## Fixes
- **Vale: Install or Update Vale** now works. It was listed in the command
  palette but had no handler, so running it did nothing useful.

## Internal
- Removed an unused `.clientrc` file watcher left over from the language
  client template.

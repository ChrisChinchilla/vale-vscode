# Lazy start, config-driven selector, Vale source, and the single CLI runner

## Lazy start (`src/lifecycle.ts`)
A static `activationEvents` list cannot follow a setting, and the first
version of this work (workspaceContains + onLanguage events) therefore could
not honour a user-editable language list. So the manifest is back to
`onStartupFinished` and `lifecycle.ts` decides whether to start the server:
- a Vale config file exists (`findFiles(VALE_CONFIG_FILE_GLOB)`), or
- `vale.valeCLI.config` is set at user, workspace, or folder scope (including
  configs outside the workspace), or
- an open `file:` document's language is in `vale.startOnLanguages`
  (`shouldStartForLanguages`, `"*"` = always), or
- a command needs it (`vale.install` calls `ensureLanguageServerStarted`;
  Restart always starts).
Re-checked on open document, config-file creation, and a change to the
language or explicit-config setting. Once started it stays started. A failed
start is not retried on every document open (use Restart).

Trade-off: the extension host loads the bundle in every window again (cheap);
the saving is the Rust server and its Vale processes.
`summarizeLanguageStatus` now reports idle as "Not running" with
**information** severity, not a warning.

## Config-driven document selector (`startClient`)
`getValeConfig` runs `vale ls-config` before the client is created;
`buildDocumentSelectorPatterns` turns the union of `SBaseStyles` and `SChecks`
keys (section globs) and `Formats` keys into absolute patterns anchored at the
folder. It returns
"every file" (the old selector) when the config can't be read, has no
sections, has a `[*]` section, or has global styles or individual checks
(`GBaseStyles` / `GChecks`). That fallback is deliberate: vale-ls publishes config errors only when it lints a file, so an
unreadable config must still see files.

Known gaps: on first run with the managed Vale not yet downloaded,
`ls-config` fails and the first start uses "all files" until a restart.
Folder paths containing glob characters (`[`, `{`, `*`) would break the
patterns (same as before). The selector is only recomputed when the client
restarts (a config file change already does that).

## Which Vale runs (`resolveValeSource`, `config.ts`)
vale-ls prefers its managed copy if one exists, then `PATH`. To make "the
Vale you installed" the default the extension pins it:
1. `vale.valeCLI.path` -> that (custom).
2. else the Vale found on `PATH` -> pinned as `valeBinaryPath` (path).
3. else, or when `vale.valeCLI.installVale` is true -> unpinned with
   `installVale: true`, so vale-ls downloads and uses its managed copy.
The extension's own CLI calls (Sync, Show Configuration, version, metrics)
use the same binary; for the managed copy that is
`<install dir>/vale_bin/vale` (`managedValeExePath`).
Docker is unchanged and ignores all of this.

Behaviour changes: (a) a user with `installVale: false` who had both a managed
copy and a PATH Vale now gets the PATH one; (b) a user with no Vale at all now
gets a managed copy downloaded automatically instead of an error (previously
opt-in via `installVale`); (c) with a PATH Vale, **Vale: Install or Update**
reports it is skipping the install.

## Sync through the language server
`shouldSyncViaLanguageServer` (`utils.ts`) decides per folder:
- `vale.valeCLI.syncViaLanguageServer` on -> server (even with Docker).
- else Docker -> direct.
- else Vale source is the managed fallback (no Vale on PATH) and
  `installVale` is not set -> server.
- else direct (PATH Vale, custom path, or an explicitly chosen managed copy).
Server route: `syncViaLanguageServer(folder)` (`languageServer.ts`) sends
`cli.sync` to that one folder's client and waits for it; the server shows its
own result message. It is not cancellable (the server runs the sync
synchronously), has no timeout and does not stream output, and a second Sync
while one runs is refused with a message. Only Sync has a server command; Show
Configuration, version and metrics stay direct but use the same Vale binary.
Scope is the resolved folder in both routes (the server would sync every root
of the *client*, which is one folder).

## Single CLI runner (`src/cli.ts`)
`runValeProcess` is the only place the extension runs a direct Vale process
(Sync, Show Configuration, version, `ls-config`, `ls-metrics`). It:
- spawns with an argv array, never a shell (`buildValeSpawnOptions`);
- times out (120s; 15 min for `sync`, which downloads packages);
- stops a process that prints more than 8M characters to stdout;
- honours a cancellation token;
- tracks every process so `killActiveValeProcesses` (a `context.subscriptions`
  entry in `lifecycle.ts`) stops them on deactivation;
- `runValeCommand` (streaming) refuses an identical command in the same
  directory while one runs; `runValeCommandCapture` shares the in-flight result
  between identical calls instead.
`probeExecutable` (Docker preflight) keeps its own runner on purpose: it
never rejects and has its own timeout and result shape.

## Validation
`npm run validate` passes (compile, lint, 156 tests, production bundle).
Regression tests cover individual-check selectors, global-check fallback,
explicit configs at window/folder scope, and selecting a config while idle.

## Not verified
Not run in a real extension host. Check: a window with no Vale config and no
listed-language file stays idle; opening a markdown file starts it; Sync still
cancels; `ls-config` selector log line ("Document selector: ...") in the Vale
output; with Vale on PATH the log says `path: <that path>`; with
`installVale` on it says `managed`; with no Vale anywhere the first start
downloads one.

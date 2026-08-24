# Issue #54 investigation and Workspace Trust support

Investigation of https://github.com/ChrisChinchilla/vale-vscode/issues/54
("extension not working in a devcontainer, no error notification") and the
resulting fixes, including the previously-open `PROJECT_AUDIT.md` item
"Declare and enforce Workspace Trust behavior".

Reported 2024-11-27: the extension worked in Ubuntu under WSL2 but produced
no highlighting or useful error in an Ubuntu devcontainer, despite the
reporter checking the configured Vale CLI and config paths inside the
container.

## What's actually confirmed vs. still a theory

**Confirmed and fixed**: a real version mismatch. `LSP_TAG` was pinned to
`v0.4.0`, but `config.ts` already sent `valeBinaryPath` in
`initializationOptions` - and per the README, vale-ls only started honoring
`valeBinaryPath` in **v0.5.0**. So `vale.valeCLI.path` - the exact setting
the reporter says they "carefully configured" - was silently a no-op on the
shipped version, for everyone, regardless of trust state or devcontainer use.
Fixed by bumping to `v0.5.0` (checksums re-verified against
`gh api repos/vale-cli/vale-ls/releases/tags/v0.5.0`, which also confirmed
`errata-ai/vale-ls` has moved to `vale-cli/vale-ls`) and adding a
`.vale-ls-version` marker so existing `v0.4.0` installs get replaced rather
than staying silently pinned. See `.claude/notes/vale-ls-releases.md`.

There was also a first-install race in the original 2024 implementation - a
remote container has its own extension install, so it commonly exercised the
vale-ls download path even when the extension already worked under WSL, and
archive extraction wasn't awaited before `client.start()` tried to run the
binary. Already fixed by later download-hardening work (awaited, verified,
atomic install under `globalStorageUri`), unrelated to this investigation.

**Plausible but unconfirmed**: Workspace Trust. `package.json` declared no
`capabilities.untrustedWorkspaces` at all, and per VS Code's docs, an
extension that doesn't is disabled outright in Restricted Mode - no
activation, no error, no notification, which matches the symptom precisely.
Devcontainers are a common trigger, since trust doesn't always carry over
from the local folder into the container's remote workspace. But this
**hasn't been reproduced as the actual cause of #54** - there's no way to
drive a full interactive VS Code window from an agent session to confirm an
extension shows as disabled in a live Restricted Mode devcontainer, and a
normal **Reopen in Container** flow actually requires trust before opening
the container in the first place (some other flows can still land in
Restricted Mode). The version-mismatch fix above is the stronger match for
the specific report. Declaring Workspace Trust support is still the correct
thing to do per VS Code's extension guidelines regardless of whether it
turns out to be what caused #54.

## Scope decision: "limited" support

Per-user decision: `supported: "limited"`, not `true`. Linting/highlighting
(the extension's core value) keeps working in an untrusted workspace. But
two things stay gated on trust, since a workspace's `.vscode/settings.json`
is exactly the kind of untrusted input Workspace Trust exists to protect
against:

1. **Settings that choose which executable runs or trigger automatic work**:
   `vale.valeCLI.path`, `vale.valeCLI.config`, `vale.valeCLI.syncOnStartup`,
   and all of `vale.docker.*` are declared in `restrictedConfigurations`
   (package.json). VS Code handles the enforcement itself - while untrusted,
   `WorkspaceConfiguration#get()` transparently returns only the user-level
   value for these keys, ignoring any workspace-level override, with no code
   change needed on our side. `vale.docker.extraArgs` in particular can
   inject arbitrary `docker run` flags (e.g. extra volume mounts), so this
   isn't just about the binary path. `vale.valeCLI.syncOnStartup` is
   included because it triggers automatic package downloads on startup - a
   form of unattended network/remote activity a malicious workspace
   shouldn't get to flip on silently.

2. **Commands that explicitly spawn a process**: Sync, Show Configuration,
   Show Metrics, and the two vocabulary-add commands all end up calling
   `runValeCommand`/`addToVocabulary` (`cli.ts`/`vocabulary.ts`). These are
   guarded by `requireTrustedWorkspace()` in `commands.ts`, which shows a
   warning with a "Manage Workspace Trust" action and returns early rather
   than running. This is defense-in-depth on top of (1) - restricting the
   *settings* means running them can't be pointed at attacker-controlled
   values, but blocking the *actions* themselves in Restricted Mode is
   clearer UX than letting them run silently against an untrusted workspace.
   They're also hidden from the Command Palette and contextual menus
   (`isWorkspaceTrusted` in every relevant `when` clause, package.json).

The tree view (`ui.ts`'s `ValeCommandsProvider`) mirrors this: while
untrusted, `getChildren()` returns "Trust this workspace..." (bound to
`workbench.action.manageTrust`) plus **Restart Language Server** and **Show
Diagnostics** (troubleshooting stays available), instead of the
trust-gated commands. It refreshes via `vscode.workspace.onDidGrantWorkspaceTrust`,
and the provider (and its `EventEmitter`) is disposed via `vscode.Disposable`.

## How language-server settings update after trust is granted

`buildValeConfig`'s `initializationOptions` are only read once, at client
start (see the existing `registerConfigurationWatcher`, added for #35). Per
VS Code's Workspace Trust docs: *"When trust is granted, a configuration
change event will fire in addition to the Workspace Trust event... Your
extension then doesn't need to make any additional code changes to handle
the setting."* Every `restrictedConfigurations` key here
(`vale.valeCLI.path`/`config`/`syncOnStartup`, `vale.docker.*`) is already in
`registerConfigurationWatcher`'s `VALE_CONFIG_SETTINGS` list, so granting
trust already fires `onDidChangeConfiguration` and restarts the affected
client(s) with the now-visible workspace-level values - no separate
`onDidGrantWorkspaceTrust` listener needed. (An earlier draft of this work
added one; it was removed because it would have double-restarted every
client on trust grant, racing with `registerConfigurationWatcher`.) The
manual **Restart Language Server** command (`vale.restartLanguageServer`)
and **Show Diagnostics** exist for troubleshooting independent of this - not
because trust changes need a manual nudge.

## Other devcontainer-specific failure modes addressed

- The manifest now declares `"extensionKind": ["workspace"]` so the
  extension runs beside remote workspace files and executables, rather than
  relying on VS Code's inference.
- Interactive shell `PATH` and the remote extension host's `PATH` can
  differ - a path verified in an interactive container shell isn't
  guaranteed to be visible to the extension host, especially for Python
  user-bin or Snap install locations.
- Alpine/musl is detected before download (`isUnsupportedLinuxLibc` in
  `utils.ts`) and produces an actionable error; vale-ls currently publishes
  glibc Linux binaries only.
- Download and startup errors are now logged to the Vale output channel with
  detail, and **Show Diagnostics**/**Restart Language Server** stay
  registered even after initial activation fails, so a broken first install
  is recoverable without reloading the window.
- Activation itself now logs extension-host location, platform/arch, glibc
  version, and trust state to the output channel on every start - directly
  answering "I'm not getting notifications that anything is wrong."
- Docker mode inside a devcontainer needs Docker-in-Docker or a mounted host
  daemon socket - it's an optional execution mode, not a general fix for
  running Vale inside an already-open devcontainer.

## Verification

`.devcontainer/issue-54/` provides a glibc Ubuntu devcontainer with Vale
copied to `/opt/vale/bin/vale` (deliberately outside normal `PATH`, using
musl-linked binaries from `jdkato/vale` plus their runtime libs, to
reproduce "Vale installed somewhere non-standard") and an explicit
`vale.valeCLI.path`/`vale.valeCLI.config` fixture configuration
(`test/fixtures/devcontainer/`). This is for manual verification (**Reopen
in Container**) - it isn't driven by CI.

`npm run test:integration` (`test/integration/`, via `@vscode/test-electron`)
launches an isolated VS Code extension-development host against the same
fixture and asserts `extensionKind`/`restrictedConfigurations` are declared
correctly and that `vscode.workspace.isTrusted` matches expectations. It only
runs the trusted case: VS Code always trusts the extension-development host
window, so a real Restricted Mode run isn't reachable from an automated test
here (see the comment in `runTest.ts`). The untrusted case, and the fuller
manual matrix below, are left for a packaged-VSIX run in a normal window.

### Manual release matrix

1. Debian/Ubuntu devcontainer, fresh extension install, trusted workspace.
2. Vale located on normal `PATH`.
3. Vale outside extension-host `PATH`, selected by `vale.valeCLI.path`.
4. Explicit `vale.valeCLI.config` inside the workspace.
5. Restricted Mode, confirming linting still works and the executable
   settings are locked to their user-level value.
6. First-start download failure, confirming a visible, actionable error.
7. Alpine container, confirming either supported execution or a clear libc
   incompatibility message.

For each case, confirm vale-ls starts, the intended Vale binary is invoked,
and the fixture document (`test/fixtures/devcontainer/sample.md`) produces
its expected diagnostic.

## What's deliberately untouched

`vale.vocabPath` isn't in `restrictedConfigurations` - it's a resource-scoped
*destination* path for the (already trust-gated) vocabulary-add commands,
not something that changes what executes.

`vale.install`'s command contribution in `package.json` has no matching
`vscode.commands.registerCommand` anywhere in `src/` - it's a pre-existing
dead declaration, unrelated to this change, left alone to avoid scope creep.

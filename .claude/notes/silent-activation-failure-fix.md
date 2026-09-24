# Silent activation failure fix (issue #129)

## What broke

`activate()` (`src/lifecycle.ts`) only wrapped the `startLanguageServer()`
call in try/catch. Everything before it - creating the readability status
bar surfaces, the `detect-libc` calls added for the #123 fix, and the
`hasActiveClients()`/`stopAllClients()` bookkeeping - ran unguarded, and
`registerCommands()`/`registerCodeActions()` ran *after* all of it.

If any of that unguarded code throws, the `activate()` promise rejects with
nothing catching it. VS Code logs a rejected `activate()` to the separate
"Log (Extension Host)" output channel, not the extension's own "Vale"
channel, and doesn't reliably surface it as an error toast the way this
extension's own catch blocks are designed to. The practical effect: the
"Vale" output channel exists but stays completely empty (its first-ever
`appendLine` call was one of the unguarded lines), no `vale.*` command is
registered (VS Code reports "command 'vale.restartLanguageServer' not
found" etc.), and the language server never starts - with no popup the user
would recognize as an error. See
https://github.com/ChrisChinchilla/vale-vscode/issues/129.

We were not able to reproduce the exact throwing line against the
reporter's environment (Fedora 44, VS Code installed system-wide) - this
fix addresses the structural gap that would produce every symptom in the
report, not a confirmed single root cause. `detect-libc`'s `family()`/
`version()` (v2.1.2) don't obviously throw (every fs/child_process call
inside them is already try/caught), so if they are the actual trigger here,
something about this specific host/build makes them behave differently
than in the extension host environments already covered by CI and the
`glibc-detection-fix.md` fix.

## The fix

- `registerCommands()`/`registerCodeActions()` now run immediately after
  `createValeOutputChannel()`, before any of the startup diagnostics that
  can throw. Commands are guaranteed to be registered as long as those two
  calls themselves don't throw - a much smaller, easier-to-audit surface
  than "the whole startup diagnostics chain."
- The readability surfaces / libc diagnostics / active-client bookkeeping
  block is now wrapped in its own try/catch, following the same pattern
  `startLanguageServer()` already used: log `[diagnostics] Startup
  diagnostics failed: ...` to the output channel, show it, and surface a
  `vscode.window.showErrorMessage`. Activation continues to
  `startLanguageServer()` afterward rather than aborting, since a
  diagnostics failure shouldn't also prevent trying to start the server.

## Test plan, now and going forward

1. `test/integration/suite/index.ts` now activates the extension and
   asserts every command declared in `package.json`'s
   `contributes.commands` is present in `vscode.commands.getCommands(true)`
   afterward. This is a regression test for "commands never registered,"
   independent of whether the specific throw that caused it here can be
   reproduced in CI. It **would not** by itself have caught the original
   ordering bug unless something in this environment also throws before
   reaching `registerCommands()` - the ordering fix is the actual
   guarantee; this assertion is what would catch a *future* regression back
   to registering commands after diagnostics.
2. **What CI still can't reach**: reproducing the reporter's actual throw
   (if there is one beyond the ordering issue) needs their exact
   environment. If this regresses again for the same reporter or a similar
   report, ask for the "Log (Extension Host)" output channel content (not
   "Vale") and `Help: Toggle Developer Tools` console output - that is
   where a rejected `activate()` promise's stack trace actually surfaces
   today, which is itself part of what made this hard to diagnose from the
   original report.

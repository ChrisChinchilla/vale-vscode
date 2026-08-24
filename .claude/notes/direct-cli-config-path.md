# Direct CLI commands ignored `vale.valeCLI.config`

Fixes https://github.com/ChrisChinchilla/vale-vscode/issues/100.

## What was actually happening (confirmed, not just theorized)

The reporter's `.vale.ini` lived at `src/config/.vale.ini`, not the
workspace root, with `vale.valeCLI.config` set accordingly. Linting worked
(it goes through vale-ls, which *does* receive `configPath` via
`initializationOptions` - see `config.ts`'s `buildValeConfig`). **Vale: Sync**
failed on startup with `E100 [config pipeline failed] Runtime error / no
sources provided`, and the failure notification contained raw ANSI escape
codes.

Tracing the exact reported error text (`Vale sync exited with code ${code}:
${stderr}`) back through git history found it verbatim in the pre-refactor
`src/lsp.ts` (still what the reporter's v0.34.0 release ships): the
extension's `vale.sync` command spawned `vale sync` with **no `--config`
flag at all**, relying entirely on Vale's own ancestor-search config
discovery from the workspace root. That search only walks the current
directory and its *parents* - it can never find a config file that lives in
a *subdirectory*, which is exactly this reporter's layout. `showConfig`
(`ls-config`) and `showMetrics` (`ls-metrics`) had the identical gap, as did
`getStylesPathsFromVale` (used by the vocabulary add-to-accept/reject
commands).

Confirmed end to end against a real fixture matching the report
(`src/config/.vale.ini` with one `Packages` entry, workspace root with no
config of its own): `vale sync` with no `--config` from the workspace root
silently found and synced a completely unrelated pre-existing global
`~/.vale.ini` on this machine instead - not even an error, just the wrong
config succeeding silently. `vale --config src/config/.vale.ini sync`
correctly synced the intended one. Both are symptoms of the same bug; which
one a given user hits just depends on whether *something* discoverable via
ancestor search happens to exist on their machine.

The **ANSI codes in the notification** half of the report is specific to
that same pre-refactor code (`${stderr}` interpolated directly into the
`Error` message shown via `vscode.window.showErrorMessage`) and is already
gone on `main` - the current `runValeCommand` (`cli.ts`) only ever throws
`vale ${args[0]} exited with code ${code}`, with the actual command output
going to the Vale output channel instead, never a modal notification.

`do_sync()`, vale-ls's own *internal* `syncOnStartup` sync (a separate,
uninvolved code path from this bug), is worth flagging separately: its
`sync()` in `vale.rs` discards the subprocess's exit code and output
entirely (`let _ = cmd.args(args).output()?;`, with a comment noting `status`
crashes the server) - so if vale-ls's own internal sync fails, it fails
completely silently, no notification at all. That's a real gap, but it's
upstream in `vale-cli/vale-ls`, not something fixable here.

## The fix

`buildValeConfigArgs(configPath: string): string[]` (`utils.ts`, pure,
tested) returns `["--config", configPath]` when a config path is set, or
`[]` otherwise. `resolveCommandConfigPath` (`commands.ts`) resolves
`vale.valeCLI.config` the same way `buildValeConfig` already does for
vale-ls's `initializationOptions` (`resolveConfigPath` in `utils.ts`), so
both paths agree. Every direct CLI invocation now prepends
`buildValeConfigArgs(configPath)` to its args: **Vale: Sync**, **Vale: Show
Configuration**, **Vale: Show Readability Metrics**
(`runValeCommand` calls in `commands.ts`), and `getStylesPathsFromVale`
(`cli.ts`, used by the vocabulary commands via `vocabulary.ts`'s
`addToVocabulary`, which now takes an optional `configPath` parameter).

Ordering matches vale-ls's own convention (`--config` before the
subcommand) rather than after it - both work with the current Vale CLI, but
matching vale-ls avoids relying on flag-position leniency that isn't
guaranteed.

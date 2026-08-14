# Multiple quick fixes for substitution rules with several alternatives

`src/codeActions.ts` registers a client-side `CodeActionProvider`
(`ValeSubstitutionCodeActionProvider`) that builds one "Replace with '...'"
quick fix per alternative in a `substitution` rule's `swap` list (e.g.
`whatif: what if|options|more`), instead of relying on vale-ls's own
`fix`-RPC-based quick fixes for `replace`-action diagnostics. Fixes
https://github.com/ChrisChinchilla/vale-vscode/issues/7.

## Why not just fix it in vale-ls

vale-ls builds its quick fixes by re-invoking a `fix` subcommand on a
managed fork of Vale (`vale-cli/vale`, not `errata-ai/vale` - see its
`ValeManager::fix` in `src/vale.rs`) for every diagnostic. That round trip is
what was collapsing multi-alternative `swap` lists into duplicate/incomplete
suggestions. That logic lives outside this repo, in `vale-ls` and the
`vale-cli/vale` fork it downloads - not something fixable here.

## Why the client-side provider works without that round trip

Vale's own JSON alert output already includes every alternative: running
`vale --output=JSON` on a match against `swap: whatif: what if|options|more`
produces `"Action": {"Name": "replace", "Params": ["what if", "options",
"more"]}` directly - no extra `fix` call needed. vale-ls's
`utils::alert_to_diagnostic` (upstream `src/utils.rs`) sets each LSP
diagnostic's `data` field to the full serialized alert, `source` to
`"vale-ls"`.

`vscode-languageclient` carries that `data` through to the extension at
runtime via its `ProtocolDiagnostic` class (`lib/common/protocolDiagnostic.js`),
which extends `vscode.Diagnostic` with a `data` property - even though `data`
isn't part of the public `@types/vscode` `Diagnostic` type (as of
`@types/vscode` ^1.109.0 used here). `codeActions.ts` reads it via a light
cast (`alertDataOf`) rather than depending on any typed API for it.

## Scope decision

Per-user decision (2026-08-13): the provider always takes over `replace`-action
quick fixes, including the single-alternative case, rather than only
supplementing multi-alternative rules.

The first implementation left vale-ls's own `fix`-RPC-based quick fixes for
`replace` actions in place alongside ours, on the assumption they'd merge
into at most one harmless duplicate per diagnostic. Live testing showed the
server's own duplication bug is worse than that assumption: for a two-option
swap (`chair(?:...): chair(s)|stool`), the server alone contributed multiple
copies of the first option, so the merged lightbulb menu showed four entries
("chair(s)" x3, "stool" x1) instead of the expected two. Letting both
providers run unfiltered doesn't just risk one duplicate - it surfaces the
server's own bug at full strength.

Fixed by filtering the server's `replace`-action code actions out entirely,
via a `provideCodeActions` middleware hook on `LanguageClientOptions` in
`startClientForFolder` (`languageServer.ts`). The middleware calls `next()`
to get the server's raw results, then drops any `CodeAction` whose first
associated diagnostic is a `vale-ls`-sourced `replace` alert
(`isServerReplaceFix` in `codeActions.ts`, reusing the same `data.Action`
inspection `alertDataOf` does for diagnostics). `ValeSubstitutionCodeActionProvider`
is then the sole source of `replace` quick fixes; the server's own results
are only filtered for the same document/range the middleware runs on, so
this doesn't touch anything else the server would have offered (vocab-add
actions, `remove`-action fixes, etc).

This provider intentionally does nothing for `remove`-action diagnostics
(e.g. `existence`/`repetition` rules with `action: {name: remove}`) - vale-ls's
own `fix`-based quick fix already handles those correctly and there's no
multi-alternative case to worry about there, so the middleware leaves those
untouched.

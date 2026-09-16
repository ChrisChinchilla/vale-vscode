# Implementing the three former no-op settings

`vale.maxNumberOfProblems`, `vale.doNotShowWarningForFileToBeSavedBeforeLinting`,
and `vale.readabilityProblemLocation` were exposed in `package.json` but had
zero `src/` references (confirmed by grep before starting). Owner's call
(asked explicitly) was to implement them rather than remove them.

## `vale ls-metrics` JSON schema

Not documented with an example anywhere in vale.sh's docs at the time of
writing. Empirically confirmed against a local Vale 3.21.0 install:

```json
{
  "characters": 110,
  "complex_words": 2,
  "heading_h1": 1,
  "long_words": 5,
  "paragraphs": 1,
  "polysyllabic_words": 3,
  "sentences": 4,
  "syllables": 36,
  "words": 26
}
```

Returns `{}` (no `words`/`sentences`/etc. keys at all) for a file vale-ls
treats as empty/skippable - `getFileMetrics` (`src/cli.ts`) types every field
as optional (`ValeFileMetrics`), and `computeFleschKincaidGrade`
(`src/utils.ts`) returns `null` rather than dividing by an absent count.

`ls-metrics` reports raw counts only (words/sentences/syllables/...), **not**
a readability score - that's a separate `readability`/`metric` Vale *check*
type (a style rule with a `formula`/`condition`, evaluated during linting,
not exposed via `ls-metrics`). Rather than requiring a user to have such a
style configured (which the original README wording implied - "if you have
any Readability or metric styles"), the extension computes Flesch-Kincaid
itself client-side from the raw counts, unconditionally. This is a
deliberate scope reduction: detecting whether a workspace's active styles
extend `readability`/`metric` would mean parsing `ls-config`'s `SChecks`
per-glob and following `extends:` chains through style files, which wasn't
worth it for a status bar number. If a different formula (Gunning-Fog, SMOG,
etc.) or genuine per-style detection is wanted later, `computeFleschKincaidGrade`
is the one place to change/extend.

## On-demand, not automatic

`vale.readabilityProblemLocation` reads as if readability is continuously
tracked like linting. It isn't: the grade is only computed when **Vale: Show
Readability Metrics** runs (`showMetricsCommand` in `src/commands.ts`), same
as before this change - re-running the command is what refreshes the status
bar item / Problems-view diagnostic (`showReadabilityResult`, `src/ui.ts`).
Switching the active editor hides the status bar item (`clearReadabilityResult`
wired in `src/lifecycle.ts`'s `onDidChangeActiveTextEditor`) since a grade
computed for a different file is actively misleading, but doesn't
auto-recompute for the newly active file - that would mean running the
Vale CLI on every editor switch, which felt like the wrong default given
every other CLI-backed command in this extension is already explicit/manual
(Sync, Show Configuration). Worth revisiting if users want it automatic.

## Why the save-warning only guards Show Readability Metrics

Every direct CLI command (`src/cli.ts`) reads from disk, not the VS Code
buffer - `vale.valeCLI.syncOnStartup`/Sync and Show Configuration aren't
document-specific, so "save before linting" doesn't really apply to them.
Show Readability Metrics is the one that silently produces stale/wrong
numbers for a dirty document, so `confirmSavedBeforeLinting` (`src/commands.ts`)
is scoped to just that command. vale-ls itself (the actual linter, showing
diagnostics in the Problems view as you type/save) is unaffected either way -
it's an LSP server that receives buffer content directly via
`textDocument/didChange`, not a disk read, so no unsaved-file warning
applies there at all.

## `vale.maxNumberOfProblems` via client middleware

Applied through `LanguageClientOptions.middleware.handleDiagnostics` in
`src/languageServer.ts` (`capDiagnostics`, `src/utils.ts`) rather than
passing it to vale-ls, since vale-ls has no such option - it always reports
every diagnostic it finds. This caps what VS Code *displays*; the file is
still linted in full server-side. `0` or unset means unlimited (mirrors how
`vale.docker.extraArgs`/`vale.valeCLI.filter` treat an empty/absent value).

## Also found but out of scope

`vale.valeCLI.lintOnChange`, `vale.valeCLI.debounceMs`, and
`vale.valeCLI.showMetrics` (a *different* setting from the `vale.showMetrics`
*command* - a boolean meant to show a CodeLens) are also no-ops (zero `src/`
references), discovered incidentally while grepping for the three settings
above. Not part of the audited list this work was scoped to - flagged in
`PROJECT_AUDIT.md` for whoever picks it up next.

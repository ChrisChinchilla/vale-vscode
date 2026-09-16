# Vocabulary path fix and input validation

## The `stylesPaths[0]` bug was dead code, not a live one

`getStylesPathsFromVale` (`src/cli.ts`) has returned a single resolved
`string | null` since it was split out of the original `lsp.ts` - `Paths[1]`
from `vale ls-config`, not an array of candidates. `vocabulary.ts`'s
`findVocabStylesPath`, however, still treated its `stylesPaths` parameter as
if it might be an array (a stale artifact of an earlier design, per its
commented-out `for (const stylesPath of stylesPaths)` loop), and its
fallback `return stylesPaths[0]` therefore returned the first *character* of
the path string, not "the first path."

In practice this fallback never fired with meaningfully different behavior:
both branches of the function returned exactly the same value (`stylesPaths`
itself) once accounting for the intended fix, since there's only ever one
candidate path now. The function was a no-op wrapped around a
latent bug - removed rather than fixed in place, and `addToVocabulary` now
uses the path `getStylesPathsFromVale` returns directly.

## Traversal check needs two layers

Rejecting any `/`/`\\` in `vale.vocabPath` blocks the obvious
`../../etc/passwd`-style traversal, but not a bare `..` (two dots, no
separator) as a single path segment - `path.join(stylesPath, "config",
"vocabularies", "..")` legally resolves to `stylesPath/config`, outside the
vocabularies directory, without ever containing a slash. `addToVocabulary`
(`src/vocabulary.ts`) therefore layers a second check:
`path.relative(vocabulariesRoot, vocabDir)` must not start with `..` or be
absolute. Both checks are needed; neither alone is sufficient.

`vale.vocabPath` comes from settings (not typed fresh per invocation), which
matters because a workspace's `.vscode/settings.json` can set it - i.e. this
is reachable from an untrusted/malicious workspace's config, not just a
typo, which is why it's validated rather than merely trusted.

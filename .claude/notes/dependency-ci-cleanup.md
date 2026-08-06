# Dependency and CI cleanup

Covers the "Dependency and CI proposal" section of `PROJECT_AUDIT.md`.

## `@aws-sdk/client-s3` is a build-time-only phantom dependency

Removing it (it's never imported by this extension's own code) broke the
production Webpack build:

```
Module not found: Error: Can't resolve '@aws-sdk/client-s3' in
'.../node_modules/unzipper/lib/Open'
```

Cause: `unzipper`'s `lib/Open/index.js` has a lazy `require("@aws-sdk/client-s3")`
inside its `s3_v3` function (S3-source support), which this extension never
calls — we only ever do `unzipper.Open.buffer(buffer)` (see
`downloadLSP` in `src/languageServer.ts`). `unzipper` doesn't declare
`@aws-sdk/client-s3` as a dependency at all (it's an implicit "install this
yourself if you need S3 support" expectation), but Webpack statically
resolves every `require()` it sees regardless of whether the containing
function is ever called, so the build fails without it physically present.

Fix: mark it `external` in `webpack.config.js` instead of reinstalling it.
This tells Webpack to emit a runtime `require("@aws-sdk/client-s3")` without
resolving/bundling it at build time — safe, since that code path never
executes. Bonus: this is also what fixed a large chunk of accidental bloat —
before this fix, whenever the package happened to be present (e.g. before
this cleanup), Webpack would bundle the *entire* AWS SDK (dozens of vendor
chunk files, several hundred KB) into `dist/` even though nothing in the
extension ever uses it. `dist/` went from ~984 KB across 10+ files to a
single 603 KB `extension.js` with the externals fix in place.

If `unzipper` is ever upgraded and starts requiring `@aws-sdk/client-s3`
unconditionally (not just inside the unused S3 path), this externals entry
would need to be revisited — the build would then need the real package.

## `vscode-test` was removed, not swapped for `@vscode/test-electron`

The audit suggested replacing it with the modern equivalent, but a check
turned up that `vscode-test` isn't referenced anywhere in scripts or source —
there's no extension-host integration test suite today (`npm test` only runs
Node's test runner over `src/utils.ts`-style pure modules). Removed it as
dead weight rather than adding `@vscode/test-electron` as a second unused
dependency. If an integration-test suite gets written later, add
`@vscode/test-electron` then, alongside the actual tests.

## `.vscodeignore` was letting real bloat/risk into published VSIXes

Discovered while verifying `npm run package` works with the newly-pinned
`@vscode/vsce` devDependency (replacing the CI global install). The existing
`.vscodeignore` excluded `src/**` and a few other things but not `out/`,
`out-test/`, `.claude/`, `.github/`, or — most importantly — a stray local
`vale-ls` binary that happened to be sitting in the repo root (gitignored,
so `git status` looked clean, but `.gitignore` has no bearing on what `vsce
package` includes). A local `vale-ls` binary present at packaging time would
have shipped in the VSIX unnoticed. Fixed `.vscodeignore` to exclude all of
these plus the now-dead `tslint.json` (removed outright, since the `tslint`
package itself was removed). Packaged VSIX went from 3.92 MB/39 files to
150 KB/8 files.

## Publish pipeline now requires validation

`build.yaml` gained `workflow_call:` as an additional trigger and now runs
compile → lint → test → webpack → package (previously: compile then package
directly, with `typescript`/`@vscode/vsce` installed globally instead of via
`npm ci`). `publishTags.yml` calls it as a `validate` job that the `deploy`
job `needs`, so a tag push can no longer reach the marketplace publish steps
(which hold `OPEN_VSX_TOKEN`/`VS_MARKETPLACE_TOKEN`) if compile, lint, tests,
or the production build fail.

## Deferred by explicit choice

- Replacing Webpack/ts-loader with esbuild — audited as "consider," not a
  firm requirement; skipped since the build is fast and clean after the
  `@aws-sdk/client-s3` fix. Revisit if build time or bundle size becomes a
  real pain point.
- Pinning GitHub Actions to full commit SHAs (a *different*, still-open
  audit item under "Security") — not touched here; only the CodeQL
  v2→v3/checkout v3→v4 version bumps were in scope for this pass.

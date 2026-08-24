# Vale VS Code Project Audit

## Highest-priority findings

### Security

- [x] **High: eliminate command injection.** `spawn(..., { shell: true })` receives the active file path for `ls-metrics`. A crafted filename containing shell metacharacters could execute commands when the user requests metrics. See [`src/lsp.ts:315`](src/lsp.ts#L315) and [`src/lsp.ts:611`](src/lsp.ts#L611). Node now deprecates passing argument arrays with `shell: true`; the safe fix is direct spawning with no shell. [Node child-process documentation](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)

- [x] **High: harden the `vale-ls` download.** `vale-ls` is downloaded and executed without checking the HTTP status, archive size, or checksum. The complete archive is extracted into the extension installation directory. See [`src/lsp.ts:93`](src/lsp.ts#L93). Store it under `globalStorageUri`, verify an embedded SHA-256 digest, extract only the expected executable, and install atomically. VS Code explicitly provides `globalStorageUri` for writable extension state. [VS Code storage guidance](https://code.visualstudio.com/api/extension-capabilities/common-capabilities)

- [x] **High: remove the runtime dependency advisory.** `npm audit --omit=dev` reports a runtime `brace-expansion` denial-of-service advisory through `vscode-languageclient@9`. Upgrading to `vscode-languageclient@10.1.0` replaces the affected dependency chain. [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp), [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)

- [ ] **Resolve remaining dependency findings.** Full `npm audit` reports 10 findings: 3 high, 3 moderate, and 4 low. Most additional findings are build/test-only dependencies, especially TSLint, the obsolete `vscode-test`, Mocha, and Webpack’s minifier chain.

- [x] **Declare and enforce Workspace Trust behavior.** This addresses one possible silent-failure mode related to [issue #54](https://github.com/ChrisChinchilla/vale-vscode/issues/54), but is not established as that devcontainer issue's root cause. `package.json` now declares `capabilities.untrustedWorkspaces: { supported: "limited", restrictedConfigurations: [...] }` covering `vale.valeCLI.path`/`config`/`syncOnStartup` and `vale.docker.*`; the Sync/Show Configuration/Show Metrics/vocabulary-add commands are guarded with `requireTrustedWorkspace()` (`src/commands.ts`) and hidden from menus/the tree view when untrusted (`src/ui.ts`). When trust is granted, VS Code emits the configuration-change event that restarts affected clients with the newly available workspace settings. See `.claude/notes/workspace-trust.md` and `.claude/notes/devcontainer-issue-54.md`.

- [ ] **Harden GitHub Actions.** GitHub Actions use mutable tags, including third-party publishing actions that receive marketplace secrets. Pin every action to a full commit SHA and add least-privilege permissions. GitHub identifies full SHAs as the only immutable way to reference actions. [GitHub Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use)

### Functional defects

- [x] **Restore the intended vale-ls v0.5.0 upgrade.** Restored `LSP_TAG` and all six official release-API SHA-256 digests to v0.5.0, where `valeBinaryPath` is supported. The installer records `.vale-ls-version` and replaces missing, unversioned, or older installs, fixing the merge regression that could make both `vale.valeCLI.path` and Docker mode ineffective. See `.claude/notes/devcontainer-issue-54.md`.

- [ ] **Complete the packaged-VSIX devcontainer release test for issue #54.** Added `.devcontainer/issue-54`, with glibc Ubuntu, Vale outside normal `PATH`, an explicit config, and a known diagnostic fixture. Added a CI extension-host smoke test for workspace placement and trust-sensitive manifest declarations. VS Code automatically trusts extension-development windows, so an actual Restricted Mode runtime pass and end-to-end remote diagnostic assertion still require installing the packaged VSIX in a normal devcontainer window; retain this as a release check until that can be automated without weakening the test.

- [x] **Handle unsupported Linux libc explicitly.** Alpine/musl is detected before download and receives an actionable glibc-only error. Pure unit coverage verifies Linux glibc, Linux without glibc, and non-Linux behavior.

- [x] **Make remote startup diagnosable.** The Vale output channel logs extension-host location, platform/libc, trust, workspace/config paths, selected Vale execution mode/path, vale-ls version/path, installation failures, and client startup errors. **Vale: Show Diagnostics** and **Vale: Restart Language Server** remain available even when initial server installation/activation fails.

- [x] **Declare remote placement.** Added `"extensionKind": ["workspace"]`; the extension-host smoke test asserts the manifest so VS Code installs/runs Vale beside remote workspace files and executables. The packaged-VSIX devcontainer runtime check remains part of the open release-test item above.

- [x] **Fix Windows startup.** The code discovers `vale-ls.exe`, then constructs server options using `vale-ls` without `.exe`. See [`src/lsp.ts:353`](src/lsp.ts#L353). Fixed as a side effect of the vale-ls download hardening work: `filePath` is now built once via `getExecutableName(process.platform)` (src/utils.ts) and reused for both the existence check and the language client's `serverOptions`.

- [ ] **Fix executable paths containing spaces.** Paths are incorrectly escaped even though no shell is used for the language server. Only the first space is escaped, producing a nonexistent executable path. See [`src/lsp.ts:372`](src/lsp.ts#L372).

- [ ] **Apply the custom filter setting.** The `vale.valeCLI.filter` setting is exposed but never read. Only the legacy alert-level and spelling filters are applied. See [`package.json:100`](package.json#L100) and [`src/lsp.ts:381`](src/lsp.ts#L381).

- [x] **Prevent duplicate startup synchronization.** Enabling `syncOnStartup` runs synchronization twice: once inside `vale-ls` and again in the extension after the server starts. The official server documents this as an initialization option. [Vale LSP configuration](https://vale.sh/docs/guides/lsp)

- [ ] **Fix vocabulary path selection.** `getStylesPathsFromVale` returns a string, but the fallback uses `stylesPaths[0]`, which is the first character—usually `/`. It can consequently try to write beneath `/config/vocabularies`. See [`src/lsp.ts:150`](src/lsp.ts#L150) and [`src/lsp.ts:201`](src/lsp.ts#L201).

- [ ] **Validate vocabulary input.** Vocabulary names accept traversal components such as `../../…`, and multiline selections can corrupt vocabulary files.

- [x] **Apply settings changes.** Settings are read once during activation. Changing configuration does not update or restart the language server. Upstream `vale-ls` acknowledges configuration events but does not apply them, so the extension must restart it. Fixed via `registerConfigurationWatcher` in [`src/languageServer.ts`](src/languageServer.ts), which restarts the affected folder's (or no-folder) client when a setting feeding `buildValeConfig` changes.

- [x] **Support multi-root workspaces correctly.** Multi-root operations always use the first workspace folder, regardless of the active file. Upstream multi-root change handling is also currently a no-op. Fixed by running one `LanguageClient` per workspace folder (vale-ls has no native multi-root support), with commands resolving the folder from the active editor and `onDidChangeWorkspaceFolders` starting/stopping clients as folders change. See `.claude/notes/multi-root-workspaces.md`.

- [x] **Support using Vale via Docker.** [Issue #72](https://github.com/ChrisChinchilla/vale-vscode/issues/72): no way to run `vale` from a container instead of a local install. Fixed with `vale.docker.enabled`/`image`/`extraArgs`: a generated per-folder wrapper script points vale-ls's `valeBinaryPath` at `docker run ...`, and the extension's own direct CLI calls (`Sync`/`Show Configuration`/`Show Readability Metrics`, vocabulary lookups) spawn `docker` directly. This also fixed the previously-dead `vale.valeCLI.path` setting along the way: `buildValeConfig` never actually sent `valeBinaryPath` to vale-ls, and the setting was missing from the config-change watch list. See `.claude/notes/docker-support.md`.

- [ ] **Remove or implement no-op settings.** Three settings appear to do nothing in either this extension or current upstream `vale-ls`:

  - `vale.maxNumberOfProblems`
  - `vale.doNotShowWarningForFileToBeSavedBeforeLinting`
  - `vale.readabilityProblemLocation`

## UI and layout proposal

The current settings appear lexicographically because they have no explicit ordering. VS Code supports categories and explicit setting order. [Configuration contribution guidance](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)

### Proposed settings layout

1. **Setup**
   - Configuration file
   - Install/manage Vale
   - Sync packages on startup

2. **Linting**
   - Minimum alert level
   - Custom filter
   - Spell checking
   - Maximum diagnostics

3. **Vocabulary**
   - Vocabulary name
   - Validation and current resolved location

4. **Advanced**
   - Server tracing
   - Download/update channel
   - Troubleshooting options

### Additional UI improvements

- [ ] Replace `null` string defaults with valid empty-string defaults.
- [ ] Add explicit order, concise Markdown descriptions, links, integer bounds, and readable enum labels.
- [ ] Add native commands for **Select Configuration File** and **Open Vale Settings**. **Restart Language Server** is now implemented.
- [ ] Deprecate or implement the three no-op settings instead of silently presenting them.
- [ ] Remove the Explorer tree containing three command buttons. VS Code’s UX guidance explicitly discourages using tree items as command buttons. Keep the commands in the Command Palette and expose only contextual actions where useful. [VS Code View guidelines](https://code.visualstudio.com/api/ux-guidelines/views)
- [ ] Add one `LanguageStatusItem` showing Starting, Ready, or Configuration Error for relevant documents. VS Code identifies this as the preferred surface for active linter/configuration status. [VS Code API](https://code.visualstudio.com/api/references/vscode-api#LanguageStatusItem)
- [ ] Put vocabulary actions beneath a single **Vale** editor-context submenu.
- [ ] Use cancellable progress for downloads and sync; reserve notifications for actionable failure states.
- [ ] Format configuration as JSON in an editor document rather than raw output-channel text.
- [x] Hide trust-gated commands from the Command Palette with `menus.commandPalette` `when` clauses as well as guarding their handlers.
- [x] Make `ValeCommandsProvider` disposable and dispose its `EventEmitter` with the extension context.
- [x] Compare the Workspace Trust warning result to the exact `"Manage Workspace Trust"` action rather than treating every future truthy action as approval.

## Efficiency and code structure

- [x] Split the 653-line [`src/lsp.ts`](src/lsp.ts) into lifecycle, configuration, language-server management, CLI execution, vocabulary, commands, and UI modules. `src/lsp.ts` is now a thin re-export; see `src/lifecycle.ts`, `src/config.ts`, `src/languageServer.ts`, `src/cli.ts`, `src/vocabulary.ts`, `src/commands.ts`, `src/ui.ts`, and `src/workspaceFolders.ts`.
- [ ] Remove duplicated accept/reject handlers and centralize error formatting and workspace resolution.
- [ ] Start the language server lazily when a relevant document or Vale command is used instead of on every `onStartupFinished`.
- [ ] Restrict the current `language: "*"` document selector. It presently sends every local file’s full content to the server on edits.
- [ ] Implement the diagnostic limit through client middleware so the exposed setting actually works.
- [ ] Use a single safe CLI runner with no shell, bounded output, timeout, cancellation, process disposal, and concurrency control.
- [ ] Route sync through the language server so it uses the same managed Vale installation and configuration.
- [x] Cache the verified language server by version in global storage. `.vale-ls-version` is checked against `LSP_TAG`; mismatched and legacy unversioned installs are replaced with the checksum-verified current binary.
- [ ] Resolve commands relative to the active document’s workspace folder, prompting only when the choice is ambiguous.
- [ ] Raise the TypeScript target from ES2017 to a modern Node target and remove unnecessary casts and boxed `String` types.

## Dependency and CI proposal

- [ ] Add a packaged-VSIX untrusted extension-host integration run. A trusted extension-development host run is now in CI and verifies remote placement plus every restricted configuration; VS Code forces extension-development windows trusted, so the actual untrusted runtime path remains in the manual devcontainer release matrix.

- [x] Upgrade `vscode-languageclient` from 9.0.1 to 10.1.0. Already done (landed as part of an earlier "remove the runtime dependency advisory" fix); this item was stale.
- [x] Replace `vscode-test` with `@vscode/test-electron@3.1.0`. Investigated: `vscode-test` was unused anywhere in scripts or source (no integration test suite exists), so it was removed outright rather than swapped — nothing currently exercises it, and adding `@vscode/test-electron` with no test suite to run would just be a second unused dependency. Revisit if/when an actual extension-host integration test suite is added.
- [x] Remove unused `@aws-sdk/client-s3`, `@types/which`, TSLint, and likely Mocha. Removed `@aws-sdk/client-s3`, `@types/which`, `tslint` (and its orphaned `tslint.json`), `mocha`, `@types/mocha`. `@aws-sdk/client-s3` turned out to be needed at *build* time (not runtime): `unzipper`'s `Open/index.js` has a lazy `require("@aws-sdk/client-s3")` in its unused S3 code path, which webpack tries to statically resolve. Fixed by marking it `external` in `webpack.config.js` instead of reinstalling it — this also dropped several dozen unused AWS SDK chunk files that were previously being bundled into every release (`dist/` went from ~984 KB/many files to a single 603 KB `extension.js`).
- [x] Add a real ESLint flat configuration; ESLint currently exits because none exists. Added `eslint.config.mjs` using `@typescript-eslint`'s `flat/recommended` config, plus an `npm run lint` script. Fixed the 7 findings it surfaced (an `any`-typed catch, unused `prefer-const`s, an unused `catch` binding, a `require()` in `webpack.config.js` — the last one is intentionally allowed via a targeted override since that file is genuinely CommonJS).
- [x] Update Webpack, TypeScript ESLint, ESLint, and related tooling after removing unused packages. `npm install` picked up the latest versions already satisfying existing `^` ranges (webpack, ts-loader, eslint, `@typescript-eslint/*`); `webpack-cli` needed an explicit major bump (`^6.0.1` → `^7.2.2`) since 7.x requires it.
- [x] Prefer Node's built-in test runner for pure unit tests. Already the case (`npm test` runs `node --test` over `tsc -p tsconfig.test.json` output) — no action needed.
- [ ] Consider replacing Webpack/ts-loader with a smaller esbuild setup. Explicitly deferred (owner's call) — this was hedged as "consider," not a firm requirement, and the current Webpack build now runs cleanly (~2.7s, single 603 KB file, no warnings) after the `@aws-sdk/client-s3` externals fix above.
- [x] Add `@vscode/vsce` as a pinned development dependency instead of globally installing its latest version in CI. Added as a devDependency; `build.yaml` no longer does `npm install -g typescript @vscode/vsce` (both were already/now available via `npm ci`). Added `npm run package` (`vsce package`) as the canonical local/CI packaging command.
- [x] Upgrade CodeQL actions from retired `v2` to `v3` in [`.github/workflows/codeql.yml:29`](.github/workflows/codeql.yml#L29). CodeQL v2 has been retired since January 2025. [GitHub announcement](https://github.blog/changelog/2025-01-10-code-scanning-codeql-action-v2-is-now-deprecated/) Also bumped `actions/checkout` from `v3` to `v4` in the same file for consistency with the other workflows.
- [x] Consolidate build, test, package, and publish so publishing cannot bypass validation. `build.yaml` is now a reusable workflow (`workflow_call`) running compile → lint → test → webpack → package; `publishTags.yml` calls it as a `validate` job that `deploy` `needs`, so a tag push can no longer reach the marketplace publish steps if any of those fail. While verifying `vsce package` output, found `.vscodeignore` didn't exclude `out/`, `out-test/`, `.claude/`, `.github/`, or a stray local `vale-ls` binary — any of those (including a large accidentally-present binary) could have shipped in a release VSIX. Fixed; packaged VSIX dropped from 3.92 MB/39 files to 150 KB/8 files.

## Current validation state

- TypeScript `--noEmit`: passes.
- Production Webpack build: passes cleanly, no warnings (`npm run webpack`).
- Lint: `npm run lint` (ESLint flat config) passes with no findings.
- Tests: `npm test` runs `src/utils.test.ts` (pure, `vscode`-free helpers) via `tsc -p tsconfig.test.json` + Node's built-in test runner (27 tests). No module importing `vscode` at load time has direct test coverage — that needs the extension host (or a mock) to test directly; see `src/*.ts` module split in `.claude/notes/module-split.md` for where such logic could be extracted from if this becomes worth doing.
- Packaging: `npm run package` (`vsce package`, using the pinned `@vscode/vsce` devDependency) produces a clean VSIX (~150 KB, 8 files) via `.vscodeignore`.
- `npm run validate` runs compile + lint + test + webpack in one shot, matching CI's `build.yaml`.
- Working tree before creating this report: clean.

## Recommended implementation order

1. Security and correctness blockers.
2. Settings and UI restructuring.
3. Architectural and runtime-efficiency refactor.
4. Dependency/toolchain/CI modernization, tests, documentation, and cross-platform packaging validation.

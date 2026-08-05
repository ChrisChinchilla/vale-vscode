# Vale VS Code Project Audit

## Highest-priority findings

### Security

- [x] **High: eliminate command injection.** `spawn(..., { shell: true })` receives the active file path for `ls-metrics`. A crafted filename containing shell metacharacters could execute commands when the user requests metrics. See [`src/lsp.ts:315`](src/lsp.ts#L315) and [`src/lsp.ts:611`](src/lsp.ts#L611). Node now deprecates passing argument arrays with `shell: true`; the safe fix is direct spawning with no shell. [Node child-process documentation](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)

- [x] **High: harden the `vale-ls` download.** `vale-ls` is downloaded and executed without checking the HTTP status, archive size, or checksum. The complete archive is extracted into the extension installation directory. See [`src/lsp.ts:93`](src/lsp.ts#L93). Store it under `globalStorageUri`, verify an embedded SHA-256 digest, extract only the expected executable, and install atomically. VS Code explicitly provides `globalStorageUri` for writable extension state. [VS Code storage guidance](https://code.visualstudio.com/api/extension-capabilities/common-capabilities)

- [x] **High: remove the runtime dependency advisory.** `npm audit --omit=dev` reports a runtime `brace-expansion` denial-of-service advisory through `vscode-languageclient@9`. Upgrading to `vscode-languageclient@10.1.0` replaces the affected dependency chain. [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp), [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)

- [ ] **Resolve remaining dependency findings.** Full `npm audit` reports 10 findings: 3 high, 3 moderate, and 4 low. Most additional findings are build/test-only dependencies, especially TSLint, the obsolete `vscode-test`, Mocha, and Webpack’s minifier chain.

- [ ] **Declare and enforce Workspace Trust behavior.** VS Code currently disables undeclared extensions by default in Restricted Mode, but this should be deliberate and enforced inside commands too. Add `capabilities.untrustedWorkspaces`, restrict executable-related settings, hide unsafe commands when untrusted, and guard the handlers. [VS Code Workspace Trust guide](https://code.visualstudio.com/api/extension-guides/workspace-trust)

- [ ] **Harden GitHub Actions.** GitHub Actions use mutable tags, including third-party publishing actions that receive marketplace secrets. Pin every action to a full commit SHA and add least-privilege permissions. GitHub identifies full SHAs as the only immutable way to reference actions. [GitHub Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use)

### Functional defects

- [x] **Fix Windows startup.** The code discovers `vale-ls.exe`, then constructs server options using `vale-ls` without `.exe`. See [`src/lsp.ts:353`](src/lsp.ts#L353). Fixed as a side effect of the vale-ls download hardening work: `filePath` is now built once via `getExecutableName(process.platform)` (src/utils.ts) and reused for both the existence check and the language client's `serverOptions`.

- [ ] **Fix executable paths containing spaces.** Paths are incorrectly escaped even though no shell is used for the language server. Only the first space is escaped, producing a nonexistent executable path. See [`src/lsp.ts:372`](src/lsp.ts#L372).

- [ ] **Apply the custom filter setting.** The `vale.valeCLI.filter` setting is exposed but never read. Only the legacy alert-level and spelling filters are applied. See [`package.json:100`](package.json#L100) and [`src/lsp.ts:381`](src/lsp.ts#L381).

- [x] **Prevent duplicate startup synchronization.** Enabling `syncOnStartup` runs synchronization twice: once inside `vale-ls` and again in the extension after the server starts. The official server documents this as an initialization option. [Vale LSP configuration](https://vale.sh/docs/guides/lsp)

- [ ] **Fix vocabulary path selection.** `getStylesPathsFromVale` returns a string, but the fallback uses `stylesPaths[0]`, which is the first character—usually `/`. It can consequently try to write beneath `/config/vocabularies`. See [`src/lsp.ts:150`](src/lsp.ts#L150) and [`src/lsp.ts:201`](src/lsp.ts#L201).

- [ ] **Validate vocabulary input.** Vocabulary names accept traversal components such as `../../…`, and multiline selections can corrupt vocabulary files.

- [ ] **Apply settings changes.** Settings are read once during activation. Changing configuration does not update or restart the language server. Upstream `vale-ls` acknowledges configuration events but does not apply them, so the extension must restart it.

- [x] **Support multi-root workspaces correctly.** Multi-root operations always use the first workspace folder, regardless of the active file. Upstream multi-root change handling is also currently a no-op. Fixed by running one `LanguageClient` per workspace folder (vale-ls has no native multi-root support), with commands resolving the folder from the active editor and `onDidChangeWorkspaceFolders` starting/stopping clients as folders change. See `.claude/notes/multi-root-workspaces.md`.

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
- [ ] Add native commands for **Select Configuration File**, **Open Vale Settings**, and **Restart Language Server**.
- [ ] Deprecate or implement the three no-op settings instead of silently presenting them.
- [ ] Remove the Explorer tree containing three command buttons. VS Code’s UX guidance explicitly discourages using tree items as command buttons. Keep the commands in the Command Palette and expose only contextual actions where useful. [VS Code View guidelines](https://code.visualstudio.com/api/ux-guidelines/views)
- [ ] Add one `LanguageStatusItem` showing Starting, Ready, or Configuration Error for relevant documents. VS Code identifies this as the preferred surface for active linter/configuration status. [VS Code API](https://code.visualstudio.com/api/references/vscode-api#LanguageStatusItem)
- [ ] Put vocabulary actions beneath a single **Vale** editor-context submenu.
- [ ] Use cancellable progress for downloads and sync; reserve notifications for actionable failure states.
- [ ] Format configuration as JSON in an editor document rather than raw output-channel text.

## Efficiency and code structure

- [ ] Split the 653-line [`src/lsp.ts`](src/lsp.ts) into lifecycle, configuration, language-server management, CLI execution, vocabulary, commands, and UI modules.
- [ ] Remove duplicated accept/reject handlers and centralize error formatting and workspace resolution.
- [ ] Start the language server lazily when a relevant document or Vale command is used instead of on every `onStartupFinished`.
- [ ] Restrict the current `language: "*"` document selector. It presently sends every local file’s full content to the server on edits.
- [ ] Implement the diagnostic limit through client middleware so the exposed setting actually works.
- [ ] Use a single safe CLI runner with no shell, bounded output, timeout, cancellation, process disposal, and concurrency control.
- [ ] Route sync through the language server so it uses the same managed Vale installation and configuration.
- [ ] Cache the verified language server by version in global storage. The local binary is currently `0.3.8`, while the code requests `0.4.0`; there is no version verification or update path.
- [ ] Resolve commands relative to the active document’s workspace folder, prompting only when the choice is ambiguous.
- [ ] Raise the TypeScript target from ES2017 to a modern Node target and remove unnecessary casts and boxed `String` types.

## Dependency and CI proposal

- [ ] Upgrade `vscode-languageclient` from 9.0.1 to 10.1.0.
- [ ] Replace `vscode-test` with `@vscode/test-electron@3.1.0`.
- [ ] Remove unused `@aws-sdk/client-s3`, `@types/which`, TSLint, and likely Mocha.
- [ ] Add a real ESLint flat configuration; ESLint currently exits because none exists.
- [ ] Update Webpack, TypeScript ESLint, ESLint, and related tooling after removing unused packages.
- [ ] Prefer Node’s built-in test runner for pure unit tests.
- [ ] Consider replacing Webpack/ts-loader with a smaller esbuild setup. The current production build takes about six seconds, produces approximately 984 KB across ten files, and emits a dynamic-require warning.
- [ ] Add `@vscode/vsce` as a pinned development dependency instead of globally installing its latest version in CI.
- [ ] Upgrade CodeQL actions from retired `v2` to `v3` in [`.github/workflows/codeql.yml:29`](.github/workflows/codeql.yml#L29). CodeQL v2 has been retired since January 2025. [GitHub announcement](https://github.blog/changelog/2025-01-10-code-scanning-codeql-action-v2-is-now-deprecated/)
- [ ] Consolidate build, test, package, and publish so publishing cannot bypass validation.

## Current validation state

- TypeScript `--noEmit`: passes.
- Production Webpack build: passes with one warning.
- Tests: `npm test` now runs `src/utils.test.ts` (pure, `vscode`-free helpers) via `tsc -p tsconfig.test.json` + Node's built-in test runner. `src/lsp.ts` still has no test coverage — it imports `vscode` at load time and needs the extension host (or a mock) to test directly.
- Linting: unavailable because there is no ESLint configuration.
- Working tree before creating this report: clean.

## Recommended implementation order

1. Security and correctness blockers.
2. Settings and UI restructuring.
3. Architectural and runtime-efficiency refactor.
4. Dependency/toolchain/CI modernization, tests, documentation, and cross-platform packaging validation.


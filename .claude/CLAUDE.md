# vale-vscode

VS Code extension for [Vale](https://vale.sh). Wraps the [Vale Language
Server](https://github.com/errata-ai/vale-ls) (`vale-ls`) and the `vale` CLI.

[`src/lsp.ts`](../src/lsp.ts) is only a thin re-export (the webpack entry
point / extension host entry); the actual logic is split by concern:

- [`src/lifecycle.ts`](../src/lifecycle.ts) - `activate`/`deactivate`, wiring
  the other modules together.
- [`src/languageServer.ts`](../src/languageServer.ts) - downloading/
  installing vale-ls and managing one `LanguageClient` per workspace folder.
- [`src/config.ts`](../src/config.ts) - resolving a folder's settings into
  vale-ls `initializationOptions`.
- [`src/cli.ts`](../src/cli.ts) - direct `vale` CLI invocations (`sync`,
  `ls-config`, `ls-metrics`).
- [`src/vocabulary.ts`](../src/vocabulary.ts) - reading/writing Vale
  vocabulary files.
- [`src/commands.ts`](../src/commands.ts) - registers the command
  palette/editor-menu commands.
- [`src/ui.ts`](../src/ui.ts) - the output channel and the "Vale" Explorer
  sidebar tree view.
- [`src/workspaceFolders.ts`](../src/workspaceFolders.ts) - shared
  workspace-folder identity helpers (used by both `languageServer.ts` and
  `commands.ts`).
- [`src/docker.ts`](../src/docker.ts) - generates the per-folder Docker
  wrapper script used when `vale.docker.enabled` is set.

Pure, `vscode`-free helpers live in [`src/utils.ts`](../src/utils.ts).

## Working agreement

- `PROJECT_AUDIT.md` at the repo root tracks known issues by priority
  (Security / Functional defects / UI / Efficiency / Dependencies). When
  fixing an audited item, check its box in that file once done.
- For any user-facing change (behavior, settings, install/storage location,
  commands), update:
  - tests (see below),
  - `README.md`,
  - this repo's `.claude/notes/` if the change carries non-obvious rationale
    worth remembering for later work.
- Ask before starting when an audit item's scope is ambiguous (e.g. "high
  priority" spans multiple sections) rather than assuming the broadest reading.

## Testing

- `npm test` runs `src/**/*.test.ts` through Node's built-in test runner
  (compiled via `tsconfig.test.json` to `out-test/`, CommonJS, no `vscode`
  dependency).
- Only `src/utils.ts` (and future similarly pure modules) can be unit tested
  this way, because every other module imports the `vscode` module at load
  time, which only exists inside the real extension host. When adding
  testable logic, prefer extracting it into `utils.ts` as a pure function
  over adding it directly to a `vscode`-dependent module.
- `npm run compile` / `tsc --noEmit` type-checks the whole extension against
  `@types/vscode`.

## Build

- `npm run webpack` (production) / `npm run webpack-dev` (watch) bundle
  `src/lsp.ts` into `dist/extension.js` via `ts-loader`. `vscode` is external
  (provided by the host), everything else is bundled.

## Notes folder

`.claude/notes/` holds durable, non-obvious project knowledge (release
processes, gotchas, decisions) that isn't derivable by reading the current
code or git log. See its files for specifics; keep it up to date as you learn
things.

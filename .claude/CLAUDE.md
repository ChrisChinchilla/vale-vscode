# vale-vscode

VS Code extension for [Vale](https://vale.sh). Wraps the [Vale Language
Server](https://github.com/errata-ai/vale-ls) (`vale-ls`) and the `vale` CLI.
Almost all extension logic lives in [`src/lsp.ts`](../src/lsp.ts); pure,
`vscode`-free helpers live in [`src/utils.ts`](../src/utils.ts).

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
  this way, because `src/lsp.ts` imports the `vscode` module at load time,
  which only exists inside the real extension host. When adding testable
  logic, prefer extracting it into `utils.ts` as a pure function over adding
  it directly to `lsp.ts`.
- `npm run compile` / `tsc --noEmit` type-checks the whole extension
  (including `lsp.ts`) against `@types/vscode`.

## Build

- `npm run webpack` (production) / `npm run webpack-dev` (watch) bundle
  `src/lsp.ts` into `dist/extension.js` via `ts-loader`. `vscode` is external
  (provided by the host), everything else is bundled.

## Notes folder

`.claude/notes/` holds durable, non-obvious project knowledge (release
processes, gotchas, decisions) that isn't derivable by reading the current
code or git log. See its files for specifics; keep it up to date as you learn
things.

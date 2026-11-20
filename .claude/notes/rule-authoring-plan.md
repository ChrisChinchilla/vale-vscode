# Rule-authoring improvements: plan for consideration (not started)

Audience: people who write Vale rules and styles, as opposed to people who
run Vale on prose. Split out of `vale-updates-roadmap.md` because it serves a
narrower group and none of it is committed work. Decide scope before starting.

## Background
Vale 3.20-3.24 made authoring richer: rule inheritance (`extends` naming
another rule, with `key+`/`key-` overlays), `doc()` selections, TextFSM and
tree-sitter Views, and `vale test` (3.24), a test runner with per-rule
`tests:` blocks and a `--coverage` mode. The extension offers nothing
authoring-specific yet. vale-ls already provides hover docs, completion and
document links for rule fields (v0.5.0 documented the remaining rule fields).

## Candidate items

### 1. Vale: Run Rule Tests  (ties to a new CLI feature)
- Runs `vale test` (Vale >= 3.24.0) for the active rule file or the folder,
  streaming output to the Vale channel. A `--coverage` variant fails rules no
  case exercises.
- Needs: a version gate (reuse `parseValeVersion`/`isVersionAtLeast` with a new
  `MIN_VALE_TEST_VERSION = [3, 24, 0]`), trust guard, `resolveCommandContext`,
  Docker support through the existing `runValeCommand`.
- Open: exact CLI arguments and exit codes need confirming against
  https://docs.vale.sh/topics/testing before building.
- Possible later step: surface failures as Problems-view diagnostics, or use
  the Testing API. Out of scope for a first version.

### 2. Vale: Open Rule in Regex101  (existing capability, not a new one)
- Calls the server command `cli.compile`: vale-ls runs `vale compile <rule>`
  and uploads the pattern to Regex101, then opens the browser. The feature
  dates from vale-ls 2023; no recent Vale release added it.
- Privacy: sends the rule's regex to a third-party site. Require a one-time
  confirmation and document it in the README.
- Unknown: behaviour for rules using `extends: <Rule>` or `tokens+`/`tokens-`
  (compiled output may not be a single pattern). Test before shipping.
- Lowest priority of the three.

### 3. Contextual visibility
- Show the two commands above only for `.yml` files inside a `StylesPath`
  (editor title / context menu `when` clauses), and hide them otherwise.

### 4. Version awareness (shared with end users)
- Show the detected Vale version in Show Diagnostics and warn when a command
  needs a newer Vale. Benefits everyone, but is required by item 1.

## Not proposed
- Rule-file schema validation or snippets: out of scope for this extension;
  vale-ls owns language features for rule files.

## Suggested order if approved
4 -> 1 -> 3 -> 2.

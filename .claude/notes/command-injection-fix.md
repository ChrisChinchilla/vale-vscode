# Command injection fix (spawn shell:true)

`PROJECT_AUDIT.md`'s "eliminate command injection" finding: `runValeCommand`
(used by Vale: Sync / Show Configuration / Show Readability Metrics) and
`getStylesPathsFromVale` (used by the vocabulary accept/reject commands)
called `child_process.spawn("vale", args, { shell: true })`. With
`shell: true`, Node re-serializes the argv array through a shell, so a
crafted value in `args` (e.g. an active file path containing shell
metacharacters, passed to `vale ls-metrics <path>`) could execute arbitrary
commands instead of being treated as a single literal argument.

Fix: both spawn call sites now go through `buildValeSpawnOptions(cwd)` in
`src/utils.ts`, which returns only `{ cwd }` — no `shell` key at all. Node
passes the argv array directly to the OS without shell interpretation, so
metacharacters in any argument are inert. `src/utils.test.ts`'s
`buildValeSpawnOptions` test is a regression check that `shell` never
creeps back into the returned options object.

This assumes `vale` itself is a compiled binary the OS can exec directly
(true for the released Vale CLI, including `vale.exe` on Windows) — no
`.cmd`/`.bat` shim requiring a shell to resolve.

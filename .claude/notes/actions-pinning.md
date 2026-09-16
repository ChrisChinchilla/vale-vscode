---
name: actions-pinning
description: How every workflow's `uses:` references got pinned to commit SHAs, the resolved SHAs in use, and the per-job permissions tightening done alongside it
metadata:
  type: project
---

# GitHub Actions pinning and permissions

All workflow `uses:` references are pinned to a full commit SHA (GitHub's
only immutable way to reference an action - a tag like `@v4` can move to
point at different code). Each pin keeps a trailing `# vX` comment purely so
Dependabot/Renovate's action-version updater can still match and bump it;
the comment itself is not trusted for anything.

## Resolving a pin

```sh
gh api repos/<owner>/<repo>/commits/<tag> --jq .sha
```

SHAs in use as of 2026-09-16 (re-resolve before bumping - these move):

| Action | Tag | SHA |
|---|---|---|
| `actions/checkout` | v4 | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-node` | v4 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/setup-go` | v5 | `40f1582b2485089dde7abd97c1529aa768e1baff` |
| `github/codeql-action/*` | v3 | `faaca9a8f6edddba5725ffe5adefdab6669a2eca` |
| `ncipollo/release-action` | v1 | `339a81892b84b4eeb0f6e744e4574d79d0d9b8dd` |
| `HaaLeo/publish-vscode-extension` | v1 | `f4ece70f329f66686bd71c54b1671353fe320e49` |
| `alstr/todo-to-issue-action` | v4 | `4120fdbb02461dd1abf18756a7464b8e45347863` |
| `peter-evans/create-pull-request` | v7 | `22a9089034f40e5a961c8808d113e2c98fb63676` |

`github/codeql-action` publishes `init`/`autobuild`/`analyze` from one
monorepo, so all three share the same SHA.

## Permissions

Every job now declares its own `permissions:` instead of inheriting the
repository's default token scope (Settings -> Actions -> Workflow
permissions), which is opaque to a workflow file and can be more permissive
than the job actually needs. See [[release-pipeline-permissions]] for how
a *missing* `permissions:` block on a job calling a reusable workflow can
fail closed at startup, rather than just being an over-broad-token risk -
that's the sharper failure mode this general tightening also guards against.

`versionParity.yml` never checks out the repo or calls any API (it derives
everything from `GITHUB_REF_NAME`), so it gets workflow-level
`permissions: {}` rather than a job-level grant.

`todo-issue.yml` was missing the `actions/checkout` step
`alstr/todo-to-issue-action` needs to scan the repo for `TODO` comments
(confirmed via the action's own docs) - added alongside the permissions fix,
since without it the action had nothing to scan.

Verified with `actionlint` (installed via Homebrew locally; no CI job runs
it yet - worth adding if workflow changes become frequent).

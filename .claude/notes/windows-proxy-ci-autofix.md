# Self-healing Windows Docker proxy binary check

`.github/workflows/build.yaml`'s `windows-docker-proxy` job verifies the
committed `native/vale-docker-proxy/bin/*.exe` binaries match a fresh build
from source, by SHA-256. It used to just fail loudly when they didn't -
"always broken" per user report, meaning contributors were hitting this
essentially every time they touched the proxy source, not just occasionally.

## Why it was "always broken"

Go only guarantees byte-identical output for the *same compiler toolchain
version* building the same source with the same flags - not across
versions, even with `-trimpath -ldflags "-s -w -buildid="` stripping the
usual non-determinism sources (build paths, embedded build ID). `go.mod`'s
`go 1.22` directive is a *floor* ("requires at least this version"), not a
pin - `actions/setup-go@v5`'s `go-version-file` mode resolves to the latest
version satisfying that floor, which drifts upward over time as new Go
releases ship. Confirmed locally: this machine's `go version` is 1.27.0,
nowhere near the `go 1.22` floor. So the committed binaries and a CI rebuild
will mismatch any time the Go version used to produce the committed binary
(whatever a contributor had locally when they last ran the build commands in
`native/vale-docker-proxy/README.md`) differs from whatever `setup-go`
resolves at verification time - independent of whether the proxy's actual
source changed at all.

## The fix: CI builds are the source of truth, not a human's local rebuild

Asking a human to keep two things in sync by hand (rebuild locally, hope
their Go version matches CI's, commit) is exactly the kind of process that
silently rots. Instead, `windows-docker-proxy` now rebuilds, and if the
committed binary doesn't match, copies the fresh build over it and commits
it back to the branch (`git config` a bot identity, `git add`/`commit`/
`push origin HEAD:<branch>`), then still exits non-zero so the run's status
honestly reflects "the code as pushed had a stale binary" - a re-run (or the
next push) then passes cleanly instead of silently continuing green with
mismatched history.

## Two cases where it can't autofix, and stays a plain failure

Guarded via `github.ref_type == 'branch' && (github.event_name !=
'pull_request' || github.event.pull_request.head.repo.full_name ==
github.repository)`:

1. **Tag pushes.** This job also runs as `validate` via `workflow_call` from
   `publishTags.yml`/`publishPreRelease.yml`, triggered by pushing a `vX.Y.Z`
   tag. `github.ref_type` is `tag` there, not `branch` - there's no branch
   to push a fix commit to, and tags are meant to be immutable pointers
   anyway. A stale binary in a release should block that release, not get
   silently patched into the tagged commit's history after the fact.
2. **Fork PRs.** The default `GITHUB_TOKEN` has no write access to a
   contributor's fork branch (a deliberate GitHub security boundary) - `git
   push` would just fail. Detected via `github.event.pull_request.head.repo.full_name
   != github.repository`. Falls through to asking the contributor to rebuild
   and commit manually, same as before this change.

The checkout step now explicitly checks out `${{ github.head_ref ||
github.ref_name }}` rather than the default ref, since a plain `pull_request`
checkout resolves to the ephemeral `refs/pull/N/merge` ref, which can't be
pushed to at all.

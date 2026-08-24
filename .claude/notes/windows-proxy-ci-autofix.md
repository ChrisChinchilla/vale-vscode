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
committed binary doesn't match, copies the fresh build over it and opens a
PR (`peter-evans/create-pull-request@v7`) with just the two binary files
against the triggering branch, then still exits non-zero so the run's
status honestly reflects "the code as pushed had a stale binary" - merging
the PR and re-running (or pushing again) then passes cleanly.

**First version of this fix pushed a commit directly instead of opening a
PR, and broke on its first real run against `main`**: `main` is a protected
branch (`required_pull_request_reviews`, `lock_branch: true`), so
`git push origin HEAD:main` with the default `GITHUB_TOKEN` was rejected
with `GH006: Protected branch update failed ... Changes must be made
through a pull request.` `enforce_admins` is `false`, so the repo owner can
still push directly as a human, but the bot token can't bypass the
protection the same way. Switched to opening a PR instead, which works
under branch protection at the cost of needing a manual merge - the
self-healing intent survives, just gated by a review instead of being fully
automatic on `main`.

Also worth knowing for next time: `setup-go`'s `go-version-file` mode
doesn't resolve to "whatever's newest overall" - it resolves the newest
*patch* of the exact `go 1.22` line named in `go.mod` (confirmed in a CI
run: `go1.22.12`). So drift is real but bounded to 1.22.x patch bumps, not
big jumps like the 1.27.0 on a contributor's local machine. To rebuild
binaries locally that will actually match CI, pin the toolchain explicitly
rather than using whatever's on `PATH`:
`GOTOOLCHAIN=go1.22.12 GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build ...`
(Go 1.21+ auto-downloads the named toolchain). Cross-compiling from macOS to
`windows/amd64` and `windows/arm64` works fine for this - no Windows host
needed for the *build* step, only for `go test` (see this project's
`README.md`).

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

---
name: pre-release
description: Cut a vale-vscode pre-release or stable release via the tag-triggered GitHub Actions pipeline (versionParity.yml, build.yaml, publishTags.yml, publishPreRelease.yml, release.yml, preRelease.yml). Load before bumping package.json version or pushing a release tag.
---

# Cutting a vale-vscode release

This repo publishes to the VS Code Marketplace and Open VSX entirely via a
tag push (`vX.Y.Z`). There is no manual `vsce publish` step in normal use.

## The odd/even convention

The VS Code Marketplace rejects semver pre-release suffixes (`-beta.1`) in
`package.json` - `vsce publish` fails outright. So channel selection is
encoded in the **minor** version's parity instead, computed fresh from the
pushed tag name by `.github/workflows/versionParity.yml` (shared by all
four release workflows):

- **Even minor** (`0.34.x`, `1.2.x`, ...) → stable
- **Odd minor** (`0.35.x`, `1.1.x`, ...) → pre-release

Full detail and history: `.github/CONTRIBUTING.md`.

**Before picking a version number, check what's actually being asked for.**
"Make a release" doesn't by itself say stable vs. pre-release, and a
version like `v1.0.0` *looks* like a major-milestone pre-release to a human
but has an even (`0`) minor, so the pipeline will treat it as **stable**.
If there's any ambiguity, ask - don't infer the channel from how "big" the
version number looks.

## Steps

1. **Check `main`'s last `build.yaml` run is green** before doing anything
   else (`gh run list --branch main --limit 5`). If it's red, fix that
   first - a release tag runs the same `build.yaml` via `workflow_call`
   (as `validate`), so a pre-existing failure blocks the release too.
2. Decide the version number (ask if ambiguous - see above).
3. `npm version --no-git-tag-version X.Y.Z` (updates both `package.json`
   and `package-lock.json`).
4. Commit.
5. Push the commit to `main` first, and **wait for `build.yaml` to pass**
   before tagging - don't tag speculatively against a commit whose CI
   hasn't run yet.
6. `git tag -a vX.Y.Z -m "..."`, then push the tag.
7. Watch all four tag-triggered workflows
   (`gh run list --limit 8` / `gh run watch <id>`):
   - `versionParity.yml` (reusable, no visible run of its own)
   - Stable pair (`release.yml`, `publishTags.yml`) - should **no-op**
     (jobs skipped, run still shows `success`) when cutting a pre-release,
     and vice versa. A no-op is the correct, expected outcome for the
     inactive channel - don't mistake "success with skipped jobs" for
     "did nothing wrong."
   - Pre-release pair (`preRelease.yml`, `publishPreRelease.yml`) - should
     actually run and publish, when cutting a pre-release.
8. Confirm: `gh release view vX.Y.Z` (GitHub release + notes exist) and
   that `publishTags.yml`/`publishPreRelease.yml`'s `deploy` job actually
   ran (not just `success` from being skipped - check the job list).

## Known pitfalls (hit and fixed 2026-08-24, see `.claude/notes/`)

These are exactly the kind of failures that look like "just re-run it" but
aren't - each one silently prevented a real release from completing.

1. **The Windows proxy binary check can fail on *every* commit, not just
   occasionally.** Go embeds a VCS commit-stamp in binaries by default
   since Go 1.18, which a committed binary can never match (it can't embed
   the hash of the commit that adds it). Fixed with `-buildvcs=false` in
   both `build.yaml` and `native/vale-docker-proxy/README.md`. If this
   job's check step reports staleness again, verify `-buildvcs=false` is
   still present in the build commands before assuming it's a real
   source/toolchain change. See `.claude/notes/windows-proxy-ci-autofix.md`.

2. **A `uses: ./.github/workflows/build.yaml` call needs the calling job to
   explicitly declare `permissions:` covering the callee's most-permissive
   job.** This repo's default `GITHUB_TOKEN` permission is `read`
   (Settings → Actions → General → Workflow permissions). If `build.yaml`
   or any job it contains needs more (currently `contents: write` +
   `pull-requests: write` for `windows-docker-proxy`), every caller job
   using `uses:` on it must redeclare at least that much, or the *entire
   run* fails at startup with zero jobs created (`startup_failure`,
   "likely failed because of a workflow file issue") - not a normal job
   failure, and easy to misdiagnose as a YAML syntax error (it isn't;
   `actionlint` passes clean on these files). Check with:
   `gh api repos/OWNER/REPO/actions/permissions/workflow`.

3. **`main` is a protected branch** (`required_pull_request_reviews`,
   `lock_branch: true`, `enforce_admins: false`). The repo owner can push
   directly (admin bypass), but a CI job's `GITHUB_TOKEN` cannot - any
   automation that tries to commit/push a fix back to `main` needs to open
   a PR instead. Currently blocked in practice: this repo also has "Allow
   GitHub Actions to create and approve pull requests" turned off, so even
   the PR-based fallback (`peter-evans/create-pull-request`) fails until a
   human enables that repo setting or merges such a PR manually.

4. **Force-pushing or deleting a tag is blocked by the Claude Code
   permission classifier**, even when the intent is legitimate (moving an
   unreleased tag to include a just-landed fix, before anything was
   actually published under it). If a tag needs to move, either ask the
   user to delete it via `gh release delete`/GitHub UI first (a plain
   `git tag` create afterward is not treated as destructive), or ask the
   user to run the force-push themselves.

5. **`git fetch --prune --prune-tags`** deletes local tags that no longer
   exist on the tracked remote. If a tag was just deleted from the remote
   (e.g. per pitfall 4) and you fetch with `--prune-tags` before
   recreating it, you'll lose the local ref too and have to recreate it
   from the commit sha, not just re-push what was already there.

## Tools worth reaching for

- `actionlint` (`brew install actionlint`) catches GitHub Actions schema
  issues that generic YAML parsing (`js-yaml`) misses - reusable workflow
  permission mismatches are *not* one of the things it catches, though
  (see pitfall 2), so a clean `actionlint` run doesn't rule that out.
- `gh api repos/OWNER/REPO/actions/permissions/workflow` - check default
  token permissions before assuming a `startup_failure` is a syntax issue.
- `gh api repos/OWNER/REPO/branches/main/protection` - check branch
  protection before assuming a CI push/PR job will work as designed.
- `go version -m <binary>` - inspect embedded build metadata (VCS stamp,
  toolchain version, GOOS/GOARCH/flags) to debug binary reproducibility.
- `GOTOOLCHAIN=<exact version> go build ...` - pin the Go toolchain for a
  local build to match what `actions/setup-go`'s `go-version-file` mode
  resolves in CI (which is the newest *patch* of the exact line named in
  `go.mod`, not "whatever's newest overall" - confirm via a CI log:
  `Successfully set up Go version X.Y.Z`).

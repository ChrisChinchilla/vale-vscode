---
name: release
description: Cut a vale-vscode stable/production release via the tag-triggered GitHub Actions pipeline (versionParity.yml, build.yaml, publishTags.yml, release.yml). Load before bumping package.json to an even minor and pushing a stable release tag. For pre-releases (odd minor) use the pre-release skill instead.
---

# Cutting a vale-vscode stable (production) release

This repo publishes to the VS Code Marketplace and Open VSX Registry
entirely via a tag push (`vX.Y.Z`). There is no manual `vsce publish` step
in normal use.

The general mechanics, the odd/even channel convention, and the shared CI
pitfalls are all documented in the **`pre-release`** skill - read that too.
This skill only covers what is specific to a **stable** release.

## Channel: this must be an EVEN minor

Channel selection is encoded in the **minor** version's parity, computed
from the pushed tag name by `.github/workflows/versionParity.yml`:

- **Even minor** (`1.2.x`, `0.34.x`, ...) → stable ← this skill
- **Odd minor** (`1.1.x`, `0.35.x`, ...) → pre-release → use `pre-release` skill

**A stable release is normally cut from the odd pre-release line that was
used to test it.** If the current `package.json` version is `1.1.x`
(pre-release), the matching stable release is `1.2.0`. Don't reuse the odd
line, and don't add a suffix.

`v1.0.0`-style numbers *look* like a big milestone pre-release to a human
but have an even (`0`) minor, so the pipeline treats them as **stable**. If
there is any ambiguity about whether the user wants stable or pre-release,
**ask** - don't infer from how "big" the number looks.

## Steps

1. **Check `main`'s last `build.yaml` run is green** (`gh run list --branch
   main --limit 5`). A release tag re-runs the same `build.yaml` via
   `workflow_call`, so a pre-existing failure blocks the release too. Fix
   it first.
2. Decide the version (ask if stable vs. pre-release is ambiguous). For a
   stable release the minor must be **even** and the exact `X.Y.Z` must not
   have been published before (`gh release view vX.Y.Z` should 404;
   `git tag` should not list it).
3. `npm version --no-git-tag-version X.Y.Z` (updates `package.json` and
   `package-lock.json`).
4. Update `CHANGELOG.md` / release-notes source if the repo tracks one, and
   any docs affected by user-facing changes in this release.
5. Commit.
6. Push the commit to `main` first and **wait for `build.yaml` to pass**
   before tagging - don't tag a commit whose CI hasn't run.
7. `git tag -a vX.Y.Z -m "..."`, then push the tag.
8. Watch the four tag-triggered workflows (`gh run list --limit 8` /
   `gh run watch <id>`):
   - `versionParity.yml` - reusable, no visible run of its own.
   - **Stable pair (`release.yml`, `publishTags.yml`) - these should
     actually run and publish.** Confirm `publishTags.yml`'s `deploy` job
     actually executed (not just `success` from being skipped - check the
     job list).
   - Pre-release pair (`preRelease.yml`, `publishPreRelease.yml`) - should
     **no-op** (jobs skipped, run still shows `success`). That is the
     correct expected outcome for the inactive channel.
9. Confirm:
   - `gh release view vX.Y.Z` - GitHub release exists, is **not** marked
     pre-release, notes are present.
   - Marketplace + Open VSX show the new stable version (may lag a few
     minutes).
10. **Bump the version forward after a successful publish** so `main`
    doesn't sit on an already-published version. Convention here: go back
    to the next odd minor to reopen the pre-release line for the next cycle
    (e.g. after `1.2.0` stable, bump `main` to `1.3.0`), or `npm version
    --no-git-tag-version patch` if staying on stable for a quick follow-up.
    Confirm which the user wants.

## Pitfalls

All the CI pitfalls in the `pre-release` skill apply here unchanged
(Windows proxy VCS stamp, reusable-workflow `permissions:`, protected
`main`, blocked tag force-push/delete, `--prune-tags` eating local tags).
See that skill and `.claude/notes/release-pipeline-permissions.md`.

The one stable-specific trap: the stable and pre-release workflow pairs
both trigger on every `v*` tag, so a green run for `preRelease.yml` on a
stable tag means "correctly skipped", not "published to the wrong
channel". Verify by the `deploy` job, not the run's top-level status.

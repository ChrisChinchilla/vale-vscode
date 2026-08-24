---
name: release-pipeline-permissions
description: Why the v1.1.0 tag's publish workflows failed with startup_failure, and how tag mutation interacts with Claude Code's permission classifier
metadata:
  type: project
---

# Reusable-workflow permission propagation broke the first v1.1.0 tag push

`publishTags.yml` and `publishPreRelease.yml` both have a `validate` job
that calls `build.yaml` via `uses: ./.github/workflows/build.yaml`. Pushing
the `v1.1.0` tag the first time, both came back `startup_failure` with zero
jobs created ("This run likely failed because of a workflow file issue") -
while `release.yml`/`preRelease.yml`, which don't call `build.yaml`,
succeeded on the same tag.

Cause: this repo's default `GITHUB_TOKEN` permission is `read`
(`gh api repos/.../actions/permissions/workflow` →
`default_workflow_permissions: "read"`). `build.yaml`'s `windows-docker-proxy`
job requests `contents: write` + `pull-requests: write`. A job that calls a
reusable workflow must itself declare `permissions:` covering whatever the
reusable workflow's jobs request - it isn't enough for the *reusable
workflow's own file* to declare those permissions, since the caller has to
grant them. Without that, GitHub refuses to even start the run, which reads
exactly like a YAML/schema error but isn't (`actionlint` passes clean on
these files - it doesn't check this).

Fix: added a `permissions:` block directly to the `validate` job in both
files, matching `build.yaml`'s `windows-docker-proxy` job's requirements.
See `.claude/skills/pre-release/SKILL.md` for the general pattern to watch
for on future workflow changes.

## Moving a tag after a failed run

Once `v1.1.0` was fixed and needed to point at the corrected commit, both
`git push --force` and delete-then-recreate (`git push :refs/tags/v1.1.0`)
were blocked by Claude Code's permission classifier as destructive actions
- reasonable in general, since a tag move can silently discard history
other people rely on, but this specific move was safe (nothing had actually
published under the old tag; both marketplace-publish jobs had failed at
startup). Worked around by asking the user to delete the tag/release via
GitHub directly, then creating a fresh tag locally - a plain `git tag`
create/push isn't treated as destructive.

Side effect hit along the way: `git fetch --prune --prune-tags` deletes
local tags no longer on the tracked remote, so after the user deleted the
remote tag, the local `v1.1.0` tag also vanished on the next fetch and had
to be recreated from the commit sha rather than just re-pushed.

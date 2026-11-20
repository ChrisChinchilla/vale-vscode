# Release blog post workflow

`.github/workflows/release-blog-post.yml` is a self-contained copy of a workflow shared across Chris's repos. It has no dependency on any other repo except the website, `ChrisChinchilla/chrischinchilla.com` (local clone: `~/Workspace/Chris Chinchilla/new-site`).

On a release it fetches the release notes, checks out this project and the website, runs the Claude Code CLI (`claude -p`, Read/Write/Glob/Grep only, because release notes are untrusted input) to write one post following the site's own `CLAUDE.md` and recent posts, then opens a **draft pull request** on the site repo. The draft PR is the draft state: the site has no `draft` frontmatter flag, so merging publishes. Pre-releases are skipped.

## Setup per repo

- Add two Actions secrets: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, uses the Claude subscription, not an API key) and `SITE_REPO_TOKEN` (fine-grained PAT on the site repo with Contents **and** Pull requests read/write).
- Site settings (`SITE_REPO`, `SITE_BRANCH`, `POSTS_PATH`, `GUIDANCE_FILES`, `SKIP_PRERELEASE`) are an `env` block at the top of the workflow.
- Triggers: `release: published`, `workflow_dispatch` (with a tag) and `workflow_call`. Releases created with `GITHUB_TOKEN` (for example by `ncipollo/release-action`) don't fire `release` events, so add a job after the release job in that repo's release workflow:

  ```yaml
  blog-post:
    needs: <release-job>
    uses: ./.github/workflows/release-blog-post.yml
    secrets: inherit
    with:
      tag: ${{ github.ref_name }}
  ```

  Don't let both the `release` trigger and this job fire for the same release, or it runs twice.
- Re-run by hand: `gh workflow run release-blog-post.yml --repo <owner>/<repo> -f tag=<tag>`. Pass `--repo` explicitly: in forks `gh` defaults to the upstream repo.

## Gotchas

- `anthropics/claude-code-action` rejects `push` events (what a called workflow inherits from a tag release), so the workflow runs the CLI directly.
- The "Verify the site token" step probes git's write handshake, because the repo API's `permissions` field reflects the user's role, not the token's scopes. A 403 there or on push usually means the PAT lacks Contents write or doesn't include the site repo.
- Verified end to end on 2026-11-20 (obsidian-vale 2.2.1, draft PR #190 on the site repo).

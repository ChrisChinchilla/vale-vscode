# Publishing a release

## Versioning: stable vs. pre-release

The VS Code Marketplace does not support semver pre-release tags (e.g.
`0.31.0-beta.1`) in `package.json` - `vsce publish` rejects them outright.
Instead, this repo follows [VS Code's own documented
convention](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):
every version is a plain `X.Y.Z`, and the **minor** number's parity decides
the channel.

* **Even minor** (`0.32.x`, `0.34.x`, ...) - stable release.
* **Odd minor** (`0.31.x`, `0.33.x`, ...) - pre-release.

The tag you push (`vX.Y.Z`) is what every workflow reads to decide which
channel a given push belongs to (`versionParity.yml`, shared by all four
release workflows) - so the pushed tag's minor number is what has to be
odd/even, and `package.json`'s `version` should match it.

To cut a pre-release for testing, bump to the next odd minor (e.g. `0.31.0`,
then `0.31.1`, `0.31.2`, ... for further pre-release builds under the same
line) rather than reusing the stable line with a suffix. When that work is
ready to ship, bump to the next even minor for the actual stable release.

## Stable Releases

* Ensure version in package.json has not been published yet, and its minor number is **even**. If already published, increase it (don't forget package-lock.json). This kind of command can be used: `npm version --no-git-tag-version patch`
* Create a tag (`vX.Y.Z`, matching package.json) and potentially a GitHub release
* Check the GitHub Action `Publish Extension on tag` workflow has been triggered and is successful
* It is a good habit to upgrade the version after a successful publish, for instance with this kind of command: `npm version --no-git-tag-version patch`

## Pre-Releases

Pre-releases allow testing of new features before a stable release. The Microsoft Marketplace and Open VSX Registry both support pre-release versions via a `preRelease` flag, not via the version string itself.

* Ensure version in package.json is a plain `X.Y.Z` with an **odd** minor number (e.g. `0.31.0`)
* Create a matching tag (`v0.31.0`)
* The `Publish Pre-Release Extension` workflow will automatically publish to both marketplaces with the pre-release flag
* The `Pre-Releases` workflow will create a GitHub pre-release with release notes
* Users can opt in to pre-release versions in VS Code by switching to the pre-release channel in the extensions view

**Note:** every tag (`v*`) triggers all four release workflows, but each one's jobs are gated on the tag's minor-version parity via `versionParity.yml` - only the stable pair or the pre-release pair actually runs for any given tag, never both.

# Publishing a release

## Stable Releases

* Ensure version in package.json has not been published yet. If already published, increase it (do nto forget package-lock.json). This kind of command be used: `npm version --no-git-tag-version patch`
* Create a tag and potentially a GitHub release
* Check GitHub Action `Publish Extension on tag` workflow has been triggered and is successful
* It is a good habit to upgrade the version after a successful publish, for instance with this kind of command: `npm version --no-git-tag-version patch`

## Pre-Releases

Pre-releases allow testing of new features before a stable release. The Microsoft Marketplace and Open VSX Registry both support pre-release versions.

* Ensure version in package.json reflects the pre-release (e.g., `0.31.0-beta.1`)
* Create a tag with one of the following suffixes: `-alpha`, `-beta`, or `-rc` (e.g., `v0.31.0-beta.1`, `v0.31.0-rc.1`, `v0.31.0-alpha.1`)
* The `Publish Pre-Release Extension` workflow will automatically publish to both marketplaces with the pre-release flag
* The `Pre-Releases` workflow will create a GitHub pre-release with release notes
* Users can opt-in to pre-release versions in VS Code by switching to the pre-release channel in the extensions view

**Note:** Tags without these suffixes (e.g., `v0.31.0`) will trigger stable release workflows instead.

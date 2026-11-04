# Draft GitHub release notes (next release)

Release notes live on the GitHub Releases page (see README "Changelog"), not
in a file. Paste and edit this when cutting the release; delete entries once
shipped.

## Behaviour change: editor settings now apply
`vale.valeCLI.lintOnChange`, `vale.valeCLI.debounceMs` and
`vale.valeCLI.showMetrics` were documented but never reached the language
server, which treats them as ON when unset. You may have been getting
lint-as-you-type and the metrics code lens without asking for them. From this
release the documented defaults apply: Vale lints when you save, and there is
no metrics lens.

To keep the old behaviour, add to your settings:

```json
{
  "vale.valeCLI.lintOnChange": true,
  "vale.valeCLI.showMetrics": true
}
```

Changing any of these now restarts the language server automatically.

## Improvements
- Vale config files (`.vale.ini`, `_vale.ini`, and `.config/vale.ini`, the
  latter supported from Vale 3.25.1) are watched. Creating, editing, or
  deleting one restarts the server so diagnostics in open files refresh.
- **Vale: Show Diagnostics** and the startup log now report the detected
  Vale version. The extension warns when your Vale is too old for the
  `.config/vale.ini` location (needs 3.25.1) or for the filter settings
  (needs 3.10.0).

## Internal
- Removed an unused `.clientrc` file watcher left over from the language
  client template.

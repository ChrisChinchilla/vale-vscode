# The Vale extension for Visual Studio Code

[![Publish Extension on tag](https://github.com/ChrisChinchilla/vale-vscode/actions/workflows/publishTags.yml/badge.svg)](https://github.com/ChrisChinchilla/vale-vscode/actions/workflows/publishTags.yml)

> The Visual Studio Code extension for [Vale](https://github.com/errata-ai/vale).

The Vale extension for Visual Studio Code and editors based on Visual Studio Code such as Cursor provides customizable spelling, style, and grammar checking for a variety of markup formats (Markdown, AsciiDoc, reStructuredText, HTML, and DITA).

## Important notes on switch to Vale Language Server as of v0.30.0

> [!NOTE]
> This new release uses the [Vale Language Server](https://github.com/vale-cli/vale-ls). This allows for tighter integration with Vale features, but does involve more platform specific work and some features of the old extension are harder to implement.
> I based re-development of these features [on this survey](https://github.com/ChrisChinchilla/vale-vscode/discussions/50). If you find features you use no longer working, [open an issue](https://github.com/ChrisChinchilla/vale-vscode/issues/new).

> [!NOTE]
> Custom Vale binary paths are supported as of Vale Language Server v0.5.0 — see `vale.valeCLI.path`.
> That release also tracks every folder in a multi-root workspace and resolves each file against the folder it belongs to, which should address the workspace problems reported here.

## Installation

1. Install [Vale](https://vale.sh/docs/vale-cli/installation/);
2. install `vale-vscode` (this extension) via the [Marketplace](https://marketplace.visualstudio.com/items?itemName=chrischinchilla.vale-vscode);
3. Restart VS Code (recommended).

## Features

At the moment, the extension uses any [configuration](https://vale.sh/docs/topics/config/), [vocabularies](https://vale.sh/docs/topics/vocab/), and [packages](https://vale.sh/docs/topics/packages/) defined in your Vale configuration. If you experience any issues with the extension, check if Vale runs as expected on the command line first.

_In the future, the extension may provide a UI or other configuration options for configuring Vale_.

### Detailed problems view

![Screenshot of problems view](https://user-images.githubusercontent.com/8785025/89956665-76c9fa80-dbea-11ea-9eba-3f272a5a26e5.png)

Browse detailed information for each alert, including the file location, style, and rule ID.

### Go-to rule

**This feature is temporarily disabled due to changes in the Vale CLI. It will be re-enabled in the future.**

![Screenshot of go to rule interface](https://user-images.githubusercontent.com/8785025/89956857-d1635680-dbea-11ea-8e50-8e2715721e5d.png)

Navigate from an in-editor alert to a rule's implementation on your `StylesPath` by clicking "View Rule".

### Quick fixes

![Screenshot of quick fix interface](https://user-images.githubusercontent.com/8785025/89957413-2eabd780-dbec-11ea-97e1-9a04bce950ce.png)

Fix word usage, capitalization, and more using [Quick Fixes](https://code.visualstudio.com/docs/editor/refactoring#_code-actions-quick-fixes-and-refactorings) (macOS: <kbd>cmd</kbd> + <kbd>.</kbd>, Windows/Linux: <kbd>Ctrl</kbd> + <kbd>.</kbd>). The quick fixes feature depends on the underlying rule implementing an action that VS Code can then trigger.

### Spell checking

**You need a [`spelling` style](https://vale.sh/docs/topics/styles/#spelling) in your Vale configuration to enable spell-checking**.

With no additional Vale configuration, the spell checker uses a Hunspell-compatible US English dictionary. If you want to use other custom dictionaries, then configure your [`spelling` style](https://vale.sh/docs/topics/styles/#spelling) with custom dictionaries.

The extension doesn't support adding words to dictionaries. For now, the best option is to add them to ignore files or filters as described in the [Vale documentation](https://vale.sh/docs/topics/styles/#spelling).

### Vale commands

The following commands are available from the **Vale** panel in the Explorer sidebar and from the command palette (<kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>):

- **Vale: Sync** downloads and updates the packages defined in your `.vale.ini` file. You can also enable automatic syncing on startup using the `vale.valeCLI.syncOnStartup` setting (see Settings below).
- **Vale: Install or Update Vale** installs or updates the Vale binary the language server manages.
- **Vale: Show Configuration** runs `vale ls-config` and displays the active Vale configuration in the Vale output panel.
- **Vale: Show Readability Metrics** reports the active file's readability metrics.

### Add to Vale vocabulary

You can add words to [Vale vocabulary lists](https://vale.sh/docs/keys/vocab) direct from the editor. Make sure to set the `vale.vocabPath` setting to name the vocabulary to write to. Find the menus by selecting the word and right-clicking, or set keybindings for the commands.

Spelling alerts also offer this as a quick fix, one per vocabulary defined in your configuration, with no setting required.

## Settings

The extension offers a number of settings and configuration options (_Preferences > Extensions > Vale_).

- `vale.valeCLI.config` (default: `null`): Absolute or relative path to a Vale configuration file.
- `vale.valeCLI.minAlertLevel` (default: `inherited`): Defines from which level of errors and above to display in the problems view.
- `vale.doNotShowWarningForFileToBeSavedBeforeLinting` (default: `false`): Toggle display of warning dialog that you must save a file before Vale lints it.
- `vale.readabilityProblemLocation` (default: `status`): If you have any `Readability` or `metric` styles, the extension can display the readability score in the status bar, the problems view, or both.
- `vale.enableSpellcheck` (default: `false`): Enable in-built spell checking for any `Spelling` styles.
- `vale.valeCLI.syncOnStartup` (default: `false`): If you have packages in a _.vale.ini_ file, then sync them on startup.
- `vale.valeCLI.filter` (default: `null`): Add additional [Vale filters](https://vale.sh/docs/filters).
- `vale.valeCLI.path` (default: `null`): Absolute path to the Vale binary to run, instead of the one the language server manages.
- `vale.valeCLI.lintOnChange` (default: `true`): Lint as you type, rather than only when a file is saved.
- `vale.valeCLI.debounceMs` (default: `300`): How long typing has to settle before linting, in milliseconds.
- `vale.valeCLI.showMetrics` (default: `true`): Show a code lens with the document's metrics (word count, reading time, and so on).

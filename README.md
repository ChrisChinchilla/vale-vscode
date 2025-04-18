# Vale + VS Code

[![Publish Extension on tag](https://github.com/ChrisChinchilla/vale-vscode/actions/workflows/publishTags.yml/badge.svg)](https://github.com/ChrisChinchilla/vale-vscode/actions/workflows/publishTags.yml)
[![Sponsor Chris Chinchilla](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86)](https://github.com/sponsors/chrischinchilla)

The Vale extension for VS Code provides customizable spelling, style, and grammar checking for a variety of markup formats (Markdown, AsciiDoc, reStructuredText, HTML, and DITA).

## Installation

1. Install [Vale](https://vale.sh/docs/vale-cli/installation/);
2. install `vale-vscode` (this extension) via the [Marketplace](https://marketplace.visualstudio.com/items?itemName=chrischinchilla.vale-vscode);
3. Restart VS Code (recommended).

### Install pre-release

_Want to test the pre-release version? Use the "Switch to Pre-Release Version" button on extension page in VSCode._

The current pre-release version is `0.25.1` and uses the old pre LSP implementation for those who experience too many issues with the new version.

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

> As of version 0.17.0, the extension supports spell-checking. The feature is new and likely to change, you can disable it from the settings if you use other spell checkers or experience performance issues.

**You need a [`spelling` style](https://vale.sh/docs/topics/styles/#spelling) in your Vale configuration to enable spell-checking**.

With no additional Vale configuration, the spell checker uses a Hunspell-compatible US English dictionary. If you want to use other custom dictionaries, then configure your [`spelling` style](https://vale.sh/docs/topics/styles/#spelling) with custom dictionaries.

The extension doesn't support adding words to dictionaries. For now, the best option is to add them to ignore files or filters as described in the [Vale documentation](https://vale.sh/docs/topics/styles/#spelling).

## Settings

The extension offers a number of settings and configuration options (_Preferences > Extensions > Vale_).

- `vale.valeCLI.config` (default: `null`): Absolute path to a Vale configuration file. Use the predefined [`${workspaceFolder}`](https://code.visualstudio.com/docs/editor/variables-reference#_predefined-variables) variable to reference configuration file from a custom location. (**NOTE**: On Windows you can use '/' and can omit `.cmd` in the path value.) If not specified, the extension uses the default search process (relative to the current file).

  **Example**

  ```jsonc
  {
    // You can use ${workspaceFolder} it will be replaced by workspace folder path
    "vale.valeCLI.config": "${workspaceFolder}/node_modules/some-package/.vale.ini"

    // or use some absolute path
    "vale.valeCLI.config": "/some/path/to/.vale.ini"
  }
  ```

- `vale.valeCLI.path` (default: `null`): Absolute path to the Vale binary. Use the predefined [`${workspaceFolder}`](https://code.visualstudio.com/docs/editor/variables-reference#_predefined-variables) variable to reference a non-global binary. (**NOTE**: On Windows you can use '/' and can omit `.cmd` in the path value.)

  **Example**

  ```jsonc
  {
    // You can use ${workspaceFolder} it will be replaced by workspace folder path
    "vale.valeCLI.path": "${workspaceFolder}/node_modules/.bin/vale"

    // or use some absolute path
    "vale.valeCLI.path": "/some/path/to/vale"
  }
  ```

- `vale.valeCLI.minAlertLevel` (default: `inherited`): Defines from which level of errors and above to display in the problems view.

- `vale.doNotShowWarningForFileToBeSavedBeforeLinting` (default: `false`): Toggle display of warning dialog that you must save a file before Vale lints it.

- `vale.readabilityProblemLocation` (default: `status`): If you have any `Readability` or `metric` styles, the extension can display the readability score in the status bar, the problems view, or both.

- `vale.enableSpellcheck` (default: `false`): Enable in-built spell checking for any `Spelling` styles.

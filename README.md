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

1. Install [Vale](https://vale.sh/docs/vale-cli/installation/) - **3.10.0 or later** (see note below);
2. install `vale-vscode` (this extension) via the [Marketplace](https://marketplace.visualstudio.com/items?itemName=chrischinchilla.vale-vscode);
3. Restart VS Code (recommended).

> [!NOTE]
> Vale versions before 3.10.0 don't support the raw filter expressions this extension sends for `vale.valeCLI.minAlertLevel`/`vale.enableSpellcheck`, and fail every lint with `filter '...' not found` - with default settings, this happens even if you never touch either setting, since `vale.enableSpellcheck` defaults to `false`. If your Vale CLI predates 3.10.0, the extension shows a warning identifying this on startup.

On first launch the extension downloads the [Vale Language Server](https://github.com/vale-cli/vale-ls) binary, verifies it against a known SHA-256 checksum, and stores it in VS Code's per-extension global storage directory (rather than inside the extension's own install folder). The installed version is recorded alongside the binary, so upgrading the bundled server version triggers a verified replacement automatically.

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

Fix word usage, capitalization, and more using [Quick Fixes](https://code.visualstudio.com/docs/editor/refactoring#_code-actions-quick-fixes-and-refactorings) (macOS: <kbd>cmd</kbd> + <kbd>.</kbd>, Windows/Linux: <kbd>Ctrl</kbd> + <kbd>.</kbd>). The quick fixes feature depends on the underlying rule implementing an action that VS Code can then trigger. A [`substitution`](https://vale.sh/docs/topics/styles/#substitution) rule with multiple `|`-separated alternatives (e.g. `swap: what if|options|more`) offers one quick fix per alternative.

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

These commands (and the vocabulary commands below) honor `vale.valeCLI.config` if it's set, the same way linting does - they don't rely on Vale's own automatic config discovery, which only searches the current directory and its parents and so can't find a config file that lives in a subdirectory.

### Add to Vale vocabulary

You can add words to [Vale vocabulary lists](https://vale.sh/docs/keys/vocab) direct from the editor. Make sure to set the `vale.vocabPath` setting to name the vocabulary to write to. Find the menus by selecting the word and right-clicking, or set keybindings for the commands.

Spelling alerts also offer an "Add to vocabulary" quick fix, one per vocabulary defined in your configuration, which needs no `vale.vocabPath`. Rejecting a word is only available as a command.

### Multi-root workspaces

The extension starts a separate Vale Language Server instance per workspace folder, each scoped to that folder's files. This means:

- Settings such as `vale.valeCLI.config` and `vale.vocabPath` can be set per folder (e.g. in each folder's `.vscode/settings.json`) and are resolved relative to that folder, including `${workspaceFolder}` in `vale.valeCLI.config`.
- Commands run from the **Vale** panel or command palette (**Vale: Sync**, **Vale: Show Configuration**, **Vale: Show Readability Metrics**, and the vocabulary commands) act on the workspace folder containing the currently active file, not always the first folder in the workspace.
- Adding or removing a folder from the workspace starts or stops its Vale Language Server instance automatically, without needing to reload the window.

Changing a setting that affects the Vale Language Server (`vale.enableSpellcheck`, `vale.valeCLI.minAlertLevel`, `vale.valeCLI.config`, `vale.valeCLI.syncOnStartup`, `vale.valeCLI.installVale`, `vale.valeCLI.path`, `vale.docker.enabled`, `vale.docker.image`, `vale.docker.extraArgs`) restarts the affected folder's server instance automatically, without needing to reload the window.

### Using Vale via Docker

Set `vale.docker.enabled` to run `vale` inside a Docker container instead of a local install - useful if you'd rather not install Vale (or its packages/styles) on your machine at all. Requires `docker` on your `$PATH` (Docker Desktop on Windows) and a workspace folder on the local filesystem. Docker mode is ignored in single-file/no-folder windows.

The extension generates a small wrapper script per workspace folder that mounts the folder onto the identical path inside the container and runs `docker run --rm -v <folder>:<folder> -w <folder> <image> ...` (the default `jdkato/vale` image sets `vale` as its entrypoint, so its arguments go straight after the image name). This applies both to the language server's own linting and to the **Vale: Sync**/**Vale: Show Configuration**/**Vale: Show Readability Metrics** commands and vocabulary lookups. While Docker mode is enabled, `vale.valeCLI.installVale` and `vale.valeCLI.path` are ignored. If you use a custom image with a different entrypoint, add `--entrypoint=vale` (or whatever your image needs) to `vale.docker.extraArgs`.

- `vale.docker.image` (default: `jdkato/vale`): the image to run.
- `vale.docker.extraArgs`: extra arguments spliced into `docker run` before the image name, e.g. an additional `-v` mount for a styles directory that lives outside the workspace.

> [!NOTE]
> On Windows, the extension ships native x64 and ARM64 proxy executables because vale-ls cannot invoke a batch-file wrapper. The proxy mounts the Windows workspace at `/workspace` in the Linux container, translates command arguments and JSON output paths in both directions, and invokes `docker.exe` without a shell. Unsupported Windows architectures fall back to `vale.valeCLI.path`, or `vale` on `PATH`, with a warning.

### Workspace Trust

The extension supports [Workspace Trust](https://code.visualstudio.com/docs/editing/workspace-trust) in Restricted Mode ("limited" support): linting and highlighting keep working, but:

- `vale.valeCLI.path`, `vale.valeCLI.config`, `vale.valeCLI.syncOnStartup`, and all of `vale.docker.*` are locked to their user-level value - a workspace-level override (e.g. in `.vscode/settings.json`) is ignored until you trust the workspace.
- **Vale: Sync**, **Vale: Show Configuration**, **Vale: Show Readability Metrics**, and the vocabulary add commands are disabled until you trust the workspace, since they run the Vale executable directly.

Trusting the workspace restores the normal settings and re-enables these commands immediately, with no window reload needed.

### Devcontainers and remote workspaces

The extension runs in VS Code's workspace extension host, so paths in `vale.valeCLI.path` and `vale.valeCLI.config` must be valid inside the devcontainer, WSL distribution, SSH host, or Codespace—not only on the local machine. An interactive shell's `PATH` can differ from the extension host's environment; configure an absolute `vale.valeCLI.path` when in doubt.

Use **Vale: Show Diagnostics** to see the extension-host location, platform/libc, workspace and config paths, selected Vale execution mode, and language-server startup failures. **Vale: Restart Language Server** retries installation if needed and restarts all workspace clients without reloading the window.

Vale Language Server currently publishes GNU-linked Linux binaries. Alpine/musl containers are detected and receive an actionable error; use a glibc-based image until upstream publishes a compatible asset. Docker mode inside an existing devcontainer additionally requires Docker-in-Docker or access to a host Docker daemon—it is not required when Vale is installed directly in the devcontainer.

Maintainers can reproduce issue #54's path setup with `.devcontainer/issue-54/devcontainer.json`, which installs Vale outside the normal `PATH` and supplies its absolute path through remote VS Code settings.

## Settings

The extension offers a number of settings and configuration options (_Preferences > Extensions > Vale_).

- `vale.valeCLI.config` (default: `null`): Absolute or relative path to a Vale configuration file.
- `vale.valeCLI.minAlertLevel` (default: `inherited`): Defines from which level of errors and above to display in the problems view.
- `vale.doNotShowWarningForFileToBeSavedBeforeLinting` (default: `false`): Toggle display of warning dialog that you must save a file before Vale lints it.
- `vale.readabilityProblemLocation` (default: `status`): If you have any `Readability` or `metric` styles, the extension can display the readability score in the status bar, the problems view, or both.
- `vale.enableSpellcheck` (default: `false`): Enable in-built spell checking for any `Spelling` styles.
- `vale.valeCLI.syncOnStartup` (default: `false`): If you have packages in a _.vale.ini_ file, then sync them on startup.
- `vale.valeCLI.filter` (default: `null`): Add additional [Vale filters](https://vale.sh/docs/filters).
- `vale.valeCLI.path` (default: `null`): Absolute path to the Vale binary to run, instead of the one the language server manages. Ignored when `vale.docker.enabled` is true.
- `vale.docker.enabled` (default: `false`): Run Vale inside a Docker container instead of a local install. See [Using Vale via Docker](#using-vale-via-docker) above.
- `vale.docker.image` (default: `jdkato/vale`): Docker image to run Vale from.
- `vale.docker.extraArgs` (default: `[]`): Extra arguments spliced into `docker run` before the image name.
- `vale.valeCLI.lintOnChange` (default: `false`): Lint as you type, rather than only when a file is saved.
- `vale.valeCLI.debounceMs` (default: `300`): How long typing has to settle before linting, in milliseconds. Only applies when `vale.valeCLI.lintOnChange` is enabled.
- `vale.valeCLI.showMetrics` (default: `false`): Show a code lens with the document's metrics (word count, reading time, and so on).

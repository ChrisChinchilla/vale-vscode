import * as vscode from "vscode";
import * as path from "path";
import { ExtensionContext } from "vscode";

import { getInstallDir, hasActiveClients, syncViaLanguageServer } from "./languageServer";
import { getRelevantWorkspaceFolder } from "./workspaceFolders";
import { addToVocabulary } from "./vocabulary";
import {
  ValeCommandCancelledError,
  getFileMetrics,
  getValeVersionOutput,
  runValeCommand,
  runValeCommandCapture,
} from "./cli";
import {
  clearReadabilityResult,
  getValeOutputChannel,
  showReadabilityResult,
} from "./ui";
import { resolveValeExecutionOptions, resolveValeSourceForFolder } from "./config";
import {
  buildValeConfigArgs,
  computeFleschKincaidGrade,
  describeValeVersion,
  formatConfigOutput,
  resolveConfigPath,
  shouldWarnBeforeLinting,
  toConfigSettingValue,
  shouldSyncViaLanguageServer,
} from "./utils";
import type { ValeExecutionOptions } from "./utils";
import { getWindowsDockerProxy } from "./docker";

/**
 * Resolves `vale.valeCLI.config` the same way `buildValeConfig` does for
 * vale-ls's `initializationOptions` (`config.ts`), so direct CLI commands
 * (Sync/Show Configuration/Show Readability Metrics/vocabulary lookups) stop
 * relying on Vale's own ancestor-search config discovery, which linting
 * doesn't depend on but these commands previously did entirely. See
 * https://github.com/ChrisChinchilla/vale-vscode/issues/100.
 */
function resolveCommandConfigPath(
  configuration: vscode.WorkspaceConfiguration,
  workspaceRoot: string | undefined
): string {
  const configPathRaw = configuration.get<string>("vale.valeCLI.config") || "";
  return resolveConfigPath(configPathRaw, workspaceRoot);
}

/**
 * These explicit actions can download packages or read/write workspace-linked
 * resources. Their executable/configuration settings are already locked to
 * user-level values in Restricted Mode (see `capabilities.untrustedWorkspaces`
 * in package.json); blocking the actions as well prevents surprising side
 * effects from an untrusted workspace. See .claude/notes/workspace-trust.md and
 * https://github.com/ChrisChinchilla/vale-vscode/issues/54.
 */
function requireTrustedWorkspace(): boolean {
  if (vscode.workspace.isTrusted) return true;
  vscode.window
    .showWarningMessage(
      "Vale: this command requires a trusted workspace.",
      "Manage Workspace Trust"
    )
    .then((choice) => {
      if (choice === "Manage Workspace Trust") {
        vscode.commands.executeCommand("workbench.action.manageTrust");
      }
    });
  return false;
}

/**
 * Direct CLI commands (Show Readability Metrics, in practice) read a file
 * from disk, not the editor buffer, so an unsaved document silently
 * produces stale results. Warns and offers to save first, unless
 * `vale.doNotShowWarningForFileToBeSavedBeforeLinting` suppresses it.
 * Returns whether the caller should proceed.
 */
async function confirmSavedBeforeLinting(
  document: vscode.TextDocument,
  configuration: vscode.WorkspaceConfiguration
): Promise<boolean> {
  const doNotShowWarning =
    configuration.get<boolean>(
      "vale.doNotShowWarningForFileToBeSavedBeforeLinting"
    ) ?? false;

  if (!shouldWarnBeforeLinting(document.isDirty, doNotShowWarning)) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    "Vale: this file has unsaved changes. Vale reads the file from disk, so results may not reflect your edits.",
    "Save and Continue",
    "Cancel"
  );

  if (choice !== "Save and Continue") return false;
  return document.save();
}

function resolveCommandExecution(
  configuration: vscode.WorkspaceConfiguration,
  workspaceRoot: string | undefined,
  context: ExtensionContext
): ValeExecutionOptions {
  const windowsProxy =
    process.platform === "win32" ? getWindowsDockerProxy(context) : undefined;
  const execution = resolveValeExecutionOptions(
    configuration,
    workspaceRoot,
    getInstallDir(context),
    process.platform,
    windowsProxy?.path,
    windowsProxy?.unavailableReason
  );
  if (execution.dockerUnavailableReason) {
    vscode.window.showWarningMessage(`Vale: ${execution.dockerUnavailableReason}`);
  }
  return execution;
}

/** Formats a caught value as an error message, without assuming it's an `Error`. */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Shows a caught error the same way across every command: `Vale: <verb> - <message>`. */
function showCommandError(verb: string, error: unknown): void {
  vscode.window.showErrorMessage(`Vale: ${verb} - ${formatError(error)}`);
}

interface CommandContext {
  folder: vscode.WorkspaceFolder | undefined;
  configuration: vscode.WorkspaceConfiguration;
  execution: ValeExecutionOptions;
  configPath: string;
  noGlobal: boolean;
  workingDir: string;
  /** True when Sync should go through the language server (see `shouldSyncViaLanguageServer`). */
  syncViaLanguageServer: boolean;
}

/**
 * Resolves the workspace folder, settings, execution mode, and config path
 * every direct CLI command needs, all scoped consistently to the same
 * folder. Returns `undefined` when the workspace folder is ambiguous (more
 * than one folder, no active-editor folder to infer from) and the user
 * cancelled `getRelevantWorkspaceFolder`'s disambiguation prompt - callers
 * should abort in that case rather than guess.
 */
async function resolveCommandContext(
  context: ExtensionContext,
  fallbackWorkingDir: string
): Promise<CommandContext | undefined> {
  const folder = await getRelevantWorkspaceFolder();
  const folders = vscode.workspace.workspaceFolders;
  if (!folder && folders && folders.length > 1) {
    return undefined;
  }

  const configuration = vscode.workspace.getConfiguration(undefined, folder?.uri);
  const execution = resolveCommandExecution(configuration, folder?.uri.fsPath, context);
  const configPath = resolveCommandConfigPath(configuration, folder?.uri.fsPath);
  const noGlobal = configuration.get<boolean>("vale.valeCLI.noGlobal") ?? false;
  const workingDir = folder?.uri.fsPath ?? fallbackWorkingDir;
  const source = resolveValeSourceForFolder(
    configuration,
    folder?.uri.fsPath,
    getInstallDir(context)
  );
  const syncViaLanguageServer = shouldSyncViaLanguageServer({
    explicit: configuration.get<boolean>("vale.valeCLI.syncViaLanguageServer") ?? false,
    dockerActive: Boolean(execution.docker),
    source: source.source,
    alwaysManaged: configuration.get<boolean>("vale.valeCLI.installVale") ?? false,
  });

  return {
    folder,
    configuration,
    execution,
    configPath,
    noGlobal,
    workingDir,
    syncViaLanguageServer,
  };
}

/**
 * Registers all user-facing Vale commands (command palette and the editor
 * context menu).
 */
export function registerCommands(
  context: ExtensionContext,
  restartLanguageServer: () => Promise<void>,
  ensureLanguageServerStarted: () => Promise<void>
): void {
  const valeOutputChannel = getValeOutputChannel();

  /**
   * Shared handler behind both **Add to Accept List** and **Add to Reject
   * List** - the two commands only ever differed in which vocabulary file
   * they write to.
   */
  const addSelectionToVocabulary = (fileName: "accept.txt" | "reject.txt") =>
    async (): Promise<void> => {
      if (!requireTrustedWorkspace()) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Vale: No active editor");
        return;
      }

      const word = editor.document.getText(editor.selection).trim();
      if (!word) {
        vscode.window.showErrorMessage("Vale: No text selected");
        return;
      }

      const cmdContext = await resolveCommandContext(
        context,
        path.dirname(editor.document.uri.fsPath)
      );
      if (!cmdContext) return;

      const vocabPath = cmdContext.configuration.get<string>("vale.vocabPath");
      if (!vocabPath) {
        vscode.window.showErrorMessage(
          "Vale: Please set vale.vocabPath in your settings to use vocabulary features"
        );
        return;
      }

      try {
        await addToVocabulary(
          word,
          vocabPath,
          fileName,
          cmdContext.workingDir,
          cmdContext.execution,
          cmdContext.configPath,
          cmdContext.noGlobal
        );
      } catch (error) {
        showCommandError("Failed to add word", error);
      }
    };

  const addToAcceptCommand = vscode.commands.registerCommand(
    "vale.addToAcceptList",
    addSelectionToVocabulary("accept.txt")
  );

  const addToRejectCommand = vscode.commands.registerCommand(
    "vale.addToRejectList",
    addSelectionToVocabulary("reject.txt")
  );

  // Sync through the language server's `cli.sync`: it can't be cancelled and
  // only reports the final result (as a message from the server), but it uses
  // exactly the Vale and configuration the server lints with.
  let languageServerSyncRunning = false;
  const runSyncViaLanguageServer = async (folder: vscode.WorkspaceFolder | undefined) => {
    if (languageServerSyncRunning) {
      vscode.window.showInformationMessage("Vale: a sync is already running.");
      return;
    }
    languageServerSyncRunning = true;
    try {
      valeOutputChannel.appendLine("\nRunning vale sync through the language server...\n");
      if (!hasActiveClients()) {
        await ensureLanguageServerStarted();
      }
      const ran = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Vale: Syncing packages",
        },
        () => syncViaLanguageServer(folder)
      );
      if (!ran) {
        vscode.window.showWarningMessage(
          "Vale: the language server is not running for this folder. Run Vale: Restart Language Server first."
        );
        return;
      }
      valeOutputChannel.appendLine("Language server finished syncing.");
    } catch (error) {
      valeOutputChannel.show(true);
      showCommandError("Sync failed", error);
    } finally {
      languageServerSyncRunning = false;
    }
  };

  // Helper function to run vale sync
  const runValeSync = async () => {
    if (!requireTrustedWorkspace()) return;

    const cmdContext = await resolveCommandContext(context, process.cwd());
    if (!cmdContext) return;

    if (cmdContext.syncViaLanguageServer) {
      await runSyncViaLanguageServer(cmdContext.folder);
      return;
    }

    try {
      valeOutputChannel.appendLine("\nRunning vale sync...\n");

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Vale: Syncing packages",
          cancellable: true,
        },
        (_progress, token) =>
          runValeCommand(
            [...buildValeConfigArgs(cmdContext.configPath, cmdContext.noGlobal), "sync"],
            cmdContext.workingDir,
            cmdContext.execution,
            token
          )
      );

      valeOutputChannel.appendLine("\nSync completed successfully.");
      vscode.window.setStatusBarMessage("Vale: Sync completed", 4000);
    } catch (error) {
      if (error instanceof ValeCommandCancelledError) {
        valeOutputChannel.appendLine("\nSync cancelled.");
        vscode.window.setStatusBarMessage("Vale: Sync cancelled", 4000);
        return;
      }
      valeOutputChannel.show(true);
      console.error("Vale sync failed:", error);
      showCommandError("Sync failed", error);
    }
  };

  // Register vale.sync command
  const syncCommand = vscode.commands.registerCommand("vale.sync", runValeSync);

  // Register vale.showConfig command - runs `vale ls-config` and opens the
  // result as JSON in an editor tab
  const showConfigCommand = vscode.commands.registerCommand(
    "vale.showConfig",
    async () => {
      if (!requireTrustedWorkspace()) return;

      const cmdContext = await resolveCommandContext(context, process.cwd());
      if (!cmdContext) return;

      try {
        valeOutputChannel.appendLine("\nRunning vale ls-config...\n");

        const output = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Window,
            title: "Vale: Reading configuration",
          },
          () =>
            runValeCommandCapture(
              [...buildValeConfigArgs(cmdContext.configPath, cmdContext.noGlobal), "ls-config"],
              cmdContext.workingDir,
              cmdContext.execution
            )
        );

        const { content, language } = formatConfigOutput(output);
        const document = await vscode.workspace.openTextDocument({ content, language });
        await vscode.window.showTextDocument(document, { preview: true });
      } catch (error) {
        valeOutputChannel.show(true);
        showCommandError("Failed to show configuration", error);
      }
    }
  );

  // Register vale.selectConfigFile - picks the file stored in vale.valeCLI.config
  const selectConfigFileCommand = vscode.commands.registerCommand(
    "vale.selectConfigFile",
    async () => {
      if (!requireTrustedWorkspace()) return;

      const folder = await getRelevantWorkspaceFolder();
      const folders = vscode.workspace.workspaceFolders;
      // A cancelled folder prompt in a multi-root window means "abort".
      if (!folder && folders && folders.length > 1) return;

      const choice = await vscode.window.showQuickPick(
        [
          { label: "$(file) Choose a Vale configuration file...", action: "choose" },
          {
            label: "$(discard) Use Vale's automatic discovery",
            description: "Clears vale.valeCLI.config",
            action: "clear",
          },
        ],
        { placeHolder: "Select the Vale configuration file to use" }
      );
      if (!choice) return;

      let value: string | undefined;
      if (choice.action === "choose") {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          defaultUri: folder?.uri,
          openLabel: "Use as Vale configuration",
          filters: { "Vale configuration": ["ini"], "All files": ["*"] },
        });
        if (!picked || picked.length === 0) return;
        value = toConfigSettingValue(picked[0].fsPath, folder?.uri.fsPath);
      }

      // Folder-level settings only exist in multi-root windows; a
      // single-folder window stores them with the workspace.
      const target =
        folder && folders && folders.length > 1
          ? vscode.ConfigurationTarget.WorkspaceFolder
          : folder
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
      try {
        await vscode.workspace
          .getConfiguration(undefined, folder?.uri)
          .update("vale.valeCLI.config", value, target);
        // The language server restarts itself when this setting changes.
        vscode.window.setStatusBarMessage(
          value
            ? `Vale: Using configuration ${value}`
            : "Vale: Using automatic configuration discovery",
          4000
        );
      } catch (error) {
        showCommandError("Failed to update the configuration setting", error);
      }
    }
  );

  // Register vale.showMetrics command - runs `vale ls-metrics` on the active file
  const showMetricsCommand = vscode.commands.registerCommand(
    "vale.showMetrics",
    async () => {
      if (!requireTrustedWorkspace()) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Vale: No active editor");
        return;
      }

      const filePath = editor.document.uri.fsPath;

      const cmdContext = await resolveCommandContext(context, path.dirname(filePath));
      if (!cmdContext) return;

      if (!(await confirmSavedBeforeLinting(editor.document, cmdContext.configuration))) {
        return;
      }

      try {
        valeOutputChannel.show(true);
        valeOutputChannel.appendLine(
          `\nRunning vale ls-metrics for ${path.basename(filePath)}...\n`
        );

        const metrics = await getFileMetrics(
          filePath,
          cmdContext.workingDir,
          cmdContext.execution,
          cmdContext.configPath,
          cmdContext.noGlobal
        );

        if (!metrics) {
          throw new Error("vale ls-metrics produced no output");
        }

        valeOutputChannel.appendLine(JSON.stringify(metrics, null, 2));

        const grade = computeFleschKincaidGrade(
          metrics.words,
          metrics.sentences,
          metrics.syllables
        );
        const location =
          cmdContext.configuration.get<string>("vale.readabilityProblemLocation") ??
          "status";

        if (grade === null) {
          clearReadabilityResult(editor.document.uri);
        } else {
          valeOutputChannel.appendLine(
            `Flesch-Kincaid grade level: ${grade.toFixed(1)}`
          );
          showReadabilityResult(editor.document.uri, grade, location);
        }
      } catch (error) {
        showCommandError("Failed to show metrics", error);
      }
    }
  );

  // Register vale.install - runs vale-ls's own `cli.install`, which the
  // language-server module re-registers as a VS Code command routed to the
  // active editor's folder. The server installs or updates the Vale it
  // manages and reports the outcome itself ("Vale is up to date.", "Vale vX
  // installed."); with `vale.valeCLI.path`, Docker, or a Vale on PATH (the
  // default) it reports that it is skipping the install instead, since it
  // isn't the one running that Vale.
  const installValeCommand = vscode.commands.registerCommand(
    "vale.install",
    async () => {
      if (!hasActiveClients()) {
        await ensureLanguageServerStarted();
      }
      if (!hasActiveClients()) {
        vscode.window.showWarningMessage(
          "Vale: the language server is not running. Run Vale: Restart Language Server first."
        );
        return;
      }
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Window,
            title: "Vale: Installing or updating Vale",
          },
          () => Promise.resolve(vscode.commands.executeCommand("cli.install"))
        );
      } catch (error) {
        valeOutputChannel.show(true);
        showCommandError("Failed to install Vale", error);
      }
    }
  );

  const showDiagnosticsCommand = vscode.commands.registerCommand(
    "vale.showDiagnostics",
    async () => {
      valeOutputChannel.show(true);
      // The startup log has the version too, but a fresh probe reflects a
      // Vale upgraded since then. Skipped in an untrusted workspace, since it
      // runs the (workspace-configurable) Vale executable.
      if (!vscode.workspace.isTrusted) {
        valeOutputChannel.appendLine(
          "[diagnostics] Vale version not checked: workspace is not trusted"
        );
        return;
      }
      const cmdContext = await resolveCommandContext(
        context,
        vscode.window.activeTextEditor
          ? path.dirname(vscode.window.activeTextEditor.document.uri.fsPath)
          : process.cwd()
      );
      if (!cmdContext) return;
      const output = await getValeVersionOutput(
        cmdContext.workingDir,
        cmdContext.execution
      );
      valeOutputChannel.appendLine(
        `[diagnostics] ${describeValeVersion(output)} (${cmdContext.workingDir})`
      );
    }
  );

  const restartLanguageServerCommand = vscode.commands.registerCommand(
    "vale.restartLanguageServer",
    async () => {
      valeOutputChannel.show(true);
      valeOutputChannel.appendLine("[diagnostics] Restart requested by user");
      try {
        await restartLanguageServer();
        vscode.window.setStatusBarMessage("Vale: Language Server restarted", 4000);
      } catch (error) {
        valeOutputChannel.appendLine(
          `[diagnostics] Restart failed: ${formatError(error)}`
        );
        showCommandError("Failed to restart Language Server", error);
      }
    }
  );

  context.subscriptions.push(
    addToAcceptCommand,
    addToRejectCommand,
    syncCommand,
    showConfigCommand,
    selectConfigFileCommand,
    showMetricsCommand,
    installValeCommand,
    showDiagnosticsCommand,
    restartLanguageServerCommand
  );
}

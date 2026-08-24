import * as vscode from "vscode";
import * as path from "path";
import { ExtensionContext } from "vscode";

import { getRelevantWorkspaceFolder } from "./workspaceFolders";
import { addToVocabulary } from "./vocabulary";
import { runValeCommand } from "./cli";
import { getValeOutputChannel, registerValeCommandsTreeView } from "./ui";
import { resolveValeExecutionOptions } from "./config";
import { buildValeConfigArgs, resolveConfigPath } from "./utils";
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
  if (!workspaceRoot) return configPathRaw;
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
    process.platform,
    windowsProxy?.path,
    windowsProxy?.unavailableReason
  );
  if (execution.dockerUnavailableReason) {
    vscode.window.showWarningMessage(`Vale: ${execution.dockerUnavailableReason}`);
  }
  return execution;
}

/**
 * Registers all user-facing Vale commands (command palette, editor context
 * menu, and the "Vale" Explorer sidebar tree view).
 */
export function registerCommands(
  context: ExtensionContext,
  restartLanguageServer: () => Promise<void>
): void {
  const valeOutputChannel = getValeOutputChannel();

  // Register vocabulary commands
  const addToAcceptCommand = vscode.commands.registerCommand(
    "vale.addToAcceptList",
    async () => {
      if (!requireTrustedWorkspace()) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const selection = editor.selection;
      const word = editor.document.getText(selection).trim();

      if (!word) {
        vscode.window.showErrorMessage("No text selected");
        return;
      }

      // Get vocabulary path from settings, scoped to the folder containing
      // the active file so multi-root per-folder overrides are respected
      const folder = getRelevantWorkspaceFolder();
      const configuration = vscode.workspace.getConfiguration(undefined, folder?.uri);
      const vocabPath = configuration.get<string>("vale.vocabPath");
      if (!vocabPath) {
        vscode.window.showErrorMessage(
          "Please set vale.vocabPath in your settings to use vocabulary features"
        );
        return;
      }

      try {
        const workingDir = folder?.uri.fsPath ??
                          path.dirname(editor.document.uri.fsPath);
        const execution = resolveCommandExecution(
          configuration,
          folder?.uri.fsPath,
          context
        );
        const configPath = resolveCommandConfigPath(
          configuration,
          folder?.uri.fsPath
        );
        await addToVocabulary(
          word,
          vocabPath,
          "accept.txt",
          workingDir,
          execution,
          configPath
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to add word: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  const addToRejectCommand = vscode.commands.registerCommand(
    "vale.addToRejectList",
    async () => {
      if (!requireTrustedWorkspace()) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const selection = editor.selection;
      const word = editor.document.getText(selection).trim();

      if (!word) {
        vscode.window.showErrorMessage("No text selected");
        return;
      }

      // Get vocabulary path from settings, scoped to the folder containing
      // the active file so multi-root per-folder overrides are respected
      const folder = getRelevantWorkspaceFolder();
      const configuration = vscode.workspace.getConfiguration(undefined, folder?.uri);
      const vocabPath = configuration.get<string>("vale.vocabPath");
      if (!vocabPath) {
        vscode.window.showErrorMessage(
          "Please set vale.vocabPath in your settings to use vocabulary features"
        );
        return;
      }

      try {
        const workingDir = folder?.uri.fsPath ??
                          path.dirname(editor.document.uri.fsPath);
        const execution = resolveCommandExecution(
          configuration,
          folder?.uri.fsPath,
          context
        );
        const configPath = resolveCommandConfigPath(
          configuration,
          folder?.uri.fsPath
        );
        await addToVocabulary(
          word,
          vocabPath,
          "reject.txt",
          workingDir,
          execution,
          configPath
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to add word: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // Helper function to run vale sync
  const runValeSync = async () => {
    if (!requireTrustedWorkspace()) return;

    try {
      const folder = getRelevantWorkspaceFolder();
      const workingDir = folder?.uri.fsPath ?? process.cwd();
      const configuration = vscode.workspace.getConfiguration(undefined, folder?.uri);
      const execution = resolveCommandExecution(
        configuration,
        folder?.uri.fsPath,
        context
      );
      const configPath = resolveCommandConfigPath(
        configuration,
        folder?.uri.fsPath
      );

      valeOutputChannel.show(true);
      valeOutputChannel.appendLine("\nRunning vale sync...\n");

      await runValeCommand(
        [...buildValeConfigArgs(configPath), "sync"],
        workingDir,
        execution
      );

      valeOutputChannel.appendLine("\nSync completed successfully.");
      vscode.window.showInformationMessage("Vale: Sync completed successfully");
    } catch (error) {
      console.error("Vale sync failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Vale: Sync failed - ${errorMessage}`);
    }
  };

  // Register vale.sync command
  const syncCommand = vscode.commands.registerCommand("vale.sync", runValeSync);

  // Register vale.showConfig command - runs `vale ls-config` and shows output
  const showConfigCommand = vscode.commands.registerCommand(
    "vale.showConfig",
    async () => {
      if (!requireTrustedWorkspace()) return;

      try {
        const folder = getRelevantWorkspaceFolder();
        const workingDir = folder?.uri.fsPath ?? process.cwd();
        const configuration = vscode.workspace.getConfiguration(undefined, folder?.uri);
        const execution = resolveCommandExecution(
          configuration,
          folder?.uri.fsPath,
          context
        );
        const configPath = resolveCommandConfigPath(
          configuration,
          folder?.uri.fsPath
        );

        valeOutputChannel.show(true);
        valeOutputChannel.appendLine("\nRunning vale ls-config...\n");

        await runValeCommand(
          [...buildValeConfigArgs(configPath), "ls-config"],
          workingDir,
          execution
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Vale: Failed to show configuration - ${error instanceof Error ? error.message : String(error)}`
        );
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

      try {
        const folder = getRelevantWorkspaceFolder();
        const workingDir = folder?.uri.fsPath ?? path.dirname(filePath);
        const configuration = vscode.workspace.getConfiguration(undefined, folder?.uri);
        const execution = resolveCommandExecution(
          configuration,
          folder?.uri.fsPath,
          context
        );
        const configPath = resolveCommandConfigPath(
          configuration,
          folder?.uri.fsPath
        );

        valeOutputChannel.show(true);
        valeOutputChannel.appendLine(
          `\nRunning vale ls-metrics for ${path.basename(filePath)}...\n`
        );

        await runValeCommand(
          [...buildValeConfigArgs(configPath), "ls-metrics", filePath],
          workingDir,
          execution
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Vale: Failed to show metrics - ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  const showDiagnosticsCommand = vscode.commands.registerCommand(
    "vale.showDiagnostics",
    () => valeOutputChannel.show(true)
  );

  const restartLanguageServerCommand = vscode.commands.registerCommand(
    "vale.restartLanguageServer",
    async () => {
      valeOutputChannel.show(true);
      valeOutputChannel.appendLine("[diagnostics] Restart requested by user");
      try {
        await restartLanguageServer();
        vscode.window.showInformationMessage(
          "Vale: Language Server restarted successfully"
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        valeOutputChannel.appendLine(`[diagnostics] Restart failed: ${detail}`);
        vscode.window.showErrorMessage(
          `Vale: Failed to restart Language Server - ${detail}`
        );
      }
    }
  );

  // Register the Vale commands TreeView in the Explorer sidebar
  registerValeCommandsTreeView(context);

  context.subscriptions.push(
    addToAcceptCommand,
    addToRejectCommand,
    syncCommand,
    showConfigCommand,
    showMetricsCommand,
    showDiagnosticsCommand,
    restartLanguageServerCommand
  );
}

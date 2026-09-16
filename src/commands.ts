import * as vscode from "vscode";
import * as path from "path";
import { ExtensionContext } from "vscode";

import { getRelevantWorkspaceFolder } from "./workspaceFolders";
import { addToVocabulary } from "./vocabulary";
import { getFileMetrics, runValeCommand } from "./cli";
import {
  clearReadabilityResult,
  getValeOutputChannel,
  registerValeCommandsTreeView,
  showReadabilityResult,
} from "./ui";
import { resolveValeExecutionOptions } from "./config";
import {
  buildValeConfigArgs,
  computeFleschKincaidGrade,
  resolveConfigPath,
  shouldWarnBeforeLinting,
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
  workingDir: string;
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
  const workingDir = folder?.uri.fsPath ?? fallbackWorkingDir;

  return { folder, configuration, execution, configPath, workingDir };
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
          cmdContext.configPath
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

  // Helper function to run vale sync
  const runValeSync = async () => {
    if (!requireTrustedWorkspace()) return;

    const cmdContext = await resolveCommandContext(context, process.cwd());
    if (!cmdContext) return;

    try {
      valeOutputChannel.show(true);
      valeOutputChannel.appendLine("\nRunning vale sync...\n");

      await runValeCommand(
        [...buildValeConfigArgs(cmdContext.configPath), "sync"],
        cmdContext.workingDir,
        cmdContext.execution
      );

      valeOutputChannel.appendLine("\nSync completed successfully.");
      vscode.window.showInformationMessage("Vale: Sync completed successfully");
    } catch (error) {
      console.error("Vale sync failed:", error);
      showCommandError("Sync failed", error);
    }
  };

  // Register vale.sync command
  const syncCommand = vscode.commands.registerCommand("vale.sync", runValeSync);

  // Register vale.showConfig command - runs `vale ls-config` and shows output
  const showConfigCommand = vscode.commands.registerCommand(
    "vale.showConfig",
    async () => {
      if (!requireTrustedWorkspace()) return;

      const cmdContext = await resolveCommandContext(context, process.cwd());
      if (!cmdContext) return;

      try {
        valeOutputChannel.show(true);
        valeOutputChannel.appendLine("\nRunning vale ls-config...\n");

        await runValeCommand(
          [...buildValeConfigArgs(cmdContext.configPath), "ls-config"],
          cmdContext.workingDir,
          cmdContext.execution
        );
      } catch (error) {
        showCommandError("Failed to show configuration", error);
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
          cmdContext.configPath
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
        valeOutputChannel.appendLine(
          `[diagnostics] Restart failed: ${formatError(error)}`
        );
        showCommandError("Failed to restart Language Server", error);
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

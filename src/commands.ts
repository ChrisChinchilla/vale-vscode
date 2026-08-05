import * as vscode from "vscode";
import * as path from "path";
import { ExtensionContext } from "vscode";

import { getRelevantWorkspaceFolder } from "./workspaceFolders";
import { addToVocabulary } from "./vocabulary";
import { runValeCommand } from "./cli";
import { getValeOutputChannel, registerValeCommandsTreeView } from "./ui";

/**
 * Registers all user-facing Vale commands (command palette, editor context
 * menu, and the "Vale" Explorer sidebar tree view).
 */
export function registerCommands(context: ExtensionContext): void {
  const valeOutputChannel = getValeOutputChannel();

  // Register vocabulary commands
  const addToAcceptCommand = vscode.commands.registerCommand(
    "vale.addToAcceptList",
    async () => {
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
        await addToVocabulary(word, vocabPath, "accept.txt", workingDir);
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
        await addToVocabulary(word, vocabPath, "reject.txt", workingDir);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to add word: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // Helper function to run vale sync
  const runValeSync = async () => {
    try {
      const workingDir =
        getRelevantWorkspaceFolder()?.uri.fsPath ?? process.cwd();

      valeOutputChannel.clear();
      valeOutputChannel.show(true);
      valeOutputChannel.appendLine("Running vale sync...\n");

      await runValeCommand(["sync"], workingDir);

      valeOutputChannel.appendLine("\nSync completed successfully.");
      vscode.window.showInformationMessage("Vale: Sync completed successfully");
    } catch (error: any) {
      console.error("Vale sync failed:", error);
      const errorMessage = error.message || String(error);
      vscode.window.showErrorMessage(`Vale: Sync failed - ${errorMessage}`);
    }
  };

  // Register vale.sync command
  const syncCommand = vscode.commands.registerCommand("vale.sync", runValeSync);

  // Register vale.showConfig command - runs `vale ls-config` and shows output
  const showConfigCommand = vscode.commands.registerCommand(
    "vale.showConfig",
    async () => {
      try {
        const workingDir =
          getRelevantWorkspaceFolder()?.uri.fsPath ?? process.cwd();

        valeOutputChannel.clear();
        valeOutputChannel.show(true);
        valeOutputChannel.appendLine("Running vale ls-config...\n");

        await runValeCommand(["ls-config"], workingDir);
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
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Vale: No active editor");
        return;
      }

      const filePath = editor.document.uri.fsPath;

      try {
        const workingDir =
          getRelevantWorkspaceFolder()?.uri.fsPath ?? path.dirname(filePath);

        valeOutputChannel.clear();
        valeOutputChannel.show(true);
        valeOutputChannel.appendLine(
          `Running vale ls-metrics for ${path.basename(filePath)}...\n`
        );

        await runValeCommand(["ls-metrics", filePath], workingDir);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Vale: Failed to show metrics - ${error instanceof Error ? error.message : String(error)}`
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
    showMetricsCommand
  );
}

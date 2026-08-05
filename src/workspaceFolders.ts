import * as vscode from "vscode";

/**
 * Folder-identity helpers shared between language server client management
 * (`languageServer.ts`) and command handlers (`commands.ts`), so both agree
 * on which workspace folder a given piece of work belongs to.
 */

export function noFolderClientKey(): string {
  return "__no_workspace_folder__";
}

export function clientKeyFor(folder?: vscode.WorkspaceFolder): string {
  return folder ? folder.uri.toString() : noFolderClientKey();
}

/**
 * Picks the workspace folder a command should act on: the folder containing
 * the active editor's document if there is one, otherwise the first
 * workspace folder.
 */
export function getRelevantWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const folder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (folder) {
      return folder;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

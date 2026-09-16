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
 * the active editor's document if there is one. Otherwise, with exactly one
 * workspace folder there's nothing to choose, so it's returned directly;
 * with more than one, silently defaulting to the first would be a guess, so
 * this prompts instead.
 */
export async function getRelevantWorkspaceFolder(): Promise<
  vscode.WorkspaceFolder | undefined
> {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const folder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (folder) {
      return folder;
    }
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length <= 1) {
    return folders?.[0];
  }

  return vscode.window.showWorkspaceFolderPick({
    placeHolder: "Select the workspace folder this Vale command should act on",
  });
}

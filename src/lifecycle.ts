import { ExtensionContext } from "vscode";

import { createValeOutputChannel } from "./ui";
import {
  ensureLanguageServerBinary,
  hasActiveClients,
  registerWorkspaceFolderWatcher,
  startClientsForCurrentWorkspace,
  stopAllClients,
} from "./languageServer";
import { registerCommands } from "./commands";
import { registerCodeActions } from "./codeActions";

/**
 * Extension activation/deactivation - wires the other modules together but
 * contains no logic of its own.
 */
export async function activate(context: ExtensionContext): Promise<void> {
  createValeOutputChannel(context);

  // Prevent multiple activations - stop existing clients if present
  if (hasActiveClients()) {
    console.log("Vale language clients already active, stopping existing clients");
    await stopAllClients();
  }

  const serverPath = await ensureLanguageServerBinary(context);

  console.log("Starting language server(s)");
  await startClientsForCurrentWorkspace(serverPath);
  registerWorkspaceFolderWatcher(context, serverPath);

  registerCommands(context);
  registerCodeActions(context);

  // Note: we don't run `vale sync` here even when `vale.valeCLI.syncOnStartup`
  // is enabled - that setting is passed to vale-ls via `initializationOptions`
  // (see `buildValeConfig` in config.ts), and vale-ls already runs `vale sync`
  // itself on startup when it's set. Doing it here too ran sync twice on
  // every startup.
}

export async function deactivate(): Promise<void> {
  await stopAllClients();
  console.log("Vale language server(s) stopped");
}

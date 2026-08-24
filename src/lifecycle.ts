import * as vscode from "vscode";
import { ExtensionContext } from "vscode";

import { createValeOutputChannel } from "./ui";
import {
  ensureLanguageServerBinary,
  hasActiveClients,
  registerConfigurationWatcher,
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
  const output = createValeOutputChannel(context);
  const report = process.report?.getReport();
  const glibc =
    report && typeof report !== "string"
      ? (report as { header?: { glibcVersionRuntime?: string } }).header
          ?.glibcVersionRuntime ?? "not detected"
      : "not detected";
  output.appendLine(
    `[diagnostics] Extension host: ${vscode.env.remoteName ?? "local"}; platform: ${process.platform}/${process.arch}; glibc: ${glibc}; trusted: ${vscode.workspace.isTrusted}`
  );

  // Prevent multiple activations - stop existing clients if present
  if (hasActiveClients()) {
    console.log("Vale language clients already active, stopping existing clients");
    await stopAllClients();
  }

  let watchersRegistered = false;
  const startLanguageServer = async () => {
    const serverPath = await ensureLanguageServerBinary(context);
    await startClientsForCurrentWorkspace(serverPath, context);
    if (!watchersRegistered) {
      registerWorkspaceFolderWatcher(context, serverPath);
      registerConfigurationWatcher(context, serverPath);
      watchersRegistered = true;
    }
  };

  registerCommands(context, startLanguageServer);
  registerCodeActions(context);

  console.log("Starting language server(s)");
  try {
    await startLanguageServer();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    output.appendLine(`[diagnostics] Activation failed: ${detail}`);
    output.show(true);
    vscode.window.showErrorMessage(`Vale: ${detail}`, "Show Diagnostics").then(
      (choice) => {
        if (choice === "Show Diagnostics") output.show(true);
      }
    );
  }

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

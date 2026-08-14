import { workspace, ExtensionContext } from "vscode";
import * as vscode from "vscode";

import { mkdir, rename, rm } from "node:fs/promises";
import * as unzipper from "unzipper";
import fs from "fs";
import * as path from "path";

import {
  LSP_TAG,
  buildDownloadAssetName,
  detectArch,
  detectPlatform,
  getExecutableName,
  getExpectedChecksum,
  sha256Hex,
} from "./utils";
import { buildValeConfig } from "./config";
import { clientKeyFor, noFolderClientKey } from "./workspaceFolders";
import { isServerReplaceFix } from "./codeActions";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

/**
 * Downloading, installing, and running vale-ls.
 *
 * vale-ls does not support the `workspace/workspaceFolders` capability, so
 * (per VS Code's standard guidance for such servers) we run one client per
 * workspace folder, each restricted to that folder's files, rather than a
 * single client shared across the whole window. See
 * `.claude/notes/multi-root-workspaces.md`.
 */
const clients: Map<string, LanguageClient> = new Map();

export function getArch(): string | null {
  const arch = detectArch(process.arch);
  if (arch === null) {
    vscode.window.showErrorMessage("Unsupported architecture: " + process.arch);
  }
  return arch;
}

export function getPlatform(): string | null {
  const platform = detectPlatform(process.platform, process.arch);
  if (platform === null) {
    vscode.window.showErrorMessage("Unsupported platform: " + process.platform);
  }
  return platform;
}

/**
 * Resolves the local directory the language server binary is installed
 * into. Uses the extension's global storage, which VS Code guarantees is
 * writable, instead of the read-only extension install directory.
 */
export function getInstallDir(context: ExtensionContext): string {
  return context.globalStorageUri.fsPath;
}

async function downloadLSP(context: ExtensionContext): Promise<void> {
  const assetName = buildDownloadAssetName(process.platform, process.arch);
  if (!assetName) {
    vscode.window.showErrorMessage(
      `Unsupported platform/architecture: ${process.platform}/${process.arch}`
    );
    throw new Error("Unable to determine download for this platform.");
  }

  const expectedChecksum = getExpectedChecksum(assetName);
  if (!expectedChecksum) {
    throw new Error(
      `No known checksum for ${assetName} (${LSP_TAG}); refusing to install an unverifiable binary.`
    );
  }

  const URL = `https://github.com/errata-ai/vale-ls/releases/download/${LSP_TAG}/${assetName}`;
  const installDir = getInstallDir(context);
  await mkdir(installDir, { recursive: true });

  const executableName = getExecutableName(process.platform);
  const finalPath = path.join(installDir, executableName);
  const tmpPath = path.join(
    installDir,
    `.${executableName}.download-${process.pid}-${Date.now()}`
  );

  try {
    vscode.window.showInformationMessage(
      "First launch: Downloading Vale Language Server"
    );

    const response = await fetch(URL);
    if (!response.ok) {
      throw new Error(
        `Failed to download ${assetName}: HTTP ${response.status} ${response.statusText}`
      );
    }
    if (!response.body) {
      throw new Error("Failed to fetch the response body.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    const expectedLength = response.headers.get("content-length");
    if (expectedLength && buffer.length !== Number(expectedLength)) {
      throw new Error(
        `Download size mismatch for ${assetName}: expected ${expectedLength} bytes, got ${buffer.length}.`
      );
    }

    const actualChecksum = sha256Hex(buffer);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Checksum mismatch for ${assetName}: expected ${expectedChecksum}, got ${actualChecksum}.`
      );
    }

    const directory = await unzipper.Open.buffer(buffer);
    const entry = directory.files.find((file) => file.path === executableName);
    if (!entry) {
      throw new Error(
        `Archive ${assetName} did not contain the expected ${executableName} entry.`
      );
    }

    const executableBuffer = await entry.buffer();
    await fs.promises.writeFile(tmpPath, executableBuffer, { mode: 0o755 });
    await fs.promises.chmod(tmpPath, 0o755);
    await rename(tmpPath, finalPath);

    vscode.window.showInformationMessage(
      "First launch: Vale Language Server downloaded"
    );
  } catch (error) {
    await rm(tmpPath, { force: true });
    console.error("Download failed:", error);
    throw error;
  }
}

/**
 * Ensures the vale-ls binary is installed (downloading it on first use),
 * and returns its path for use as the language client's command.
 */
export async function ensureLanguageServerBinary(
  context: ExtensionContext
): Promise<string> {
  const installDir = getInstallDir(context);
  const filePath = path.join(installDir, getExecutableName(process.platform));

  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    console.log("Language server exists");
  } catch {
    console.log("Language server not found, downloading...");
    await downloadLSP(context);

    // Verify download succeeded
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
  }

  // LanguageClient spawns this command directly (no shell), so it needs the
  // literal, unescaped path - a backslash-escaped space (as you'd type at a
  // shell prompt) isn't part of the real filename and fails with ENOENT.
  // This install directory (context.globalStorageUri.fsPath) commonly
  // contains a space, e.g. macOS's ".../Application Support/...".
  return filePath;
}

export function hasActiveClients(): boolean {
  return clients.size > 0;
}

/**
 * Stops and forgets the client registered under `key`, if any. Used both to
 * tear a folder's client down on removal and to guard against double
 * activation.
 */
export async function stopAndRemoveClient(key: string): Promise<void> {
  const existing = clients.get(key);
  if (!existing) {
    return;
  }
  clients.delete(key);
  try {
    await existing.stop();
  } catch (error) {
    console.error("Error stopping Vale language client:", error);
  }
}

export async function stopAllClients(): Promise<void> {
  await Promise.all(Array.from(clients.keys()).map(stopAndRemoveClient));
}

/**
 * Starts (or restarts) the vale-ls client for `folder`. With no `folder`
 * (single-file / no-workspace mode), one unscoped client covers the whole
 * window, matching the extension's pre-multi-root behavior.
 */
export async function startClientForFolder(
  serverPath: string,
  folder?: vscode.WorkspaceFolder
): Promise<void> {
  const key = clientKeyFor(folder);
  await stopAndRemoveClient(key);

  const workspaceRoot = folder?.uri.fsPath;
  const configuration = vscode.workspace.getConfiguration(undefined, folder?.uri);
  const valeConfig = buildValeConfig(configuration, workspaceRoot);

  const tempArgs: never[] = [];
  // vale-ls resolves vale.ini's file-glob sections (e.g. `[docs/**/*.md]`)
  // relative to its own working directory. Without an explicit `cwd` here,
  // Node defaults the child process to the extension host's cwd rather than
  // the workspace folder, so those sections silently never match. See #73.
  const executableOptions = workspaceRoot ? { cwd: workspaceRoot } : undefined;
  const serverOptions: ServerOptions = {
    run: { command: serverPath, args: tempArgs, options: executableOptions },
    debug: { command: serverPath, args: tempArgs, options: executableOptions },
  };

  const documentSelector: LanguageClientOptions["documentSelector"] = folder
    ? [{ scheme: "file", language: "*", pattern: `${folder.uri.fsPath}/**/*` }]
    : [{ scheme: "file", language: "*" }];

  const fileWatcherPattern: vscode.GlobPattern = folder
    ? new vscode.RelativePattern(folder, "**/.clientrc")
    : "**/.clientrc";

  const clientOptions: LanguageClientOptions = {
    initializationOptions: valeConfig,
    documentSelector,
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher(fileWatcherPattern),
    },
    workspaceFolder: folder,
    middleware: {
      // vale-ls's own `fix`-RPC-based quick fixes for `replace` alerts are
      // superseded by ValeSubstitutionCodeActionProvider (registered
      // separately in codeActions.ts), which reads every swap alternative
      // straight from the alert data instead of that RPC - so strip the
      // server's copies here rather than showing both. See
      // https://github.com/ChrisChinchilla/vale-vscode/issues/7.
      provideCodeActions: async (document, range, context, token, next) => {
        const results = await next(document, range, context, token);
        return results?.filter((item) => !isServerReplaceFix(item));
      },
    },
  };

  const clientId = folder ? `vale-${folder.uri.toString()}` : "vale";
  const clientName = folder ? `Vale VSCode (${folder.name})` : "Vale VSCode";

  const client = new LanguageClient(clientId, clientName, serverOptions, clientOptions);
  clients.set(key, client);

  try {
    await client.start();
  } catch (err) {
    console.error(err);
    vscode.window.showErrorMessage(
      folder
        ? `Failed to start Vale Language Server for workspace folder "${folder.name}"`
        : "Failed to start Vale Language Server"
    );
    clients.delete(key);
    throw err;
  }
}

/**
 * Starts one client per current workspace folder (or one unscoped client if
 * there are none).
 */
export async function startClientsForCurrentWorkspace(
  serverPath: string
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    for (const folder of folders) {
      await startClientForFolder(serverPath, folder);
    }
  } else {
    await startClientForFolder(serverPath, undefined);
  }
}

/**
 * Starts/stops clients as workspace folders are added/removed after
 * activation - previously a no-op, so folders added later were never linted
 * until a window reload.
 */
export function registerWorkspaceFolderWatcher(
  context: ExtensionContext,
  serverPath: string
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
      for (const folder of event.removed) {
        await stopAndRemoveClient(clientKeyFor(folder));
      }
      // The no-folder fallback client no longer applies once a real folder
      // exists.
      if (event.added.length > 0) {
        await stopAndRemoveClient(noFolderClientKey());
      }
      for (const folder of event.added) {
        await startClientForFolder(serverPath, folder);
      }
    })
  );
}

import { workspace, ExtensionContext } from "vscode";
import * as vscode from "vscode";

import { mkdir, rename, rm } from "node:fs/promises";
import * as unzipper from "unzipper";
import fs from "fs";
import * as path from "path";

import {
  LSP_TAG,
  MIN_VALE_FILTER_VERSION,
  buildDownloadAssetName,
  detectArch,
  detectPlatform,
  getExecutableName,
  getExpectedChecksum,
  isVersionAtLeast,
  parseValeVersion,
  sha256Hex,
  buildDockerProxyEnvironment,
  isUnsupportedLinuxLibc,
  SharedRegistry,
} from "./utils";
import type { ValeExecutionOptions } from "./utils";
import { buildValeConfig, resolveValeExecutionOptions } from "./config";
import { clientKeyFor, noFolderClientKey } from "./workspaceFolders";
import { isServerReplaceFix } from "./codeActions";
import {
  ensureDockerWrapperScript,
  getWindowsDockerProxy,
} from "./docker";
import { getValeOutputChannel } from "./ui";
import { getValeVersionOutput } from "./cli";

import {
  ExecuteCommandRequest,
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

/**
 * Downloading, installing, and running vale-ls.
 *
 * One client runs per workspace folder, each restricted to that folder's
 * files. vale-ls v0.5.0+ supports `workspace/workspaceFolders` itself, so a
 * single shared client is possible -- but per-client `initializationOptions`
 * are what let folder-scoped settings (a per-folder `vale.valeCLI.config`)
 * take effect, so collapsing to one client trades that away.
 */
const clients: Map<string, LanguageClient> = new Map();
const VERSION_MARKER_NAME = ".vale-ls-version";

/**
 * vale-ls advertises its commands (`cli.sync`, ...) through the
 * `executeCommandProvider` capability, and vscode-languageclient registers
 * each one with VS Code. Every folder's server advertises the same names, so
 * the second client's registration throws (`command 'cli.sync' already
 * exists`) and that folder's client dies on startup.
 *
 * So that registration is disabled per client, and each command is instead
 * registered once here, with a handler that routes to the client for the
 * active editor's folder - which the per-client registration never did.
 */
const sharedServerCommands = new SharedRegistry<vscode.Disposable>(
  (command) =>
    vscode.commands.registerCommand(command, (...args: unknown[]) => {
      return clientForActiveEditor()?.sendRequest(ExecuteCommandRequest.type, {
        command,
        arguments: args,
      });
    }),
  (disposable) => disposable.dispose()
);

/** The client responsible for the active editor's folder. */
function clientForActiveEditor(): LanguageClient | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      const scoped = clients.get(clientKeyFor(folder));
      if (scoped) {
        return scoped;
      }
    }
  }
  return clients.get(noFolderClientKey()) ?? clients.values().next().value;
}

/** Keeps the client from registering the server's commands itself. */
function suppressCommandRegistration(client: LanguageClient): void {
  const feature = client.getFeature(ExecuteCommandRequest.method);
  (feature as unknown as { initialize: () => void }).initialize = () => {};
}

/** Registers the started client's advertised commands, once per name. */
function shareServerCommands(client: LanguageClient): void {
  const commands =
    client.initializeResult?.capabilities.executeCommandProvider?.commands ??
    [];
  sharedServerCommands.acquire(client, commands);
}

/** Lets go of a stopping client's commands, disposing the last reference. */
function releaseServerCommands(client: LanguageClient): void {
  sharedServerCommands.release(client);
}

function runtimeGlibcVersion(): string | undefined {
  const report = process.report?.getReport();
  if (!report || typeof report === "string") return undefined;
  return (report as { header?: { glibcVersionRuntime?: string } }).header
    ?.glibcVersionRuntime;
}

/** Appends a line to the Vale output channel, prefixed for grep-ability. */
function logDiagnostic(message: string): void {
  getValeOutputChannel().appendLine(`[diagnostics] ${message}`);
}

/**
 * Warns when the Vale CLI vale-ls will invoke predates the version whose
 * `--filter` flag accepts a raw expression (rather than only a file path or
 * named asset) - older versions fail every lint with a cryptic
 * `filter '<expr>' not found` as soon as any filter is sent, which happens
 * with default settings (`vale.enableSpellcheck` defaults to `false`, and
 * `buildValeConfig` always sends `.Extends != "spelling"` in that case). See
 * https://github.com/ChrisChinchilla/vale-vscode/issues/63 and
 * `.claude/notes/vale-filter-version-check.md`.
 *
 * Only called when `filterExpression` is non-empty, since that's exactly
 * the condition that triggers the bug - a user with no filter configured
 * (or an old-but-unfiltered setup) isn't affected and shouldn't be warned.
 * Failure to determine the version (missing binary, Docker unavailable,
 * unparseable output) is treated as "can't check" and silently skipped
 * rather than surfaced as its own error - `client.start()` will still
 * report the real problem if one exists.
 */
async function warnIfValeTooOldForFilters(
  workingDir: string,
  execution: ValeExecutionOptions,
  filterExpression: string
): Promise<void> {
  if (!filterExpression) return;

  const output = await getValeVersionOutput(workingDir, execution);
  if (!output) return;

  const version = parseValeVersion(output);
  if (!version || isVersionAtLeast(version, MIN_VALE_FILTER_VERSION)) return;

  const [major, minor, patch] = version;
  const [minMajor, minMinor, minPatch] = MIN_VALE_FILTER_VERSION;
  const message =
    `Vale ${major}.${minor}.${patch} is too old to apply Vale VSCode's filter ` +
    `settings (minAlertLevel/enableSpellcheck) - Vale ${minMajor}.${minMinor}.${minPatch}+ ` +
    `is required, or linting will fail with "filter '...' not found". Upgrade Vale, or ` +
    `set both vale.valeCLI.minAlertLevel to "inherited" and vale.enableSpellcheck to true ` +
    `to avoid sending a filter at all.`;
  logDiagnostic(message);
  vscode.window.showWarningMessage(`Vale: ${message}`);
}

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

  const URL = `https://github.com/vale-cli/vale-ls/releases/download/${LSP_TAG}/${assetName}`;
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
    await fs.promises.writeFile(
      path.join(installDir, VERSION_MARKER_NAME),
      `${LSP_TAG}\n`,
      "utf8"
    );

    vscode.window.showInformationMessage(
      "First launch: Vale Language Server downloaded"
    );
  } catch (error) {
    await rm(tmpPath, { force: true });
    console.error("Download failed:", error);
    const detail = error instanceof Error ? error.message : String(error);
    logDiagnostic(`vale-ls installation failed: ${detail}`);
    throw new Error(
      `Unable to install Vale Language Server ${LSP_TAG}. Check this remote environment's access to github.com, then run "Vale: Restart Language Server". ${detail}`
    );
  }
}

/**
 * Ensures the vale-ls binary is installed (downloading it on first use),
 * and returns its path for use as the language client's command.
 */
export async function ensureLanguageServerBinary(
  context: ExtensionContext
): Promise<string> {
  const glibcVersion = runtimeGlibcVersion();
  if (isUnsupportedLinuxLibc(process.platform, glibcVersion)) {
    throw new Error(
      "Vale Language Server publishes glibc Linux binaries only, but this environment appears to use musl libc (common in Alpine containers). Use a glibc-based devcontainer image."
    );
  }

  const installDir = getInstallDir(context);
  const filePath = path.join(installDir, getExecutableName(process.platform));
  const versionPath = path.join(installDir, VERSION_MARKER_NAME);

  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    const installedVersion = (
      await vscode.workspace.fs.readFile(vscode.Uri.file(versionPath))
    ).toString().trim();
    if (installedVersion !== LSP_TAG) {
      throw new Error(`Installed version is ${installedVersion || "unknown"}`);
    }
    logDiagnostic(`Using Vale Language Server ${LSP_TAG} at ${filePath}`);
  } catch {
    logDiagnostic(`Installing Vale Language Server ${LSP_TAG} in ${installDir}`);
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
  releaseServerCommands(existing);
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
  context: ExtensionContext,
  folder?: vscode.WorkspaceFolder
): Promise<void> {
  const key = clientKeyFor(folder);
  await stopAndRemoveClient(key);

  const workspaceRoot = folder?.uri.fsPath;
  const configuration = vscode.workspace.getConfiguration(undefined, folder?.uri);

  const windowsProxy =
    process.platform === "win32" ? getWindowsDockerProxy(context) : undefined;
  const execution = resolveValeExecutionOptions(
    configuration,
    workspaceRoot,
    process.platform,
    windowsProxy?.path,
    windowsProxy?.unavailableReason
  );
  // Leave this unset when no custom path is configured so vale-ls can still
  // honor installVale and manage its own Vale binary.
  let valeBinaryPath =
    configuration.get<string>("vale.valeCLI.path") || undefined;
  if (execution.dockerUnavailableReason) {
    vscode.window.showWarningMessage(`Vale: ${execution.dockerUnavailableReason}`);
  }
  if (execution.docker?.proxyPath) {
    valeBinaryPath = execution.docker.proxyPath;
  } else if (execution.docker && workspaceRoot && folder) {
    valeBinaryPath = await ensureDockerWrapperScript(
      context,
      folder,
      execution.docker.image,
      workspaceRoot,
      execution.docker.extraArgs
    );
  }

  const valeConfig = buildValeConfig(
    configuration,
    workspaceRoot,
    valeBinaryPath,
    Boolean(execution.docker)
  );
  logDiagnostic(
    `Workspace ${workspaceRoot ?? "<no folder>"}; config ${String(valeConfig.configPath) || "<auto>"}; Vale ${execution.docker ? `Docker image ${execution.docker.image}${execution.docker.proxyPath ? ` via ${execution.docker.proxyPath}` : ""}` : valeBinaryPath ?? "PATH/vale-ls managed install"}`
  );
  await warnIfValeTooOldForFilters(
    workspaceRoot ?? process.cwd(),
    execution,
    String(valeConfig.filter)
  );

  const tempArgs: never[] = [];
  // vale-ls resolves vale.ini's file-glob sections (e.g. `[docs/**/*.md]`)
  // relative to its own working directory. Without an explicit `cwd` here,
  // Node defaults the child process to the extension host's cwd rather than
  // the workspace folder, so those sections silently never match. See #73.
  const executableOptions = workspaceRoot
    ? {
        cwd: workspaceRoot,
        env: execution.docker?.proxyPath
          ? buildDockerProxyEnvironment(execution.docker, workspaceRoot)
          : process.env,
      }
    : undefined;
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
  suppressCommandRegistration(client);
  clients.set(key, client);

  try {
    await client.start();
    shareServerCommands(client);
  } catch (err) {
    console.error(err);
    logDiagnostic(
      `Failed to start Vale Language Server${folder ? ` for ${folder.uri.toString()}` : ""}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`
    );
    getValeOutputChannel().show(true);
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
  serverPath: string,
  context: ExtensionContext
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    for (const folder of folders) {
      await startClientForFolder(serverPath, context, folder);
    }
  } else {
    await startClientForFolder(serverPath, context, undefined);
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
        await startClientForFolder(serverPath, context, folder);
      }
    })
  );
}

/**
 * Settings that feed `buildValeConfig`'s `initializationOptions`. Since
 * those options are only read once, at client-start time, changing any of
 * these previously required a full window reload to take effect. See #35.
 */
const VALE_CONFIG_SETTINGS = [
  "vale.enableSpellcheck",
  "vale.valeCLI.minAlertLevel",
  "vale.valeCLI.config",
  "vale.valeCLI.syncOnStartup",
  "vale.valeCLI.installVale",
  "vale.valeCLI.path",
  "vale.docker.enabled",
  "vale.docker.image",
  "vale.docker.extraArgs",
];

/**
 * Restarts the affected client(s) when a setting that feeds
 * `initializationOptions` changes, so the change takes effect immediately
 * instead of requiring "Reload Window".
 */
export function registerConfigurationWatcher(
  context: ExtensionContext,
  serverPath: string
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        for (const folder of folders) {
          if (
            VALE_CONFIG_SETTINGS.some((setting) =>
              event.affectsConfiguration(setting, folder.uri)
            )
          ) {
            await startClientForFolder(serverPath, context, folder);
          }
        }
      } else if (
        VALE_CONFIG_SETTINGS.some((setting) => event.affectsConfiguration(setting))
      ) {
        await startClientForFolder(serverPath, context, undefined);
      }
    })
  );
}

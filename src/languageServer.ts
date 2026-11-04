import { workspace, ExtensionContext } from "vscode";
import * as vscode from "vscode";

import { mkdir, rename, rm } from "node:fs/promises";
import * as unzipper from "unzipper";
import { family as detectLibcFamily } from "detect-libc";
import fs from "fs";
import * as path from "path";

import {
  LSP_TAG,
  MIN_VALE_CONFIG_DIR_VERSION,
  MIN_VALE_FILTER_VERSION,
  describeValeVersion,
  formatValeVersion,
  VALE_CONFIG_FILE_GLOB,
  buildDownloadAssetName,
  detectArch,
  detectPlatform,
  getExecutableName,
  getExpectedChecksum,
  isVersionAtLeast,
  parseValeVersion,
  sha256Hex,
  buildDockerProxyEnvironment,
  buildValeConfigArgs,
  formatProbeResult,
  isProbeSuccessful,
  capDiagnostics,
  isUnsupportedLinuxLibc,
  resolveValeBinaryPath,
  SharedRegistry,
} from "./utils";
import type { ValeExecutionOptions } from "./utils";
import { buildValeConfig, resolveValeExecutionOptions } from "./config";
import { clientKeyFor, noFolderClientKey } from "./workspaceFolders";
import { ClientLifecycleQueue, usesConfigFile } from "./clientLifecycle";
import { isServerReplaceFix } from "./codeActions";
import {
  ensureDockerWrapperScript,
  getWindowsDockerProxy,
} from "./docker";
import { clearClientStatus, getValeOutputChannel, setClientStatus } from "./ui";
import { getValeVersionOutput, probeExecutable } from "./cli";

import {
  ExecuteCommandRequest,
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  State,
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
const lifecycle = new ClientLifecycleQueue();
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

/** Appends a line to the Vale output channel, prefixed for grep-ability. */
function logDiagnostic(message: string): void {
  getValeOutputChannel().appendLine(`[diagnostics] ${message}`);
}

/**
 * Probes the Vale CLI once at client start, logs its version to the Vale
 * output channel (so **Vale: Show Diagnostics** always has it), and warns
 * about the known features an old Vale can't support:
 *
 * - `--filter` with a raw expression (Vale < 3.10.0): every lint fails with a
 *   cryptic `filter '<expr>' not found`. This happens on default settings
 *   (`vale.enableSpellcheck` defaults to `false`, and `buildValeConfig`
 *   always sends `.Extends != "spelling"` in that case), and again once a
 *   `vale.valeCLI.filter` expression is set. Only checked when
 *   `filterExpression` is non-empty. See
 *   https://github.com/ChrisChinchilla/vale-vscode/issues/63 and
 *   `.claude/notes/vale-filter-version-check.md`.
 * - `.config/vale.ini` (Vale < 3.25.1): silently ignored. Only checked when
 *   the folder has such a file and no explicit `vale.valeCLI.config`.
 *
 * Failure to determine the version (missing binary, Docker unavailable,
 * unparseable output) is logged and otherwise skipped rather than surfaced
 * as its own error - `client.start()` will still report the real problem.
 * With no `vale.valeCLI.path` or Docker, this probes `vale` on PATH, which
 * may not be the managed install vale-ls uses.
 */
async function checkValeVersion(
  workingDir: string,
  execution: ValeExecutionOptions,
  filterExpression: string,
  usesDefaultConfigDirectory: boolean
): Promise<void> {
  const output = await getValeVersionOutput(workingDir, execution);
  logDiagnostic(describeValeVersion(output));
  if (!output) return;

  const version = parseValeVersion(output);
  if (!version) return;
  const current = formatValeVersion(version);

  if (
    filterExpression &&
    !isVersionAtLeast(version, MIN_VALE_FILTER_VERSION)
  ) {
    const min = formatValeVersion(MIN_VALE_FILTER_VERSION);
    const message =
      `Vale ${current} is too old to apply Vale VSCode's filter ` +
      `settings (minAlertLevel/enableSpellcheck/filter) - Vale ${min}+ ` +
      `is required, or linting will fail with "filter '...' not found". Upgrade Vale, or ` +
      `set vale.valeCLI.minAlertLevel to "inherited", vale.enableSpellcheck to true, and clear ` +
      `vale.valeCLI.filter to avoid sending a filter at all.`;
    logDiagnostic(message);
    vscode.window.showWarningMessage(`Vale: ${message}`);
  }

  if (
    usesDefaultConfigDirectory &&
    !isVersionAtLeast(version, MIN_VALE_CONFIG_DIR_VERSION)
  ) {
    const message =
      `Vale ${current} does not read .config/vale.ini - Vale ` +
      `${formatValeVersion(MIN_VALE_CONFIG_DIR_VERSION)}+ is required. Upgrade Vale, ` +
      `or move the file to .vale.ini, or point vale.valeCLI.config at it.`;
    logDiagnostic(message);
    vscode.window.showWarningMessage(`Vale: ${message}`);
  }
}

let languageServerChannel: vscode.LogOutputChannel | undefined;

function getLanguageServerChannel(context: ExtensionContext): vscode.LogOutputChannel {
  if (!languageServerChannel) {
    languageServerChannel = vscode.window.createOutputChannel(
      "Vale Language Server",
      { log: true }
    );
    context.subscriptions.push(languageServerChannel);
  }
  return languageServerChannel;
}

/**
 * Runs the Docker wrapper (or proxy) once with `--version` and `ls-config`
 * and logs exit code/stdout/stderr. Without this a container failure
 * (podman short-name prompts, SELinux denying the bind mount, a missing
 * `docker` binary) only surfaces as vale-ls's `expected value at line 1
 * column 1` JSON parse error. Not awaited by the caller - the first run
 * can include an image pull. See
 * https://github.com/ChrisChinchilla/vale-vscode/issues/129.
 */
async function logDockerPreflight(
  command: string,
  workingDir: string,
  env: NodeJS.ProcessEnv,
  configPath: string,
  noGlobal: boolean
): Promise<void> {
  const options = { cwd: workingDir, env };
  const probes: [string, string[]][] = [
    ["docker preflight `--version`", ["--version"]],
    [
      "docker preflight `ls-config`",
      [...buildValeConfigArgs(configPath, noGlobal), "ls-config"],
    ],
  ];
  for (const [label, args] of probes) {
    const result = await probeExecutable(command, args, options);
    for (const line of formatProbeResult(label, result)) logDiagnostic(line);
    if (!isProbeSuccessful(result)) {
      logDiagnostic(
        "Docker mode preflight failed; vale-ls will report an unhelpful JSON parse error until this is fixed."
      );
      getValeOutputChannel().show(true);
      return;
    }
  }
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
    const { buffer, expectedLength } = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Vale: Downloading Vale Language Server ${LSP_TAG}`,
        cancellable: true,
      },
      async (_progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        try {
          const response = await fetch(URL, { signal: abort.signal });
          if (!response.ok) {
            throw new Error(
              `Failed to download ${assetName}: HTTP ${response.status} ${response.statusText}`
            );
          }
          if (!response.body) {
            throw new Error("Failed to fetch the response body.");
          }
          return {
            buffer: Buffer.from(await response.arrayBuffer()),
            expectedLength: response.headers.get("content-length"),
          };
        } catch (error) {
          if (token.isCancellationRequested) {
            throw new Error("Download of the Vale Language Server was cancelled.");
          }
          throw error;
        }
      }
    );

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
  // detect-libc can throw inside the extension host (see issue #129); treat
  // that as "undetermined", which isUnsupportedLinuxLibc deliberately allows.
  const libcFamily = await detectLibcFamily().catch(() => null);
  if (isUnsupportedLinuxLibc(process.platform, libcFamily)) {
    throw new Error(
      "Vale Language Server publishes glibc Linux binaries only, but this environment appears to use musl libc (common in Alpine containers). Use a glibc-based devcontainer image."
    );
  }
  if (process.platform === "linux" && libcFamily === null) {
    logDiagnostic(
      "Could not determine Linux libc family; assuming glibc and proceeding."
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
  return lifecycle.run(key, "stop", () => stopClient(key));
}

async function stopClient(key: string): Promise<void> {
  const existing = clients.get(key);
  // A failed start leaves an error status but no client; drop it either way.
  clearClientStatus(key);
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
  await Promise.all([...new Set([...clients.keys(), ...lifecycle.keys()])].map(stopAndRemoveClient));
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
  return lifecycle.run(clientKeyFor(folder), "start", () => startClient(serverPath, context, folder));
}

async function startClient(
  serverPath: string,
  context: ExtensionContext,
  folder?: vscode.WorkspaceFolder
): Promise<void> {
  const key = clientKeyFor(folder);
  await stopClient(key);

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
  const rawValeBinaryPath = configuration.get<string>("vale.valeCLI.path") || "";
  let valeBinaryPath = rawValeBinaryPath
    ? resolveValeBinaryPath(rawValeBinaryPath, workspaceRoot, vscode.workspace.isTrusted)
    : undefined;
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
    `Workspace ${workspaceRoot ?? "<no folder>"}; config ${valeConfig.configPath || "<auto>"}; Vale ${execution.docker ? `Docker image ${execution.docker.image}${execution.docker.proxyPath ? ` via ${execution.docker.proxyPath}` : ""}` : valeBinaryPath ?? "PATH/vale-ls managed install"}`
  );
  if (execution.docker && valeBinaryPath) {
    void logDockerPreflight(
      valeBinaryPath,
      workspaceRoot ?? process.cwd(),
      execution.docker.proxyPath && workspaceRoot
        ? buildDockerProxyEnvironment(execution.docker, workspaceRoot)
        : process.env,
      valeConfig.configPath,
      valeConfig.noGlobal
    );
  }
  // Only `.config/vale.ini` is at stake: an older Vale still finds a root
  // `.vale.ini`/`_vale.ini`, so a project that has one isn't affected.
  const usesDefaultConfigDirectory =
    Boolean(workspaceRoot) &&
    !valeConfig.configPath &&
    fs.existsSync(path.join(workspaceRoot!, ".config", "vale.ini")) &&
    !fs.existsSync(path.join(workspaceRoot!, ".vale.ini")) &&
    !fs.existsSync(path.join(workspaceRoot!, "_vale.ini"));
  await checkValeVersion(
    workspaceRoot ?? process.cwd(),
    execution,
    valeConfig.filter,
    usesDefaultConfigDirectory
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

  const clientOptions: LanguageClientOptions = {
    initializationOptions: valeConfig,
    documentSelector,
    workspaceFolder: folder,
    // One shared channel for server logs and `vale.trace.server` traffic,
    // instead of a per-client channel named after the workspace folder.
    // It has to be a log channel (the client requires one), which is why it
    // isn't merged into the plain "Vale" channel.
    outputChannel: getLanguageServerChannel(context),
    traceOutputChannel: getLanguageServerChannel(context),
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
      // Implements `vale.maxNumberOfProblems`: vale-ls has no such limit
      // itself, so cap what reaches the Problems view client-side.
      handleDiagnostics: (uri, diagnostics, next) => {
        const maxProblems = vscode.workspace
          .getConfiguration(undefined, uri)
          .get<number>("vale.maxNumberOfProblems");
        next(uri, capDiagnostics(diagnostics, maxProblems) as typeof diagnostics);
      },
    },
  };

  const clientId = folder ? `vale-${folder.uri.toString()}` : "vale";
  const clientName = folder ? `Vale VSCode (${folder.name})` : "Vale VSCode";

  const client = new LanguageClient(clientId, clientName, serverOptions, clientOptions);
  suppressCommandRegistration(client);
  clients.set(key, client);
  const statusName = folder?.name ?? "Vale";
  setClientStatus(key, statusName, "starting");
  // A server that dies after a successful start (crash, killed binary) never
  // reaches the catch below; surface it too. `clients.get(key) === client`
  // keeps an intentional stop/restart from reading as a failure.
  client.onDidChangeState((event) => {
    if (event.newState === State.Stopped && clients.get(key) === client) {
      setClientStatus(key, statusName, "error", "The server stopped unexpectedly");
    }
  });

  try {
    await client.start();
    shareServerCommands(client);
    setClientStatus(key, statusName, "ready");
  } catch (err) {
    console.error(err);
    setClientStatus(
      key,
      statusName,
      "error",
      err instanceof Error ? err.message : String(err)
    );
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
  "vale.valeCLI.filter",
  "vale.valeCLI.config",
  "vale.valeCLI.syncOnStartup",
  "vale.valeCLI.installVale",
  "vale.valeCLI.noGlobal",
  "vale.valeCLI.lintOnChange",
  "vale.valeCLI.debounceMs",
  "vale.valeCLI.showMetrics",
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

/**
 * Restarts the affected client when a Vale config file (`.vale.ini`,
 * `_vale.ini`, or `.config/vale.ini`) is created, changed, or deleted.
 *
 * vale-ls ignores `workspace/didChangeWatchedFiles` and runs `vale` afresh
 * for each lint, so a config edit already applies to the *next* lint - what
 * it can't do is refresh diagnostics already showing in open documents.
 * Restarting the client re-opens and re-lints them. Rapid bursts of events
 * (a save that touches several files, branch switches) collapse into one
 * restart per folder.
 */
export function registerValeConfigFileWatcher(
  context: ExtensionContext,
  serverPath: string
): void {
  const watcher = workspace.createFileSystemWatcher(VALE_CONFIG_FILE_GLOB);
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const scheduleRestart = (folder?: vscode.WorkspaceFolder) => {
    const key = clientKeyFor(folder);
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        if (folder && !workspace.workspaceFolders?.some((current) => clientKeyFor(current) === key)) return;
        // Only restart a client that is running; a failed start shouldn't be
        // retried on every config save.
        if (!clients.has(key)) return;
        startClientForFolder(serverPath, context, folder).catch((error) =>
          console.error("Failed to restart Vale after config change:", error)
        );
      }, 500)
    );
  };

  const restartFor = (uri: vscode.Uri) => {
    const owner = workspace.getWorkspaceFolder(uri);
    const folders = workspace.workspaceFolders;
    const candidates = folders?.length ? folders : [undefined];
    for (const folder of candidates) {
      const configuration = workspace.getConfiguration(undefined, folder?.uri);
      const configPath = buildValeConfig(configuration, folder?.uri.fsPath).configPath;
      if (folder === owner || usesConfigFile(configPath, folder?.uri.fsPath, uri.fsPath)) {
        scheduleRestart(folder);
      }
    }
  };

  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(restartFor),
    watcher.onDidChange(restartFor),
    watcher.onDidDelete(restartFor),
    { dispose: () => pending.forEach((timer) => clearTimeout(timer)) }
  );
}

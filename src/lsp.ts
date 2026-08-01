import { workspace, ExtensionContext } from "vscode";
import * as vscode from "vscode";

import { writeFile, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import * as unzipper from "unzipper";
import fs from "fs";
import * as path from "path";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient;
let valeOutputChannel: vscode.OutputChannel;

class ValeCommandItem extends vscode.TreeItem {
  constructor(
    label: string,
    commandId: string,
    commandTitle: string,
    iconName: string,
    tooltip?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = { command: commandId, title: commandTitle };
    this.iconPath = new vscode.ThemeIcon(iconName);
    if (tooltip) {
      this.tooltip = tooltip;
    }
  }
}

class ValeCommandsProvider
  implements vscode.TreeDataProvider<ValeCommandItem>
{
  getTreeItem(element: ValeCommandItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ValeCommandItem[] {
    return [
      new ValeCommandItem(
        "Sync Packages",
        "vale.sync",
        "Sync",
        "sync",
        "Download and install Vale packages defined in your config"
      ),
      new ValeCommandItem(
        "Install or Update Vale",
        "vale.install",
        "Install Vale",
        "cloud-download",
        "Install or update the Vale binary the language server manages"
      ),
      new ValeCommandItem(
        "Show Configuration",
        "vale.showConfig",
        "Show Configuration",
        "gear",
        "Display the active Vale configuration (vale ls-config)"
      ),
      new ValeCommandItem(
        "Show File Metrics",
        "vale.showMetrics",
        "Show Metrics",
        "graph",
        "Display readability metrics for the active file (vale ls-metrics)"
      ),
    ];
  }
}

export function getArch(): String | null {
  if (process.arch == "x64") return "x86_64";
  else if (process.arch == "arm64") return "aarch64";
  else {
    vscode.window.showErrorMessage("Unsupported architecture: " + process.arch);
    return null;
  }
}

export function getPlatform(): String | null {
  if (process.platform == "darwin") return "apple-darwin";
  else if (process.arch == "arm64" && process.platform == "win32")
    return "pc-windows-msvc";
  else if (process.arch == "x64" && process.platform == "win32")
    return "pc-windows-gnu";
  else if (process.platform == "linux") return "unknown-linux-gnu";
  else {
    vscode.window.showErrorMessage("Unsupported platform: " + process.platform);
    return null;
  }
}

// The version of the language server to download.
//
// `serverVersionFile` records which tag the binary on disk came from, so
// bumping this is enough to upgrade an existing install.
const TAG = "v0.5.0";

/**
 * Returns the file recording the tag the downloaded server came from.
 */
function serverVersionFile(context: ExtensionContext): string {
  return path.join(context.extensionPath, "vale-ls.version");
}

/**
 * Reports whether the server on disk is the version we expect.
 */
async function isCurrent(context: ExtensionContext): Promise<boolean> {
  try {
    const installed = await readFile(serverVersionFile(context), "utf8");
    return installed.trim() === TAG;
  } catch {
    // No stamp: either a fresh install or one from before we wrote one.
    return false;
  }
}

async function downloadLSP(context: ExtensionContext): Promise<void> {
  const URL = `https://github.com/vale-cli/vale-ls/releases/download/${TAG}/vale-ls-${getArch()}-${getPlatform()}.zip`;
  const extStorage = context.extensionPath;
  const tmpZip = path.join(extStorage, "vale-ls.zip");

  try {
    vscode.window.showInformationMessage(
      `Downloading Vale Language Server ${TAG}`
    );

    const response = await fetch(URL);
    // Without this, an error page is written to the archive and the failure
    // surfaces later as a corrupt zip.
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} for ${URL}`);
    }
    if (!response.body) {
      throw new Error("Failed to fetch the response body.");
    }

    const stream = Readable.fromWeb(response.body);
    await writeFile(tmpZip, stream);

    const directory = await unzipper.Open.file(tmpZip);
    await directory.extract({ path: extStorage });
    // Handle Windows
    // TODO: Is there a better way to handle this?
    if (process.platform === "win32") {
      await fs.promises.chmod(path.join(extStorage, "vale-ls.exe"), 0o755);
    } else {
      await fs.promises.chmod(path.join(extStorage, "vale-ls"), 0o755);
    }
    await fs.promises.unlink(tmpZip);

    // Written last so that a failed extract isn't recorded as a success.
    await writeFile(serverVersionFile(context), TAG);

    vscode.window.showInformationMessage(
      `Vale Language Server ${TAG} downloaded`
    );
  } catch (error) {
    console.error("Download failed:", error);
    throw error;
  }
}

type valeConfigOptions =
  | "configPath"
  | "syncOnStartup"
  | "filter"
  | "installVale"
  | "valeBinaryPath"
  | "lintOnChange"
  | "debounceMs"
  | "showMetrics";

interface valeArgs {
  value: string;
}

/**
 * Asks the language server to run one of its commands.
 *
 * The server owns Vale: it knows which binary to run, which configuration
 * applies, and where a document's `StylesPath` lives. Shelling out to `vale`
 * from here would resolve none of that.
 */
async function executeServerCommand(
  command: string,
  ...args: unknown[]
): Promise<unknown> {
  if (!client || !client.isRunning()) {
    throw new Error("The Vale Language Server isn't running.");
  }
  return client.sendRequest("workspace/executeCommand", {
    command,
    arguments: args,
  });
}

/**
 * Adds the selected word to a vocabulary via the language server.
 *
 * `accept` picks between `vocab.add` and `vocab.reject`, which write to
 * `accept.txt` and `reject.txt` respectively.
 */
async function addToVocabulary(accept: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("Vale: No active editor");
    return;
  }

  const term = editor.document.getText(editor.selection).trim();
  if (!term) {
    vscode.window.showErrorMessage("Vale: No text selected");
    return;
  }

  const vocab = vscode.workspace
    .getConfiguration()
    .get<string>("vale.vocabPath");
  if (!vocab) {
    vscode.window.showErrorMessage(
      "Vale: Set vale.vocabPath to name the vocabulary to write to."
    );
    return;
  }

  try {
    await executeServerCommand(accept ? "vocab.add" : "vocab.reject", {
      uri: editor.document.uri.toString(),
      vocab,
      term,
    });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Vale: Failed to update the vocabulary - ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function resolveConfigPath(
  configPathRaw: string,
  workspaceRoot: string
): string {
  let resolvedConfigPath = configPathRaw;

  if (configPathRaw.includes("${workspaceFolder}")) {
    resolvedConfigPath = configPathRaw.replace(
      /\$\{workspaceFolder\}/g,
      workspaceRoot
    );
  } else if (
    configPathRaw.startsWith("./") ||
    (!path.isAbsolute(configPathRaw) && configPathRaw.length > 0)
  ) {
    resolvedConfigPath = path.join(workspaceRoot, configPathRaw);
  }

  return resolvedConfigPath;
}

/**
 * Runs a Vale CLI command and streams the output to the Vale output channel.
 */
async function runValeCommand(
  args: string[],
  workingDir: string
): Promise<void> {
  // Honor the configured binary: a user who relies on the server to install
  // Vale may have nothing named `vale` on their $PATH at all.
  const exe =
    vscode.workspace.getConfiguration().get<string>("vale.valeCLI.path") ||
    "vale";

  return new Promise<void>((resolve, reject) => {
    const valeProcess = spawn(exe, args, {
      cwd: workingDir,
      shell: true,
    });

    valeProcess.stdout.on("data", (data) => {
      valeOutputChannel.append(data.toString());
    });

    valeProcess.stderr.on("data", (data) => {
      valeOutputChannel.append(data.toString());
    });

    valeProcess.on("error", reject);

    valeProcess.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`vale ${args[0]} exited with code ${code}`));
      }
    });
  });
}

export async function activate(context: ExtensionContext) {
  valeOutputChannel = vscode.window.createOutputChannel("Vale");
  context.subscriptions.push(valeOutputChannel);

  // Prevent multiple activations - stop existing client if present
  if (client) {
    console.log("Vale language client already active, stopping existing client");
    try {
      await client.stop();
    } catch (error) {
      console.error("Error stopping existing client:", error);
    }
  }

  let filePath = path.join(context.extensionPath, "vale-ls");

  // Handle Windows
  // TODO: Is there a better way to handle this?
  if (process.platform === "win32") {
    filePath = path.join(context.extensionPath, "vale-ls.exe");
  }
  let installed = true;
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
  } catch {
    installed = false;
  }

  // A binary that's merely present isn't necessarily the one this release
  // expects: without the version check, an existing install would keep an
  // older server forever.
  if (!installed || !(await isCurrent(context))) {
    console.log(`Downloading language server ${TAG}...`);
    await downloadLSP(context);

    // Verify download succeeded
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
  } else {
    console.log(`Language server ${TAG} exists`);
  }

  console.log("Starting language server");
  const valePath = path.join(context.extensionPath, "vale-ls");
  // TODO: Must be a better way?
  var escapedPath = valePath.replace(/(\s)/, "\\ ");

  // TODO: Factor in https://vale.sh/docs/integrations/guide/#vale-ls
  // Has the user defined a config file manually?
  const configuration = vscode.workspace.getConfiguration();
  // Make global constant for now as will reuse and build upon later
  let valeFilter: valeArgs = { value: "" };
  let filters: string[] = [];

  // Handle old minAlertLevel to output as filter
  if (configuration.get("vale.valeCLI.minAlertLevel") !== "inherited") {
    let minAlertLevel = configuration.get("vale.valeCLI.minAlertLevel");

    if (minAlertLevel === "suggestion") {
      filters.push(`.Level in ["suggestion", "warning", "error"]`);
    }
    if (minAlertLevel === "warning") {
      filters.push(`.Level in ["warning", "error"]`);
    }
    if (minAlertLevel === "error") {
      filters.push(`.Level in ["error"]`);
    }
  }

  // Handle old enableSpellcheck to output as filter
  if (configuration.get("vale.enableSpellcheck") === false) {
    filters.push(`.Extends != "spelling"`);
  }

  // Create combined filters
  // TODO: Test with multiple filters
  if (filters.length > 0) {
    valeFilter = filters.join(" and ") as unknown as valeArgs;
  }

  // Get the config path as a string
  let configPathRaw = configuration.get<string>("vale.valeCLI.config") || "";

  // Resolve workspace folder
  let resolvedConfigPath = configPathRaw;
  if (
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
  ) {
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    resolvedConfigPath = resolveConfigPath(configPathRaw, workspaceRoot);
  }

  let valeConfig: Record<valeConfigOptions, valeArgs> = {
    configPath: resolvedConfigPath as unknown as valeArgs,
    syncOnStartup: configuration.get("vale.valeCLI.syncOnStartup") as valeArgs,
    filter: valeFilter as unknown as valeArgs,
    // TODO: Build into proper onboarding
    installVale: configuration.get("vale.valeCLI.installVale") as valeArgs,
    // Supported by the language server as of v0.5.0.
    //
    // The server turns the last three on unless it's told otherwise, so they
    // are forwarded explicitly to keep the VS Code settings authoritative.
    valeBinaryPath: (configuration.get<string>("vale.valeCLI.path") ||
      "") as unknown as valeArgs,
    lintOnChange: configuration.get("vale.valeCLI.lintOnChange") as valeArgs,
    debounceMs: configuration.get("vale.valeCLI.debounceMs") as valeArgs,
    showMetrics: configuration.get("vale.valeCLI.showMetrics") as valeArgs,
  };

  // TODO: So do I need the below?
  let tempArgs: never[] = [];
  let serverOptions: ServerOptions = {
    run: { command: escapedPath, args: tempArgs },
    debug: { command: escapedPath, args: tempArgs },
  };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // TODO: Refine
    initializationOptions: valeConfig,
    documentSelector: [{ scheme: "file", language: "*" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
    },
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    "vale",
    "Vale VSCode",
    serverOptions,
    clientOptions
  );

  try {
    await client.start();
  } catch (err) {
    console.error(err);
    vscode.window.showErrorMessage("Failed to start Vale Language Server");
    throw err;
  }

  // Register vocabulary commands
  const addToAcceptCommand = vscode.commands.registerCommand(
    "vale.addToAcceptList",
    () => addToVocabulary(true)
  );

  const addToRejectCommand = vscode.commands.registerCommand(
    "vale.addToRejectList",
    () => addToVocabulary(false)
  );

  // Helper function to run vale sync
  //
  // The server reports the outcome itself, via `window/showMessage`.
  const runValeSync = async () => {
    try {
      await executeServerCommand("cli.sync");
    } catch (error) {
      console.error("Vale sync failed:", error);
      vscode.window.showErrorMessage(
        `Vale: Sync failed - ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  // Register vale.sync command
  const syncCommand = vscode.commands.registerCommand("vale.sync", runValeSync);

  // Register vale.install command - installs or updates the Vale CLI
  const installCommand = vscode.commands.registerCommand(
    "vale.install",
    async () => {
      try {
        await executeServerCommand("cli.install");
      } catch (error) {
        vscode.window.showErrorMessage(
          `Vale: Failed to install Vale - ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  );

  // Register vale.showConfig command - runs `vale ls-config` and shows output
  //
  // The server has no command for this, so it stays on the CLI -- but it uses
  // the configured binary rather than whatever `vale` is on $PATH.
  const showConfigCommand = vscode.commands.registerCommand(
    "vale.showConfig",
    async () => {
      try {
        const workingDir =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

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

  // Register vale.showMetrics command - asks the server for the active file's
  // metrics, which it reports via `window/showMessage`.
  const showMetricsCommand = vscode.commands.registerCommand(
    "vale.showMetrics",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Vale: No active editor");
        return;
      }

      try {
        await executeServerCommand("doc.metrics", {
          uri: editor.document.uri.toString(),
        });
      } catch (error) {
        vscode.window.showErrorMessage(
          `Vale: Failed to show metrics - ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  );

  // Register the Vale commands TreeView in the Explorer sidebar
  const valeCommandsProvider = new ValeCommandsProvider();
  const valeTreeView = vscode.window.createTreeView("valeCommands", {
    treeDataProvider: valeCommandsProvider,
    showCollapseAll: false,
  });

  context.subscriptions.push(
    addToAcceptCommand,
    addToRejectCommand,
    syncCommand,
    installCommand,
    showConfigCommand,
    showMetricsCommand,
    valeTreeView
  );

  // The server syncs on startup itself when told to, so running it here as
  // well would sync twice.
}

export async function deactivate(): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.stop();
    console.log("Vale language server stopped");
  } catch (error) {
    console.error("Error stopping Vale language server:", error);
  }
}

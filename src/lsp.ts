import { workspace, ExtensionContext } from "vscode";
import * as vscode from "vscode";

import { writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import * as unzipper from "unzipper";
import fs from "fs";
import * as path from "path";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient;

export function getArch(): String | null {
  if (process.arch == "x64") return "x86_64";
  if (process.arch == "arm64") return "aarch64";
  else {
    vscode.window.showErrorMessage("Unsupported architecture: " + process.arch);
    return null;
  }
}

export function getPlatform(): String | null {
  if (process.platform == "darwin") return "apple-darwin";
  if (process.arch == "arm64" && process.platform == "win32")
    return "pc-windows-msvc";
  if (process.arch == "x64" && process.platform == "win32")
    return "pc-windows-gnu";
  if (process.platform == "linux") return "unknown-linux-gnu";
  else {
    vscode.window.showErrorMessage("Unsupported platform: " + process.platform);
    return null;
  }
}

async function downloadLSP(context: ExtensionContext): Promise<void> {
  const TAG = "v0.4.0";
  let URL: string;
  if (getArch() == "arm64" && getPlatform() == "win32") {
    URL = `https://github.com/errata-ai/vale-ls/releases/download/${TAG}/vale-ls-aarch64-pc-windows-msvc.zip`;
  } else {
    URL = `https://github.com/errata-ai/vale-ls/releases/download/${TAG}/vale-ls-${getArch()}-${getPlatform()}.zip`;
  }
  const extStorage = context.extensionPath;
  const tmpZip = path.join(extStorage, "vale-ls.zip");

  try {
    vscode.window.showInformationMessage(
      "First launch: Downloading Vale Language Server"
    );

    const response = await fetch(URL);
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

    vscode.window.showInformationMessage(
      "First launch: Vale Language Server downloaded"
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
  | "installVale";

interface valeArgs {
  value: string;
}

export async function activate(context: ExtensionContext) {
  let filePath = path.join(context.extensionPath, "vale-ls");

  // Handle Windows
  // TODO: Is there a better way to handle this?
  if (process.platform === "win32") {
    filePath = path.join(context.extensionPath, "vale-ls.exe");
  }
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    console.log("Language server exists");
  } catch {
    console.log("Language server not found, downloading...");
    await downloadLSP(context);

    // Verify download succeeded
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
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
  if (filters.length > 0) {
    valeFilter = filters.join(" and ") as unknown as valeArgs;
  }

  let valeConfig: Record<valeConfigOptions, valeArgs> = {
    configPath: configuration.get("vale.valeCLI.configPath") as valeArgs,
    syncOnStartup: configuration.get("vale.valeCLI.syncOnStartup") as valeArgs,
    filter: valeFilter as unknown as valeArgs,
    installVale: configuration.get("vale.valeCLI.installVale") as valeArgs,
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
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

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
let downloadLs = true;

export function getArch(): String | null {
  if (process.arch == "x64") return "x86_64";
  if (process.arch == "arm64") return "aarch64";
  else {
    vscode.window.showErrorMessage("Unsupported architecture: " + process.arch);
    downloadLs = false;
    return null;
  }
}

export function getPlatform(): String | null {
  if (process.platform == "darwin") return "apple-darwin";
  if (process.platform == "win32") return "pc-windows-gnu";
  if (process.platform == "linux") return "unknown-linux-gnu";
  else {
    vscode.window.showErrorMessage("Unsupported platform: " + process.platform);
    downloadLs = false;
    return null;
  }
}

async function downloadLSP(context: ExtensionContext) {
  const TAG = "v0.3.8";
  const URL = `https://github.com/errata-ai/vale-ls/releases/download/${TAG}/vale-ls-${getArch()}-${getPlatform()}.zip`;
  const extStorage = context.extensionPath;
  const tmpZip = path.join(extStorage, "vale-ls.zip");

  vscode.window.showInformationMessage(
    "First launch: Downloading Vale Language Server"
  );

  const response = await fetch(URL);
  if (response.body) {
    const stream = Readable.fromWeb(response.body);
    await writeFile(tmpZip, stream).then(async () => {
      // console.log("Downloaded to " + tmpZip);
      await unzipper.Open.file(tmpZip).then((directory) => {
        // console.log("Extracting to " + extStorage);
        directory
          .extract({ path: extStorage })
          .then(async () => {
            fs.chmodSync(path.join(extStorage, "vale-ls"), 766);
          })
          .finally(() => {
            fs.unlinkSync(tmpZip);
            vscode.window.showInformationMessage(
              "First launch: Vale Language Server downloaded"
            );
          });
      });
    });
  } else {
    throw new Error("Failed to fetch the response body.");
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
  // TODO: Always needs reload on first activate
  const filePath = path.join(context.extensionPath, "vale-ls");
  console.log(filePath);
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    console.log("File exists");
  } catch {
    console.log("File doesn't exist");

    await vscode.workspace.fs
      .createDirectory(context.globalStorageUri)
      .then(async () => {
        await downloadLSP(context);
      });
  } finally {
    const valePath = path.join(context.extensionPath, "vale-ls");
    // TODO: Must be a better way?
    var escapedPath = valePath.replace(/(\s)/, "\\ ");

    // TODO: Factor in https://vale.sh/docs/integrations/guide/#vale-ls
    // Has the user defined a config file manually?
    const configuration = vscode.workspace.getConfiguration();
    // Make global constant for now as will reuse and build upon later
    let valeFilter: valeArgs = { value: "" };
    let filters: string[] = [];

    // console.log("Using  binary: " + escapedPath);

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
      syncOnStartup: configuration.get(
        "vale.valeCLI.syncOnStartup"
      ) as valeArgs,
      filter: valeFilter as unknown as valeArgs,
      installVale: configuration.get("vale.valeCLI.installVale") as valeArgs,
    };
    // console.log(valeConfig);
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

    // Start the client. This will also launch the server
    await client.start().catch((err) => {
      console.error(err);
      vscode.window.showErrorMessage("Failed to start Vale Language Server");
    });
  }
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

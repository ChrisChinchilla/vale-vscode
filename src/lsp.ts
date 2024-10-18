import { workspace, ExtensionContext } from "vscode";
import * as vscode from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

const TAG = "v0.3.8";
const URL =
  "https://github.com/errata-ai/vale-ls/releases/download/{tag}/vale-ls-{arch}-{platform}.zip";

type valeConfigOptions =
  | "configPath"
  | "syncOnStartup"
  | "filter"
  | "installVale";

interface valeArgs {
  value: string;
}

export function getArch(): String {
  if (process.arch == "x64") return "x86_64";
  if (process.arch == "arm64") return "aaarch64";
  else return "unsupported";
}

export function getPlatform(): String {
  if (process.platform == "darwin") return "apple-darwin";
  if (process.platform == "win32") return "pc-windows-gnu";
  else return "unknown-linux-gnu";
}

export function activate(context: ExtensionContext) {
  // Not possible when using `command`?
  // let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
  const valePath = context.extensionPath + "/tmp-bin/vale-ls";
  //let valeArgs: any = new Object();

  // TODO: Factor in https://vale.sh/docs/integrations/guide/#vale-ls
  // Has the user defined a config file manually?
  const configuration = vscode.workspace.getConfiguration();
  // Make global constant for now as will reuse and build upon later
  let valeFilter: valeArgs = { value: "" };
  let filters: string[] = [];
  //   let customConfigPath = configuration.get<string>("vale.valeCLI.config");
  //   if (customConfigPath) {
  //     console.log("Using config: " + customConfigPath);

  //   valeArgs = {configPath: customConfigPath};
  //   }
  // console.log(valeArgs)
  console.log("Using  binary: " + valePath);

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
  console.log(valeConfig);
  // TODO: So do I need the below?
  let tempArgs: never[] = [];
  let serverOptions: ServerOptions = {
    run: { command: valePath, args: tempArgs },
    debug: { command: valePath, args: tempArgs },
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
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

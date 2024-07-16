import { workspace, ExtensionContext } from "vscode";
import * as vscode from "vscode";

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';


let client: LanguageClient;

const TAG = "v0.3.7";
const URL =
  "https://github.com/errata-ai/vale-ls/releases/download/{tag}/vale-ls-{arch}-{platform}.zip";

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
  let valeArgs: any = new Object();

  // TODO: Factor in https://vale.sh/docs/integrations/guide/#vale-ls
  // Has the user defined a config file manually?
  const configuration = vscode.workspace.getConfiguration();
  let customConfigPath = configuration.get<string>("vale.valeCLI.config");
  if (customConfigPath) {
    console.log("Using config: " + customConfigPath);

  valeArgs = {configPath: customConfigPath};
  }
console.log(valeArgs)
  console.log("Using  binary: " + valePath);

  let serverOptions: ServerOptions = {
    run: { command: valePath, args: valeArgs },
    debug: { command: valePath, args: valeArgs},
  };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // TODO: Refine
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

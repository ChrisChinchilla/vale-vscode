import { platform } from "os";
import * as path from "path";
import { workspace, ExtensionContext } from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

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
  // The server is implemented in node
  // let serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  // let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
  const valePath = context.extensionPath + "/tmp-bin/vale-ls";
  let valeArgs: never[] = [];
  // valeArgs.push('');
  console.log("Using  binary: " + valePath);

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    run: { command: valePath, args: valeArgs },
    debug: { command: valePath, args: valeArgs },
  };

  // let serverOptions: ServerOptions = {
  //   run: { module: serverModule, transport: TransportKind.ipc },
  //   debug: {
  //     module: serverModule,
  //     transport: TransportKind.ipc,
  //     options: debugOptions
  //   }
  // };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [{ scheme: "file", language: "*" }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
    },
    };

  // Create the language client and start the client.
  client = new LanguageClient(
    "valeVSCode",
    "Vale VS Code extension",
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

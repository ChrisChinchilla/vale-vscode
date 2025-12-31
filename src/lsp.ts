import { workspace, ExtensionContext } from "vscode";
import * as vscode from "vscode";

import { writeFile, readFile, mkdir, appendFile } from "node:fs/promises";
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

/**
 * Gets all styles paths from Vale's configuration using `vale ls-config`
 */
async function getStylesPathsFromVale(workspaceRoot: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const valeProcess = spawn("vale", ["ls-config"], {
      cwd: workspaceRoot,
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    valeProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    valeProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    valeProcess.on("close", (code) => {
      if (code !== 0) {
        console.error("Vale ls-config failed:", stderr);
        resolve(null);
        return;
      }

      try {
        const config = JSON.parse(stdout);
        // Vale returns the config with Paths array containing the styles paths
        if (config.Paths && Array.isArray(config.Paths) && config.Paths.length > 0) {
          resolve(config.Paths);
        } else {
          console.error("No Paths found in Vale config");
          resolve(null);
        }
      } catch (error) {
        console.error("Failed to parse Vale config:", error);
        resolve(null);
      }
    });

    valeProcess.on("error", (error) => {
      console.error("Failed to run vale ls-config:", error);
      resolve(null);
    });
  });
}

/**
 * Finds the styles path that contains the vocabulary directory, or returns the first path
 */
async function findVocabStylesPath(
  stylesPaths: string[],
  vocabularyName: string
): Promise<string> {
  // Check each path to see if the vocabulary directory already exists
  for (const stylesPath of stylesPaths) {
    const vocabDir = path.join(
      stylesPath,
      "config",
      "vocabularies",
      vocabularyName
    );
    try {
      await fs.promises.access(vocabDir);
      // Directory exists, use this path
      return stylesPath;
    } catch {
      // Directory doesn't exist in this path, continue searching
    }
  }

  // Vocabulary doesn't exist in any path, use the first one
  return stylesPaths[0];
}

/**
 * Adds a word to a vocabulary file (accept.txt or reject.txt)
 */
async function addToVocabulary(
  word: string,
  vocabularyName: string,
  fileName: "accept.txt" | "reject.txt",
  workspaceRoot: string
): Promise<void> {
  // Get all styles paths from Vale using ls-config
  const stylesPaths = await getStylesPathsFromVale(workspaceRoot);

  if (!stylesPaths || stylesPaths.length === 0) {
    throw new Error(
      "Could not get styles paths from Vale. Make sure Vale is installed and a .vale.ini file exists."
    );
  }

  // Find which path contains the vocabulary directory (or use first if none exist)
  const stylesPath = await findVocabStylesPath(stylesPaths, vocabularyName);

  // Build the vocabulary folder path: <StylesPath>/config/vocabularies/<name>/
  const vocabDir = path.join(
    stylesPath,
    "config",
    "vocabularies",
    vocabularyName
  );

  // Create the directory structure if it doesn't exist
  await mkdir(vocabDir, { recursive: true });

  // Path to the vocabulary file
  const vocabFile = path.join(vocabDir, fileName);

  // Check if the file exists and if the word is already in it
  let fileContent = "";
  try {
    fileContent = await readFile(vocabFile, "utf-8");
  } catch (error) {
    // File doesn't exist yet, will be created
  }

  const lines = fileContent.split("\n").map((line) => line.trim());
  if (lines.includes(word)) {
    vscode.window.showInformationMessage(
      `"${word}" is already in ${fileName}`
    );
    return;
  }

  // Append the word to the file
  await appendFile(vocabFile, `${word}\n`);

  vscode.window.showInformationMessage(
    `Added "${word}" to ${fileName} in vocabulary "${vocabularyName}"`
  );
}

export async function activate(context: ExtensionContext) {
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
  }

  let valeConfig: Record<valeConfigOptions, valeArgs> = {
    configPath: resolvedConfigPath as unknown as valeArgs,
    syncOnStartup: configuration.get("vale.valeCLI.syncOnStartup") as valeArgs,
    filter: valeFilter as unknown as valeArgs,
    // TODO: Build into proper onboarding
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

  // Register vocabulary commands
  const addToAcceptCommand = vscode.commands.registerCommand(
    "vale.addToAcceptList",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const selection = editor.selection;
      const word = editor.document.getText(selection).trim();

      if (!word) {
        vscode.window.showErrorMessage("No text selected");
        return;
      }

      // Get vocabulary path from settings
      const vocabPath = configuration.get<string>("vale.vocabPath");
      if (!vocabPath) {
        vscode.window.showErrorMessage(
          "Please set vale.vocabPath in your settings to use vocabulary features"
        );
        return;
      }

      try {
        // Use workspace root or file's directory as working directory for vale ls-config
        const workingDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                          path.dirname(editor.document.uri.fsPath);
        await addToVocabulary(word, vocabPath, "accept.txt", workingDir);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to add word: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  const addToRejectCommand = vscode.commands.registerCommand(
    "vale.addToRejectList",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const selection = editor.selection;
      const word = editor.document.getText(selection).trim();

      if (!word) {
        vscode.window.showErrorMessage("No text selected");
        return;
      }

      // Get vocabulary path from settings
      const vocabPath = configuration.get<string>("vale.vocabPath");
      if (!vocabPath) {
        vscode.window.showErrorMessage(
          "Please set vale.vocabPath in your settings to use vocabulary features"
        );
        return;
      }

      try {
        // Use workspace root or file's directory as working directory for vale ls-config
        const workingDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                          path.dirname(editor.document.uri.fsPath);
        await addToVocabulary(word, vocabPath, "reject.txt", workingDir);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to add word: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  context.subscriptions.push(addToAcceptCommand, addToRejectCommand);
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

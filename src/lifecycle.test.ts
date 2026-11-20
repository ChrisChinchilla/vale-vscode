import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import type * as vscode from "vscode";

// Stub host services so these tests exercise activate's actual startup checks.
test("explicit configurations start an idle workspace, including folder settings", async () => {
  const loader = Module as typeof Module & {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = loader._load;
  const disposable = { dispose() {} };
  const noop = () => disposable;
  let configPaths = new Map<unknown, string>();
  let folders: { uri: string }[] | undefined;
  let starts = 0;
  let onConfigurationChange!: (event: { affectsConfiguration: (key: string) => boolean }) => void;
  let onOpenDocument!: () => void;
  const workspace = {
    get workspaceFolders() { return folders; },
    textDocuments: [{ uri: { scheme: "file" }, languageId: "python" }],
    isTrusted: true,
    getConfiguration: (_section: string, uri?: unknown) => ({
      get: (key: string) => key === "startOnLanguages"
        ? ["markdown"] : configPaths.get(uri),
    }),
    findFiles: async () => [],
    createFileSystemWatcher: () => ({ ...disposable, onDidCreate: noop }),
    onDidOpenTextDocument: (callback: typeof onOpenDocument) => {
      onOpenDocument = callback;
      return disposable;
    },
    onDidChangeConfiguration: (callback: typeof onConfigurationChange) => {
      onConfigurationChange = callback;
      return disposable;
    },
  };
  const stubs: Record<string, unknown> = {
    vscode: {
      workspace,
      env: {},
      window: { onDidChangeActiveTextEditor: noop },
    },
    "detect-libc": { family: async () => null },
    "./ui": {
      createValeOutputChannel: () => ({ appendLine() {} }),
      createReadabilitySurfaces: noop,
      createLanguageStatus: noop,
    },
    "./languageServer": {
      hasActiveClients: () => false,
      ensureLanguageServerBinary: async () => "server",
      startClientsForCurrentWorkspace: async () => { starts++; },
      registerWorkspaceFolderWatcher: noop,
      registerConfigurationWatcher: noop,
      registerValeConfigFileWatcher: noop,
    },
    "./cli": { killActiveValeProcesses: noop },
    "./commands": { registerCommands: noop },
    "./codeActions": { registerCodeActions: noop },
  };
  loader._load = (request, parent, isMain) =>
    Object.hasOwn(stubs, request) ? stubs[request] : originalLoad(request, parent, isMain);
  const modulePath = require.resolve("./lifecycle");
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { activate } = require("./lifecycle") as typeof import("./lifecycle.js");
    const activateFresh = async () => {
      starts = 0;
      await activate({ subscriptions: [] } as unknown as vscode.ExtensionContext);
    };
    for (const scopedFolders of [undefined, [{ uri: "first" }], [{ uri: "first" }, { uri: "second" }]]) {
      folders = scopedFolders;
      const scope = folders?.at(-1)?.uri;
      configPaths = new Map([[scope, "/external/vale.ini"]]);
      await activateFresh();
      assert.equal(starts, 1, "an explicit configuration starts without a listed language");
    }

    folders = [{ uri: "first" }, { uri: "second" }];
    configPaths = new Map();
    await activateFresh();
    assert.equal(starts, 0, "unlisted languages without a configuration stay idle");
    configPaths.set("second", "/external/vale.ini");
    onConfigurationChange({ affectsConfiguration: (key) => key === "vale.valeCLI.config" });
    // Allow the event handler's asynchronous startup to finish.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(starts, 1, "selecting a configuration starts an idle server");
    onOpenDocument();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(starts, 1, "later document opens do not restart the server");
  } finally {
    loader._load = originalLoad;
    delete require.cache[modulePath];
  }
});

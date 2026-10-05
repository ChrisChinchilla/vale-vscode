import assert from "node:assert/strict";
import * as vscode from "vscode";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  ensureLanguageServerBinary,
  startClientForFolder,
  stopAndRemoveClient,
} from "../../../src/languageServer";
import { getExecutableName, LSP_TAG } from "../../../src/utils";
import { createValeOutputChannel } from "../../../src/ui";
import { clientKeyFor } from "../../../src/workspaceFolders";

const FAKE_LANGUAGE_SERVER = `#!/usr/bin/env node
const fs = require("node:fs");

let input = Buffer.alloc(0);

function respond(id, result) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(
    "Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body
  );
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk]);

  while (true) {
    const headerEnd = input.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) return;

    const header = input.subarray(0, headerEnd).toString();
    const match = /Content-Length: (\\d+)/i.exec(header);
    if (!match) process.exit(1);

    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (input.length < bodyStart + length) return;

    const message = JSON.parse(
      input.subarray(bodyStart, bodyStart + length).toString()
    );
    input = input.subarray(bodyStart + length);

    if (message.method === "initialize") {
      fs.writeFileSync(
        process.env.VALE_TEST_INITIALIZE_CAPTURE,
        JSON.stringify(message.params.initializationOptions)
      );
      respond(message.id, { capabilities: {} });
    } else if (message.method === "shutdown") {
      respond(message.id, null);
    } else if (message.method === "exit") {
      process.exit(0);
    }
  }
});
`;

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(
    "chrischinchilla.vale-vscode"
  );
  assert.ok(extension, "development extension should be installed");
  const expectedTrusted = process.env.VALE_TEST_EXPECT_TRUSTED === "true";
  assert.equal(vscode.workspace.isTrusted, expectedTrusted);

  const manifest = extension.packageJSON as {
    extensionKind?: string[];
    capabilities?: {
      untrustedWorkspaces?: { restrictedConfigurations?: string[] };
    };
  };
  assert.deepEqual(
    manifest.extensionKind,
    ["workspace"],
    "Vale must prefer the remote workspace extension host"
  );
  const restricted =
    manifest.capabilities?.untrustedWorkspaces?.restrictedConfigurations ?? [];
  for (const setting of [
    "vale.valeCLI.path",
    "vale.valeCLI.config",
    "vale.valeCLI.syncOnStartup",
    "vale.docker.enabled",
    "vale.docker.image",
    "vale.docker.extraArgs",
  ]) {
    assert.ok(restricted.includes(setting), `${setting} should be trust-gated`);
  }

  // Exercise the production libc gate inside the extension host (#123).
  // CI runs on glibc Linux; a current cached binary avoids downloads and
  // isolates binary resolution from starting the server or invoking Vale.
  const storagePath = await mkdtemp(path.join(os.tmpdir(), "vale-libc-test-"));
  const subscriptions: vscode.Disposable[] = [];
  const context = {
    globalStorageUri: vscode.Uri.file(storagePath),
    subscriptions,
  } as vscode.ExtensionContext;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "integration test should have a workspace folder");
  const capturePath = path.join(storagePath, "initialize-options.json");
  const originalCapturePath = process.env.VALE_TEST_INITIALIZE_CAPTURE;
  try {
    createValeOutputChannel(context);
    const binaryPath = path.join(storagePath, getExecutableName(process.platform));
    await writeFile(binaryPath, "cached binary fixture; never executed");
    await writeFile(path.join(storagePath, ".vale-ls-version"), LSP_TAG);
    assert.equal(
      await ensureLanguageServerBinary(context),
      binaryPath,
      "the extension host should accept the cached server on a supported libc"
    );

    // Replace the inert cache fixture with a minimal LSP server that records
    // the initialization options sent across the real LanguageClient process
    // boundary. The fixture workspace enables vale.valeCLI.noGlobal.
    await writeFile(binaryPath, FAKE_LANGUAGE_SERVER);
    await chmod(binaryPath, 0o755);
    process.env.VALE_TEST_INITIALIZE_CAPTURE = capturePath;

    await startClientForFolder(binaryPath, context, folder);
    const initializationOptions = JSON.parse(
      await readFile(capturePath, "utf8")
    ) as { noGlobal?: boolean };
    assert.equal(
      initializationOptions.noGlobal,
      true,
      "vale.valeCLI.noGlobal should reach vale-ls initialization options"
    );
  } finally {
    await stopAndRemoveClient(clientKeyFor(folder));
    if (originalCapturePath === undefined) {
      delete process.env.VALE_TEST_INITIALIZE_CAPTURE;
    } else {
      process.env.VALE_TEST_INITIALIZE_CAPTURE = originalCapturePath;
    }
    for (const disposable of subscriptions) disposable.dispose();
    await rm(storagePath, { recursive: true, force: true });
  }
}

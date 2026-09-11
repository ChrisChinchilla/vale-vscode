import assert from "node:assert/strict";
import * as vscode from "vscode";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ensureLanguageServerBinary } from "../../../src/languageServer";
import { getExecutableName, LSP_TAG } from "../../../src/utils";
import { createValeOutputChannel } from "../../../src/ui";

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
  } finally {
    for (const disposable of subscriptions) disposable.dispose();
    await rm(storagePath, { recursive: true, force: true });
  }
}

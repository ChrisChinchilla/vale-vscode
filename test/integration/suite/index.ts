import assert from "node:assert/strict";
import * as vscode from "vscode";

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
}

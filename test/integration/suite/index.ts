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
    contributes?: { commands?: { command: string }[] };
  };

  // Regression test for #129: an exception during startup diagnostics (the
  // libc detection added for #123, or the active-client bookkeeping) used to
  // silently abort activate() *before* registerCommands() ran, leaving every
  // `vale.*` command reporting "command not found" with no visible error.
  // Activation succeeding here doesn't by itself prove that ordering is
  // still correct if the code regresses back to registering commands last -
  // it only catches the regression when startup diagnostics actually throw
  // in this environment, which the CI extension host may not reproduce. The
  // command-registration assertion below is the part that would still catch
  // a reordering regression even without such a throw.
  await extension.activate();
  assert.ok(extension.isActive, "extension should report itself active");
  const registeredCommands = new Set(await vscode.commands.getCommands(true));
  const declaredCommands = manifest.contributes?.commands ?? [];
  assert.ok(declaredCommands.length > 0, "package.json should declare commands");
  for (const { command } of declaredCommands) {
    assert.ok(
      registeredCommands.has(command),
      `${command} should be registered after activation`
    );
  }
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

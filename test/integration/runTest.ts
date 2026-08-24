import * as path from "node:path";
import * as os from "node:os";
import { cp, mkdtemp } from "node:fs/promises";
import { runTests } from "@vscode/test-electron";

async function run(): Promise<void> {
  // Running this script from VS Code's integrated environment can leak the
  // extension host's Electron-as-Node mode into the child VS Code process.
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "suite/index");
  const fixturePath = path.resolve(
    extensionDevelopmentPath,
    "test/fixtures/devcontainer"
  );

  // VS Code always trusts the extension-development host window, so a real
  // Restricted Mode run isn't reachable from here - only the trusted case
  // runs automatically. The untrusted case stays in the manual release
  // matrix (.claude/notes/workspace-trust.md), run against a packaged VSIX
  // in a normal window instead.
  const trusted = true;

  // Keep the test workspace outside extensionDevelopmentPath so this setup
  // can also be reused by a packaged-VSIX Restricted Mode run.
  const runRoot = await mkdtemp(
    path.join(os.tmpdir(), `vale-vscode-${trusted ? "trusted" : "untrusted"}-`)
  );
  const workspacePath = path.join(runRoot, "workspace");
  await cp(fixturePath, workspacePath, { recursive: true });
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv: { VALE_TEST_EXPECT_TRUSTED: String(trusted) },
    launchArgs: [
      workspacePath,
      "--user-data-dir",
      path.join(runRoot, "user-data"),
      ...(trusted ? ["--disable-workspace-trust"] : []),
    ],
  });
}

run().catch((error) => {
  console.error("Extension integration tests failed", error);
  process.exitCode = 1;
});

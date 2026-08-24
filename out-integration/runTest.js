"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const promises_1 = require("node:fs/promises");
const test_electron_1 = require("@vscode/test-electron");
async function run() {
    // Running this script from VS Code's integrated environment can leak the
    // extension host's Electron-as-Node mode into the child VS Code process.
    delete process.env.ELECTRON_RUN_AS_NODE;
    const extensionDevelopmentPath = path.resolve(__dirname, "..");
    const extensionTestsPath = path.resolve(__dirname, "suite/index");
    const fixturePath = path.resolve(extensionDevelopmentPath, "test/fixtures/devcontainer");
    // VS Code always trusts the extension-development host window, so a real
    // Restricted Mode run isn't reachable from here - only the trusted case
    // runs automatically. The untrusted case stays in the manual release
    // matrix (.claude/notes/workspace-trust.md), run against a packaged VSIX
    // in a normal window instead.
    const trusted = true;
    // Keep the test workspace outside extensionDevelopmentPath so this setup
    // can also be reused by a packaged-VSIX Restricted Mode run.
    const runRoot = await (0, promises_1.mkdtemp)(path.join(os.tmpdir(), `vale-vscode-${trusted ? "trusted" : "untrusted"}-`));
    const workspacePath = path.join(runRoot, "workspace");
    await (0, promises_1.cp)(fixturePath, workspacePath, { recursive: true });
    await (0, test_electron_1.runTests)({
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
//# sourceMappingURL=runTest.js.map
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const strict_1 = __importDefault(require("node:assert/strict"));
const vscode = __importStar(require("vscode"));
async function run() {
    const extension = vscode.extensions.getExtension("chrischinchilla.vale-vscode");
    strict_1.default.ok(extension, "development extension should be installed");
    const expectedTrusted = process.env.VALE_TEST_EXPECT_TRUSTED === "true";
    strict_1.default.equal(vscode.workspace.isTrusted, expectedTrusted);
    const manifest = extension.packageJSON;
    strict_1.default.deepEqual(manifest.extensionKind, ["workspace"], "Vale must prefer the remote workspace extension host");
    const restricted = manifest.capabilities?.untrustedWorkspaces?.restrictedConfigurations ?? [];
    for (const setting of [
        "vale.valeCLI.path",
        "vale.valeCLI.config",
        "vale.valeCLI.syncOnStartup",
        "vale.docker.enabled",
        "vale.docker.image",
        "vale.docker.extraArgs",
    ]) {
        strict_1.default.ok(restricted.includes(setting), `${setting} should be trust-gated`);
    }
}
//# sourceMappingURL=index.js.map
import { createHash } from "node:crypto";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import * as path from "node:path";

/**
 * Pure helpers with no dependency on the `vscode` module, so they can be
 * unit tested with Node's built-in test runner instead of the full
 * VS Code extension host.
 */

export const LSP_TAG = "v0.4.0";

/**
 * SHA-256 digests for every vale-ls ${LSP_TAG} release archive, computed
 * from the published GitHub release assets. These must be updated whenever
 * LSP_TAG changes - see .claude/notes/vale-ls-releases.md for how to
 * regenerate them.
 */
export const EXPECTED_CHECKSUMS: Record<string, string> = {
  "vale-ls-aarch64-apple-darwin.zip":
    "5f1fb6237eae2db5dea69a1c95867a4eb3e14b42c08e5365db1d1bfad8d44565",
  "vale-ls-aarch64-pc-windows-msvc.zip":
    "25bdf65416c8ce989e119f07b45a4689125dad8af3bf883ff12e36ce2712de6c",
  "vale-ls-aarch64-unknown-linux-gnu.zip":
    "7ac28161d884ec994d4efa8d79f6a1e9d46453f1f6f366b96f5033be793759bd",
  "vale-ls-x86_64-apple-darwin.zip":
    "fe915f2efc5d9be7822e1dedabd2a368ae3eaab39d36aa7c292fc7ee9bb93fee",
  "vale-ls-x86_64-pc-windows-gnu.zip":
    "e7c672f01bc318ef0d3d10aafc233b5c74d7a9061f04d0312fba01399fcb7c68",
  "vale-ls-x86_64-unknown-linux-gnu.zip":
    "5377a43ab11ef5371fe460e9ff3a5ede826524848c9d73284294451c00bdd3b1",
};

export function detectArch(processArch: string): "x86_64" | "aarch64" | null {
  if (processArch === "x64") return "x86_64";
  if (processArch === "arm64") return "aarch64";
  return null;
}

export function detectPlatform(
  processPlatform: string,
  processArch: string
): string | null {
  if (processPlatform === "darwin") return "apple-darwin";
  if (processArch === "arm64" && processPlatform === "win32")
    return "pc-windows-msvc";
  if (processArch === "x64" && processPlatform === "win32")
    return "pc-windows-gnu";
  if (processPlatform === "linux") return "unknown-linux-gnu";
  return null;
}

export function getExecutableName(processPlatform: string): string {
  return processPlatform === "win32" ? "vale-ls.exe" : "vale-ls";
}

export function buildDownloadAssetName(
  processPlatform: string,
  processArch: string
): string | null {
  const arch = detectArch(processArch);
  const platform = detectPlatform(processPlatform, processArch);
  if (arch === null || platform === null) return null;
  return `vale-ls-${arch}-${platform}.zip`;
}

export function getExpectedChecksum(assetName: string): string | null {
  return EXPECTED_CHECKSUMS[assetName] ?? null;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function verifyChecksum(buffer: Buffer, expectedHex: string): boolean {
  return sha256Hex(buffer).toLowerCase() === expectedHex.toLowerCase();
}

/**
 * Spawn options for running the `vale` CLI. Deliberately omits `shell`;
 * passing argv as an array with no shell avoids shell-metacharacter
 * injection from untrusted values (e.g. file paths) reaching a shell.
 */
export function buildValeSpawnOptions(
  cwd: string
): SpawnOptionsWithoutStdio {
  return { cwd };
}

/**
 * Builds the combined Vale filter expression `vale.valeCLI.minAlertLevel`
 * and `vale.enableSpellcheck` translate to, since vale-ls only accepts a
 * single `filter` option rather than these two legacy settings directly.
 */
export function buildValeFilterExpression(
  minAlertLevel: string,
  enableSpellcheck: boolean
): string {
  const filters: string[] = [];

  if (minAlertLevel === "suggestion") {
    filters.push(`.Level in ["suggestion", "warning", "error"]`);
  } else if (minAlertLevel === "warning") {
    filters.push(`.Level in ["warning", "error"]`);
  } else if (minAlertLevel === "error") {
    filters.push(`.Level in ["error"]`);
  }

  if (!enableSpellcheck) {
    filters.push(`.Extends != "spelling"`);
  }

  return filters.join(" and ");
}

export function resolveConfigPath(
  configPathRaw: string,
  workspaceRoot: string
): string {
  let resolvedConfigPath = configPathRaw;

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

  return resolvedConfigPath;
}

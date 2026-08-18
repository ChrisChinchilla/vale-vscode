import * as vscode from "vscode";
import { ExtensionContext } from "vscode";

import { mkdir } from "node:fs/promises";
import fs from "fs";
import * as path from "path";

import { buildDockerWrapperScript, sha256Hex } from "./utils";
import { getInstallDir } from "./languageServer";

export function getWindowsDockerProxyPath(
  context: ExtensionContext
): string | undefined {
  const architecture = process.arch === "x64"
    ? "x64"
    : process.arch === "arm64"
      ? "arm64"
      : undefined;
  if (!architecture) {
    return undefined;
  }
  const proxyPath = path.join(
        context.extensionPath,
        "native",
        "vale-docker-proxy",
        "bin",
        `vale-docker-proxy-windows-${architecture}.exe`
      );
  return fs.existsSync(proxyPath) ? proxyPath : undefined;
}

/**
 * Generates the wrapper script `vale.docker.enabled` mode points vale-ls's
 * `valeBinaryPath` at, so vale-ls keeps invoking what looks like a normal
 * `vale` binary while the actual linting happens inside a Docker container.
 * See `.claude/notes/docker-support.md`.
 */

/**
 * Each workspace folder gets its own wrapper script, named from a hash of
 * the folder's URI. Folders run independent vale-ls processes
 * (`languageServer.ts`'s `startClientForFolder`) and can have different
 * roots, images, or extraArgs, so a single shared filename would let one
 * folder's settings silently overwrite the script another folder's
 * already-running vale-ls invokes on every lint.
 */
function wrapperScriptName(folder: vscode.WorkspaceFolder): string {
  const suffix = sha256Hex(Buffer.from(folder.uri.toString())).slice(0, 16);
  return `vale-docker-wrapper-${suffix}`;
}

export async function ensureDockerWrapperScript(
  context: ExtensionContext,
  folder: vscode.WorkspaceFolder,
  image: string,
  workspaceRoot: string,
  extraArgs: string[]
): Promise<string> {
  const installDir = getInstallDir(context);
  await mkdir(installDir, { recursive: true });

  const scriptPath = path.join(installDir, wrapperScriptName(folder));
  const content = buildDockerWrapperScript(
    image,
    workspaceRoot,
    extraArgs
  );

  await fs.promises.writeFile(scriptPath, content, { mode: 0o755 });
  await fs.promises.chmod(scriptPath, 0o755);

  return scriptPath;
}

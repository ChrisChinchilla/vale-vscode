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

/**
 * Quotes `value` for safe embedding as a literal in a POSIX shell script
 * (single-quoted, with embedded `'` escaped as `'\''`). Used when writing
 * the Docker wrapper script: unlike `spawn`'s argv array, text baked into a
 * script file is interpreted by a shell, so paths/args containing spaces or
 * shell metacharacters must be quoted to avoid injection.
 */
export function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds the argv for running `vale` inside a Docker container, mounting
 * `workspaceRoot` onto the identical path inside the container so no path
 * translation is needed anywhere else - vale-ls and the rest of the
 * extension already pass around host-absolute paths end-to-end (see
 * `resolveConfigPath` and the `cwd: workspaceRoot` fix for glob sections).
 *
 * Deliberately does not prepend a `"vale"` command: the default
 * `jdkato/vale` image (and any image following its convention) already
 * sets `ENTRYPOINT ["/bin/vale"]`, so `valeArgs` are the container's actual
 * argv - adding a literal `"vale"` would make Vale see it as an unwanted
 * extra positional argument and misparse every subcommand.
 *
 * Includes `-i` (keep stdin open) for parity with the Windows proxy
 * (`native/vale-docker-proxy`), which forwards stdin explicitly - without
 * it, the container's stdin is closed immediately regardless of what the
 * host process has open, silently dropping anything vale-ls pipes in.
 */
export function buildDockerRunArgs(
  image: string,
  workspaceRoot: string,
  valeArgs: string[],
  extraArgs: string[] = []
): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "-v",
    `${workspaceRoot}:${workspaceRoot}`,
    "-w",
    workspaceRoot,
    ...extraArgs,
    image,
    ...valeArgs,
  ];
}

/**
 * Maps `process.arch` to the architecture suffix `vale-docker-proxy`'s
 * shipped binaries use (`native/vale-docker-proxy/bin/
 * vale-docker-proxy-windows-<arch>.exe`), or `null` when this extension
 * doesn't build a proxy for that architecture. Distinct from `detectArch`,
 * which uses Rust-target-triple-style names (`x86_64`/`aarch64`) for the
 * unrelated vale-ls download asset names.
 */
export function resolveWindowsDockerProxyArch(
  processArch: string
): "x64" | "arm64" | null {
  if (processArch === "x64") return "x64";
  if (processArch === "arm64") return "arm64";
  return null;
}

export interface DockerOptions {
  image: string;
  extraArgs: string[];
  proxyPath?: string;
}

export interface ValeExecutionOptions {
  binaryPath: string;
  docker?: DockerOptions;
  dockerUnavailableReason?: string;
}

/** Resolves the executable used by both vale-ls and direct Vale commands. */
export function resolveValeExecutionSettings(
  binaryPath: string | undefined,
  dockerEnabled: boolean,
  workspaceRoot: string | undefined,
  platform: string,
  dockerImage: string | undefined,
  dockerExtraArgs: string[] | undefined,
  windowsProxyPath?: string,
  windowsProxyUnavailableReason?: string
): ValeExecutionOptions {
  const localBinaryPath = binaryPath || "vale";
  if (!dockerEnabled) {
    return { binaryPath: localBinaryPath };
  }

  if (!workspaceRoot) {
    return {
      binaryPath: localBinaryPath,
      dockerUnavailableReason:
        "Docker mode requires a workspace folder and has been ignored for this window.",
    };
  }

  if (platform === "win32" && !windowsProxyPath) {
    return {
      binaryPath: localBinaryPath,
      dockerUnavailableReason:
        windowsProxyUnavailableReason ??
        "Docker mode requires the Windows Docker proxy, which isn't available. Using the configured local Vale binary instead.",
    };
  }

  return {
    binaryPath: localBinaryPath,
    docker: {
      image: dockerImage || "jdkato/vale",
      extraArgs: dockerExtraArgs ?? [],
      ...(platform === "win32" && windowsProxyPath
        ? { proxyPath: windowsProxyPath }
        : {}),
    },
  };
}

export function buildDockerProxyEnvironment(
  docker: DockerOptions,
  workspaceRoot: string
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VALE_DOCKER_PROXY_CONFIG: JSON.stringify({
      image: docker.image,
      root: workspaceRoot,
      extraArgs: docker.extraArgs,
    }),
  };
}

/**
 * Generates the content of the wrapper script vale-ls's `valeBinaryPath`
 * points at when Docker mode is enabled. vale-ls spawns `valeBinaryPath`
 * directly with no shell, so it needs a real executable file rather than a
 * bare `docker run ...` command line. vale-ls invokes `valeBinaryPath`
 * exactly as it would a normal `vale` binary (i.e. with vale's own args,
 * not prefixed by the word "vale"), and the default `jdkato/vale` image
 * already sets `ENTRYPOINT ["/bin/vale"]` - so, like `buildDockerRunArgs`,
 * this doesn't add a literal `"vale"` before the forwarded arguments.
 * Also includes `-i` for the same stdin-parity reason as `buildDockerRunArgs`.
 */
export function buildDockerWrapperScript(
  image: string,
  workspaceRoot: string,
  extraArgs: string[] = []
): string {
  const dockerArgs = [
    "run",
    "--rm",
    "-i",
    "-v",
    shellQuoteSingle(`${workspaceRoot}:${workspaceRoot}`),
    "-w",
    shellQuoteSingle(workspaceRoot),
    ...extraArgs.map(shellQuoteSingle),
    shellQuoteSingle(image),
  ].join(" ");
  return `#!/usr/bin/env bash\nset -e\nexec docker ${dockerArgs} "$@"\n`;
}

/**
 * The subset of vale-ls's raw alert JSON (see its `ValeAlert`/`ValeAction`
 * structs) that we need. vale-ls attaches this as each diagnostic's LSP
 * `data` field; vscode-languageclient carries it through at runtime as
 * `diagnostic.data`, but it's not guaranteed to be present or to have an
 * `Action` - not every alert is actionable, and some LSP transports drop
 * unrecognized fields. An earlier version of this extension read
 * `alert.Action.Name` with no guard, which crashed the whole code action
 * provider (and any diagnostics rendered from it) whenever an alert lacked
 * an `Action` - see https://github.com/ChrisChinchilla/vale-vscode/issues/25.
 */
export interface ValeAlertData {
  Action?: {
    Name?: string;
    Params?: string[];
  };
}

/**
 * Extracts the "Replace with '...'" candidates for a substitution-rule
 * alert (e.g. `whatif: what if|options|more`) from vale-ls's alert data,
 * reading them straight out of the `data` field instead of going through
 * its `fix` RPC, which has historically collapsed multiple alternatives
 * into duplicates. Returns an empty array for anything that isn't a
 * `replace` action with at least one param, including missing/malformed
 * `data` - deliberately tolerant, since a malformed alert should just
 * produce no quick fixes rather than crash the provider (see
 * `ValeAlertData` above). https://github.com/ChrisChinchilla/vale-vscode/issues/7
 */
export function getSubstitutionReplacements(
  data: ValeAlertData | undefined
): string[] {
  const action = data?.Action;
  if (action?.Name !== "replace" || !action.Params?.length) return [];
  return action.Params;
}

/**
 * True for alert data vale-ls's own `fix` RPC would have turned into a
 * `replace`-action quick fix - the case `getSubstitutionReplacements`
 * above now owns. Used to filter those out of what the server returns so
 * they don't stack with our own, correct ones in the same lightbulb menu.
 */
export function isServerReplaceAction(data: ValeAlertData | undefined): boolean {
  return data?.Action?.Name === "replace";
}

/**
 * The oldest Vale CLI version whose `--filter` flag accepts a raw filter
 * expression (e.g. `.Level in ["suggestion", "warning", "error"]`) rather
 * than only a file path or a named asset on `StylesPath`. Older versions
 * fail every lint with `filter '<expr>' not found` as soon as any filter is
 * sent - which happens by default, since `vale.enableSpellcheck` defaults
 * to `false` and `buildValeFilterExpression` always emits
 * `.Extends != "spelling"` in that case. Fixed upstream in
 * https://github.com/errata-ai/vale/commit/c33614918 ("fix: support filters
 * through strings or files"), first released in this version. See
 * https://github.com/ChrisChinchilla/vale-vscode/issues/63 and
 * `.claude/notes/vale-filter-version-check.md`.
 */
export const MIN_VALE_FILTER_VERSION: [number, number, number] = [3, 10, 0];

/**
 * Parses a `vale --version` output line (e.g. `vale version 3.18.0`, or a
 * bare `3.18.0`) into a `[major, minor, patch]` tuple. Returns `null` for
 * anything that doesn't contain a recognizable `X.Y.Z` version.
 */
export function parseValeVersion(
  output: string
): [number, number, number] | null {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `version` is greater than or equal to `minimum`. */
export function isVersionAtLeast(
  version: [number, number, number],
  minimum: [number, number, number]
): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i] !== minimum[i]) return version[i] > minimum[i];
  }
  return true;
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

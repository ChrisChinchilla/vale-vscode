import { spawn, ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";

import * as vscode from "vscode";

import {
  buildDockerProxyEnvironment,
  buildDockerRunArgs,
  buildValeConfigArgs,
  buildValeSpawnOptions,
  valeCommandName,
} from "./utils";
import type { ProbeResult, ValeExecutionOptions, ValeGlobConfig } from "./utils";
import { getValeOutputChannel } from "./ui";

/**
 * Direct invocations of the `vale` CLI (as opposed to the language server).
 */

function spawnVale(
  args: string[],
  workingDir: string,
  execution: ValeExecutionOptions
): ChildProcessWithoutNullStreams {
  const options = buildValeSpawnOptions(workingDir);
  if (execution.docker) {
    if (execution.docker.proxyPath) {
      return spawn(execution.docker.proxyPath, args, {
        ...options,
        env: buildDockerProxyEnvironment(execution.docker, workingDir),
      });
    }
    return spawn(
      "docker",
      buildDockerRunArgs(
        execution.docker.image,
        workingDir,
        args,
        execution.docker.extraArgs
      ),
      options
    );
  }
  return spawn(execution.binaryPath, args, options);
}

/** Thrown when a command is stopped through its cancellation token. */
export class ValeCommandCancelledError extends Error {
  constructor(command: string) {
    super(`vale ${command} was cancelled`);
    this.name = "ValeCommandCancelledError";
  }
}

/** Longest a direct Vale call may run. Generous, since Docker may pull an image first. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** `vale sync` downloads packages, so it gets longer. */
const SYNC_TIMEOUT_MS = 15 * 60_000;
/** Most stdout (in characters) one call may produce before it is stopped. */
const MAX_STDOUT_CHARS = 8 * 1024 * 1024;

interface RunOptions {
  onStdout: (text: string) => void;
  token?: vscode.CancellationToken;
  timeoutMs?: number;
}

const activeProcesses = new Set<ChildProcess>();

/** Stops every Vale process this extension started (called on deactivation). */
export function killActiveValeProcesses(): void {
  for (const child of activeProcesses) child.kill();
  activeProcesses.clear();
}

/**
 * The one place a direct Vale process is run: no shell (see
 * `buildValeSpawnOptions`), a timeout, a cap on stdout, cancellation, and
 * tracking so `killActiveValeProcesses` can stop it. Resolves with the exit
 * code; rejects if the process cannot start, is cancelled, times out, or
 * prints too much.
 */
function runValeProcess(
  args: string[],
  workingDir: string,
  execution: ValeExecutionOptions,
  { onStdout, token, timeoutMs = DEFAULT_TIMEOUT_MS }: RunOptions
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const command = valeCommandName(args);
    const child = spawnVale(args, workingDir, execution);
    activeProcesses.add(child);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    let failure: Error | undefined;
    let stdoutChars = 0;
    const fail = (error: Error) => {
      failure ??= error;
      child.kill();
    };
    const timer = setTimeout(
      () => fail(new Error(`vale ${command} timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs
    );
    const cancellation = token?.onCancellationRequested(() =>
      fail(new ValeCommandCancelledError(command))
    );
    const cleanup = () => {
      clearTimeout(timer);
      cancellation?.dispose();
      activeProcesses.delete(child);
    };

    child.stdout.on("data", (text: string) => {
      stdoutChars += text.length;
      if (stdoutChars > MAX_STDOUT_CHARS) {
        fail(new Error(`vale ${command} printed too much output and was stopped`));
        return;
      }
      onStdout(text);
    });
    child.stderr.on("data", (text: string) => getValeOutputChannel().append(text));

    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (failure) reject(failure);
      else resolve(code);
    });
  });
}

async function runValeChecked(
  args: string[],
  workingDir: string,
  execution: ValeExecutionOptions,
  options: RunOptions
): Promise<void> {
  const code = await runValeProcess(args, workingDir, execution, options);
  if (code !== 0) {
    throw new Error(`vale ${valeCommandName(args)} exited with code ${code}`);
  }
}

const streamingInFlight = new Set<string>();
const capturesInFlight = new Map<string, Promise<string>>();

function callKey(args: string[], workingDir: string): string {
  return [workingDir, ...args].join("\0");
}

/**
 * Runs a Vale CLI command and streams the output to the Vale output channel.
 * Rejects with `ValeCommandCancelledError` if `token` is cancelled (the
 * process is killed), and refuses to start the same command in the same
 * directory twice at once (e.g. a double-clicked **Vale: Sync**).
 */
export async function runValeCommand(
  args: string[],
  workingDir: string,
  execution: ValeExecutionOptions,
  token?: vscode.CancellationToken
): Promise<void> {
  const key = callKey(args, workingDir);
  if (streamingInFlight.has(key)) {
    throw new Error(`vale ${valeCommandName(args)} is already running`);
  }
  streamingInFlight.add(key);
  try {
    const valeOutputChannel = getValeOutputChannel();
    await runValeChecked(args, workingDir, execution, {
      onStdout: (text) => valeOutputChannel.append(text),
      token,
      timeoutMs: SYNC_TIMEOUT_MS,
    });
  } finally {
    streamingInFlight.delete(key);
  }
}

/**
 * Runs a Vale CLI command and returns its stdout instead of streaming it
 * (stderr still goes to the Vale output channel). Identical calls made while
 * one is running share its result, so two startup checks don't start two
 * processes.
 */
export function runValeCommandCapture(
  args: string[],
  workingDir: string,
  execution: ValeExecutionOptions
): Promise<string> {
  const key = callKey(args, workingDir);
  const running = capturesInFlight.get(key);
  if (running) return running;

  let stdout = "";
  const call = runValeChecked(args, workingDir, execution, {
    onStdout: (text) => {
      stdout += text;
    },
  })
    .then(() => stdout)
    .finally(() => capturesInFlight.delete(key));
  capturesInFlight.set(key, call);
  return call;
}

/**
 * Runs `vale --version` and returns its raw output (e.g.
 * `vale version 3.18.0`), or `null` if the process can't be run at all
 * (missing binary, Docker unavailable, etc.) - callers that only want to
 * *warn* about an old Vale should treat that as "couldn't determine the
 * version" rather than an error worth surfacing on its own.
 */
export async function getValeVersionOutput(
  workingDir: string,
  execution: ValeExecutionOptions
): Promise<string | null> {
  try {
    return await runValeCommandCapture(["--version"], workingDir, execution);
  } catch {
    return null;
  }
}

/**
 * Gets all styles paths from Vale's configuration using `vale ls-config`.
 *
 * `configPath`, when given, is an already-resolved absolute path to pass as
 * `--config` - without it, this relies entirely on Vale's own ancestor-search
 * config discovery from `workspaceRoot`, which never finds a config file
 * that lives in a subdirectory rather than at or above that search's
 * starting point. See https://github.com/ChrisChinchilla/vale-vscode/issues/100.
 */
export async function getStylesPathsFromVale(
  workspaceRoot: string,
  execution: ValeExecutionOptions,
  configPath = "",
  noGlobal = false
): Promise<string | null> {
  try {
    const stdout = await runValeCommandCapture(
      [...buildValeConfigArgs(configPath, noGlobal), "ls-config"],
      workspaceRoot,
      execution
    );
    const config = JSON.parse(stdout);
    // Vale returns the config with Paths array containing the styles paths
    if (config.Paths && Array.isArray(config.Paths) && config.Paths.length > 0) {
      // TODO: Hacky. But by default Vale adds a path above to the Application support folder which I don't think many use, and the second in the array is likely the right one.
      return config.Paths[1];
    }
    console.error("No Paths found in Vale config");
  } catch (error) {
    console.error("Failed to read Vale config:", error);
  }
  return null;
}

/**
 * Reads Vale's resolved configuration (`vale ls-config`) for the parts that
 * say which files it lints, or `null` if it can't be read.
 */
export async function getValeConfig(
  workspaceRoot: string,
  execution: ValeExecutionOptions,
  configPath = "",
  noGlobal = false
): Promise<ValeGlobConfig | null> {
  try {
    const stdout = await runValeCommandCapture(
      [...buildValeConfigArgs(configPath, noGlobal), "ls-config"],
      workspaceRoot,
      execution
    );
    return JSON.parse(stdout) as ValeGlobConfig;
  } catch (error) {
    console.error("Failed to read Vale config:", error);
    return null;
  }
}

/**
 * Gets a file's prose metrics (word/sentence/syllable counts, etc.) via
 * `vale ls-metrics`. Reads from disk, like every other direct CLI command,
 * so it reflects a file's last-saved content, not unsaved editor changes.
 */
export async function getFileMetrics(
  filePath: string,
  workspaceRoot: string,
  execution: ValeExecutionOptions,
  configPath = "",
  noGlobal = false
): Promise<ValeFileMetrics | null> {
  try {
    const stdout = await runValeCommandCapture(
      [...buildValeConfigArgs(configPath, noGlobal), "ls-metrics", filePath],
      workspaceRoot,
      execution
    );
    return JSON.parse(stdout) as ValeFileMetrics;
  } catch (error) {
    console.error("Failed to get Vale metrics:", error);
    return null;
  }
}

/** Shape of `vale ls-metrics`' JSON output. Fields are absent, not zero, on an empty file. */
export interface ValeFileMetrics {
  words?: number;
  sentences?: number;
  syllables?: number;
  characters?: number;
  paragraphs?: number;
  complex_words?: number;
  long_words?: number;
  polysyllabic_words?: number;
}

/**
 * Runs `command` once and captures its exit code and output, never
 * rejecting. Used to preflight Docker mode's wrapper script so a container
 * failure shows up in the Output channel with its stderr.
 */
export function probeExecutable(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
  timeoutMs = 120_000
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    // Image pulls on first use can be slow, so this is deliberately generous.
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.on("error", (err) =>
      finish({ exitCode: null, stdout, stderr, spawnError: err.message })
    );
    child.on("close", (code) => finish({ exitCode: code, stdout, stderr }));
  });
}

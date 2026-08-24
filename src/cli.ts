import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

import {
  buildDockerProxyEnvironment,
  buildDockerRunArgs,
  buildValeConfigArgs,
  buildValeSpawnOptions,
} from "./utils";
import type { ValeExecutionOptions } from "./utils";
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

/**
 * Runs a Vale CLI command and streams the output to the Vale output channel.
 */
export async function runValeCommand(
  args: string[],
  workingDir: string,
  execution: ValeExecutionOptions
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const valeOutputChannel = getValeOutputChannel();
    const valeProcess = spawnVale(args, workingDir, execution);

    valeProcess.stdout.on("data", (data) => {
      valeOutputChannel.append(data.toString());
    });

    valeProcess.stderr.on("data", (data) => {
      valeOutputChannel.append(data.toString());
    });

    valeProcess.on("error", reject);

    valeProcess.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`vale ${args[0]} exited with code ${code}`));
      }
    });
  });
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
  return new Promise((resolve) => {
    const valeProcess = spawnVale(["--version"], workingDir, execution);

    let stdout = "";

    valeProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    valeProcess.on("close", (code) => {
      resolve(code === 0 ? stdout : null);
    });

    valeProcess.on("error", () => {
      resolve(null);
    });
  });
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
  configPath = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    const valeProcess = spawnVale(
      [...buildValeConfigArgs(configPath), "ls-config"],
      workspaceRoot,
      execution
    );

    let stdout = "";
    let stderr = "";

    valeProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    valeProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    valeProcess.on("close", (code) => {
      if (code !== 0) {
        console.error("Vale ls-config failed:", stderr);
        resolve(null);
        return;
      }

      try {
        const config = JSON.parse(stdout);
        // Vale returns the config with Paths array containing the styles paths
        if (config.Paths && Array.isArray(config.Paths) && config.Paths.length > 0) {
          // TODO: Hacky. But by default Vale adds a path above to the Application support folder which I don't think many use, and the second in the array is likely the right one.
          resolve(config.Paths[1]);
        } else {
          console.error("No Paths found in Vale config");
          resolve(null);
        }
      } catch (error) {
        console.error("Failed to parse Vale config:", error);
        resolve(null);
      }
    });

    valeProcess.on("error", (error) => {
      console.error("Failed to run vale ls-config:", error);
      resolve(null);
    });
  });
}

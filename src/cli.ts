import { spawn } from "node:child_process";

import { buildValeSpawnOptions } from "./utils";
import { getValeOutputChannel } from "./ui";

/**
 * Direct invocations of the `vale` CLI (as opposed to the language server).
 */

/**
 * Runs a Vale CLI command and streams the output to the Vale output channel.
 */
export async function runValeCommand(
  args: string[],
  workingDir: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const valeOutputChannel = getValeOutputChannel();
    const valeProcess = spawn("vale", args, buildValeSpawnOptions(workingDir));

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
 * Gets all styles paths from Vale's configuration using `vale ls-config`
 */
export async function getStylesPathsFromVale(
  workspaceRoot: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const valeProcess = spawn(
      "vale",
      ["ls-config"],
      buildValeSpawnOptions(workspaceRoot)
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

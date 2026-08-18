import * as vscode from "vscode";

import {
  buildValeFilterExpression,
  resolveConfigPath,
  resolveValeExecutionSettings,
} from "./utils";
import type { ValeExecutionOptions } from "./utils";

export type { ValeExecutionOptions } from "./utils";

export type valeConfigOptions =
  | "configPath"
  | "syncOnStartup"
  | "filter"
  | "installVale"
  | "valeBinaryPath";

export interface valeArgs {
  value: string;
}

/**
 * Resolves the shared execution mode used by vale-ls and every direct Vale
 * command. Unsupported Docker contexts retain the configured local fallback
 * and include a reason callers can surface to the user.
 */
export function resolveValeExecutionOptions(
  configuration: vscode.WorkspaceConfiguration,
  workspaceRoot: string | undefined,
  platform = process.platform,
  windowsProxyPath?: string
): ValeExecutionOptions {
  return resolveValeExecutionSettings(
    configuration.get<string>("vale.valeCLI.path") || undefined,
    configuration.get<boolean>("vale.docker.enabled") ?? false,
    workspaceRoot,
    platform,
    configuration.get<string>("vale.docker.image") || undefined,
    configuration.get<string[]>("vale.docker.extraArgs"),
    windowsProxyPath
  );
}

/**
 * Resolves initializationOptions for one vale-ls client, scoped to
 * `workspaceRoot` (undefined outside a workspace-folder context).
 *
 * `valeBinaryPath` and `dockerModeActive` are resolved by the caller
 * (`languageServer.ts`), which may need to asynchronously generate a Docker
 * wrapper script first - `buildValeConfig` itself stays synchronous.
 */
export function buildValeConfig(
  configuration: vscode.WorkspaceConfiguration,
  workspaceRoot: string | undefined,
  valeBinaryPath?: string,
  dockerModeActive?: boolean
): Record<valeConfigOptions, valeArgs> {
  const minAlertLevel =
    configuration.get<string>("vale.valeCLI.minAlertLevel") ?? "inherited";
  const enableSpellcheck =
    configuration.get<boolean>("vale.enableSpellcheck") ?? false;
  const filterExpression = buildValeFilterExpression(
    minAlertLevel,
    enableSpellcheck
  );

  // Get the config path as a string
  const configPathRaw = configuration.get<string>("vale.valeCLI.config") || "";

  let resolvedConfigPath = configPathRaw;
  if (workspaceRoot) {
    resolvedConfigPath = resolveConfigPath(configPathRaw, workspaceRoot);
  }

  return {
    configPath: resolvedConfigPath as unknown as valeArgs,
    syncOnStartup: configuration.get("vale.valeCLI.syncOnStartup") as valeArgs,
    filter: filterExpression as unknown as valeArgs,
    // TODO: Build into proper onboarding
    // Installing a locally-managed Vale copy is pointless when Docker mode
    // is running vale inside a container instead.
    installVale: (dockerModeActive
      ? false
      : configuration.get("vale.valeCLI.installVale")) as valeArgs,
    valeBinaryPath: (valeBinaryPath ?? "") as unknown as valeArgs,
  };
}

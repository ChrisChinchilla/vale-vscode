import * as vscode from "vscode";

import {
  buildValeFilterExpression,
  resolveConfigPath,
  resolveValeBinaryPath,
  resolveValeExecutionSettings,
} from "./utils";
import type { ValeExecutionOptions } from "./utils";

export type { ValeExecutionOptions } from "./utils";

/** vale-ls `initializationOptions` this extension sends on every client start. */
export interface ValeInitializationOptions {
  configPath: string;
  syncOnStartup: boolean;
  filter: string;
  installVale: boolean;
  valeBinaryPath: string;
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
  windowsProxyPath?: string,
  windowsProxyUnavailableReason?: string
): ValeExecutionOptions {
  const rawBinaryPath = configuration.get<string>("vale.valeCLI.path") || "";

  return resolveValeExecutionSettings(
    rawBinaryPath
      ? resolveValeBinaryPath(rawBinaryPath, workspaceRoot, vscode.workspace.isTrusted)
      : undefined,
    configuration.get<boolean>("vale.docker.enabled") ?? false,
    workspaceRoot,
    platform,
    configuration.get<string>("vale.docker.image") || undefined,
    configuration.get<string[]>("vale.docker.extraArgs"),
    windowsProxyPath,
    windowsProxyUnavailableReason
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
): ValeInitializationOptions {
  const minAlertLevel =
    configuration.get<string>("vale.valeCLI.minAlertLevel") ?? "inherited";
  const enableSpellcheck =
    configuration.get<boolean>("vale.enableSpellcheck") ?? false;
  const customFilter = configuration.get<string>("vale.valeCLI.filter") || "";
  const filterExpression = buildValeFilterExpression(
    minAlertLevel,
    enableSpellcheck,
    customFilter
  );

  // Get the config path as a string
  const configPathRaw = configuration.get<string>("vale.valeCLI.config") || "";

  const resolvedConfigPath = resolveConfigPath(configPathRaw, workspaceRoot);

  return {
    configPath: resolvedConfigPath,
    syncOnStartup:
      configuration.get<boolean>("vale.valeCLI.syncOnStartup") ?? false,
    filter: filterExpression,
    // TODO: Build into proper onboarding
    // Installing a locally-managed Vale copy is pointless when Docker mode
    // is running vale inside a container instead.
    installVale: dockerModeActive
      ? false
      : configuration.get<boolean>("vale.valeCLI.installVale") ?? false,
    valeBinaryPath: valeBinaryPath ?? "",
  };
}

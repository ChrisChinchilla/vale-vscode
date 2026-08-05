import * as vscode from "vscode";

import { buildValeFilterExpression, resolveConfigPath } from "./utils";

export type valeConfigOptions =
  | "configPath"
  | "syncOnStartup"
  | "filter"
  | "installVale";

export interface valeArgs {
  value: string;
}

/**
 * Resolves initializationOptions for one vale-ls client, scoped to
 * `workspaceRoot` (undefined outside a workspace-folder context).
 */
export function buildValeConfig(
  configuration: vscode.WorkspaceConfiguration,
  workspaceRoot: string | undefined
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
    installVale: configuration.get("vale.valeCLI.installVale") as valeArgs,
  };
}

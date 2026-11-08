import * as fs from "node:fs";

import * as vscode from "vscode";

import {
  buildValeFilterExpression,
  findExecutableOnPath,
  managedValeExePath,
  resolveConfigPath,
  resolveEditorBehaviorOptions,
  resolveValeBinaryPath,
  resolveValeExecutionSettings,
  resolveValeSource,
} from "./utils";
import type { ValeExecutionOptions, ValeSourceChoice } from "./utils";

export type { ValeExecutionOptions } from "./utils";

/** vale-ls `initializationOptions` this extension sends on every client start. */
export interface ValeInitializationOptions {
  configPath: string;
  syncOnStartup: boolean;
  filter: string;
  installVale: boolean;
  valeBinaryPath: string;
  noGlobal: boolean;
  lintOnChange: boolean;
  debounceMs: number;
  showMetrics: boolean;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Chooses the Vale that lints this folder (see `resolveValeSource`): the
 * configured path, else the Vale on `PATH`, else the language server's
 * managed copy; `vale.valeCLI.installVale` forces the managed copy.
 * `installDir` is where the language server binary lives.
 */
export function resolveValeSourceForFolder(
  configuration: vscode.WorkspaceConfiguration,
  workspaceRoot: string | undefined,
  installDir: string
): ValeSourceChoice {
  const rawBinaryPath = configuration.get<string>("vale.valeCLI.path") || "";
  return resolveValeSource({
    customPath: rawBinaryPath
      ? resolveValeBinaryPath(rawBinaryPath, workspaceRoot, vscode.workspace.isTrusted) ||
        undefined
      : undefined,
    alwaysManaged: configuration.get<boolean>("vale.valeCLI.installVale") ?? false,
    pathVale: findExecutableOnPath(
      "vale",
      process.env.PATH ?? process.env.Path,
      process.platform,
      isFile
    ),
    managedExe: managedValeExePath(installDir, process.platform),
  });
}

/**
 * Resolves the shared execution mode used by vale-ls and every direct Vale
 * command. Unsupported Docker contexts retain the configured local fallback
 * and include a reason callers can surface to the user.
 */
export function resolveValeExecutionOptions(
  configuration: vscode.WorkspaceConfiguration,
  workspaceRoot: string | undefined,
  installDir: string,
  platform = process.platform,
  windowsProxyPath?: string,
  windowsProxyUnavailableReason?: string
): ValeExecutionOptions {
  return resolveValeExecutionSettings(
    resolveValeSourceForFolder(configuration, workspaceRoot, installDir).binaryPath,
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
  dockerModeActive?: boolean,
  installValeOverride?: boolean
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
    // `installValeOverride` comes from `resolveValeSourceForFolder`: true only
    // when the managed copy is in use (forced, or no Vale on PATH).
    // TODO: Build into proper onboarding
    // Installing a locally-managed Vale copy is pointless when Docker mode
    // is running vale inside a container instead.
    installVale: dockerModeActive
      ? false
      : installValeOverride ?? configuration.get<boolean>("vale.valeCLI.installVale") ?? false,
    valeBinaryPath: valeBinaryPath ?? "",
    noGlobal: configuration.get<boolean>("vale.valeCLI.noGlobal") ?? false,
    ...resolveEditorBehaviorOptions({
      lintOnChange: configuration.get<boolean>("vale.valeCLI.lintOnChange"),
      debounceMs: configuration.get<number>("vale.valeCLI.debounceMs"),
      showMetrics: configuration.get<boolean>("vale.valeCLI.showMetrics"),
    }),
  };
}

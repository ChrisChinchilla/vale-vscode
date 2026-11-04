import * as vscode from "vscode";

import { isValeConfigErrorCode, summarizeLanguageStatus } from "./utils";
import type { ClientState, ClientStatus } from "./utils";

/**
 * UI surfaces: the Vale output channel, the readability status bar item and
 * diagnostics, and the Vale Language Status entry.
 */

const clientStatuses = new Map<string, ClientStatus>();
const configErrorUris = new Set<string>();
let languageStatusItem: vscode.LanguageStatusItem | undefined;

function renderLanguageStatus(): void {
  if (!languageStatusItem) return;
  const summary = summarizeLanguageStatus(
    [...clientStatuses.values()],
    configErrorUris.size
  );
  languageStatusItem.text = summary.text;
  languageStatusItem.detail = summary.detail;
  languageStatusItem.busy = summary.busy;
  languageStatusItem.severity =
    summary.severity === "error"
      ? vscode.LanguageStatusSeverity.Error
      : summary.severity === "warning"
        ? vscode.LanguageStatusSeverity.Warning
        : vscode.LanguageStatusSeverity.Information;
}

/**
 * Creates the single Language Status entry for Vale. It appears for every
 * file document, opens **Vale: Show Diagnostics** when clicked, and counts
 * vale-ls's configuration-error diagnostics (`E###` codes) alongside each
 * client's start/stop state.
 */
export function createLanguageStatus(context: vscode.ExtensionContext): void {
  languageStatusItem = vscode.languages.createLanguageStatusItem("vale.status", {
    scheme: "file",
  });
  languageStatusItem.name = "Vale";
  languageStatusItem.command = {
    command: "vale.showDiagnostics",
    title: "Show Diagnostics",
  };

  const refreshConfigErrors = (uris: readonly vscode.Uri[]) => {
    for (const uri of uris) {
      const hasConfigError = vscode.languages
        .getDiagnostics(uri)
        .some(
          (d) =>
            d.source === "vale-ls" &&
            d.severity === vscode.DiagnosticSeverity.Error &&
            isValeConfigErrorCode(d.code)
        );
      if (hasConfigError) configErrorUris.add(uri.toString());
      else configErrorUris.delete(uri.toString());
    }
    renderLanguageStatus();
  };

  context.subscriptions.push(
    languageStatusItem,
    vscode.languages.onDidChangeDiagnostics((e) => refreshConfigErrors(e.uris)),
    {
      dispose: () => {
        clientStatuses.clear();
        configErrorUris.clear();
        languageStatusItem = undefined;
      },
    }
  );
  renderLanguageStatus();
}

/** Records one client's state (keyed like `clients` in `languageServer.ts`). */
export function setClientStatus(
  key: string,
  name: string,
  state: ClientState,
  detail?: string
): void {
  clientStatuses.set(key, { name, state, detail });
  renderLanguageStatus();
}

/** Forgets a client that was stopped on purpose. */
export function clearClientStatus(key: string): void {
  clientStatuses.delete(key);
  renderLanguageStatus();
}

let readabilityStatusBarItem: vscode.StatusBarItem;
let readabilityDiagnostics: vscode.DiagnosticCollection;

export function createReadabilitySurfaces(
  context: vscode.ExtensionContext
): void {
  readabilityStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  readabilityStatusBarItem.command = "vale.showMetrics";
  readabilityDiagnostics =
    vscode.languages.createDiagnosticCollection("vale-readability");
  context.subscriptions.push(readabilityStatusBarItem, readabilityDiagnostics);
}

/**
 * Displays a file's Flesch-Kincaid grade level per `vale.readabilityProblemLocation`
 * ("status", "inline", or "both"). Called after each **Vale: Show Readability
 * Metrics** run, since that's the only point a grade is actually computed.
 */
export function showReadabilityResult(
  uri: vscode.Uri,
  grade: number | null,
  location: string
): void {
  readabilityDiagnostics.delete(uri);
  readabilityStatusBarItem.hide();

  if (grade === null) return;

  const rounded = grade.toFixed(1);

  if (location === "status" || location === "both") {
    readabilityStatusBarItem.text = `$(graph) FK ${rounded}`;
    readabilityStatusBarItem.tooltip = `Vale: Flesch-Kincaid grade level ${rounded}`;
    readabilityStatusBarItem.show();
  }

  if (location === "inline" || location === "both") {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      `Flesch-Kincaid grade level: ${rounded}`,
      vscode.DiagnosticSeverity.Information
    );
    diagnostic.source = "Vale";
    readabilityDiagnostics.set(uri, [diagnostic]);
  }
}

/** Clears any readability status bar/diagnostic left over from a previous file. */
export function clearReadabilityResult(uri?: vscode.Uri): void {
  readabilityStatusBarItem.hide();
  if (uri) {
    readabilityDiagnostics.delete(uri);
  }
}

let valeOutputChannel: vscode.OutputChannel;

export function createValeOutputChannel(
  context: vscode.ExtensionContext
): vscode.OutputChannel {
  valeOutputChannel = vscode.window.createOutputChannel("Vale");
  context.subscriptions.push(valeOutputChannel);
  return valeOutputChannel;
}

export function getValeOutputChannel(): vscode.OutputChannel {
  return valeOutputChannel;
}

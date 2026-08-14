import * as vscode from "vscode";
import { ExtensionContext } from "vscode";

/**
 * The subset of vale-ls's raw alert JSON (see its `ValeAlert`/`ValeAction`
 * structs) that we need. vale-ls attaches this as each diagnostic's LSP
 * `data` field; vscode-languageclient carries it through at runtime as
 * `diagnostic.data`, even though that property isn't part of the public
 * `vscode.Diagnostic` type.
 */
export interface ValeAlertData {
  Action?: {
    Name?: string;
    Params?: string[];
  };
}

export function alertDataOf(diagnostic: vscode.Diagnostic): ValeAlertData | undefined {
  return (diagnostic as vscode.Diagnostic & { data?: ValeAlertData }).data;
}

/**
 * Builds one "Replace with '...'" quick fix per alternative in a
 * substitution rule's `swap` list (e.g. `whatif: what if|options|more`),
 * reading them straight out of vale-ls's alert data instead of going
 * through its `fix` RPC, which has historically collapsed multiple
 * alternatives into duplicates. See
 * https://github.com/ChrisChinchilla/vale-vscode/issues/7.
 *
 * vale-ls's own `fix`-RPC-based quick fixes for the same `replace` alerts
 * are filtered out client-side (see the `provideCodeActions` middleware in
 * `languageServer.ts`) so the two don't stack into duplicate/incorrect
 * entries in the same lightbulb menu.
 */
export class ValeSubstitutionCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== "vale-ls") continue;

      const action = alertDataOf(diagnostic)?.Action;
      if (action?.Name !== "replace" || !action.Params?.length) continue;

      for (const replacement of action.Params) {
        const fix = new vscode.CodeAction(
          `Replace with ‘${replacement}’`,
          vscode.CodeActionKind.QuickFix
        );
        fix.diagnostics = [diagnostic];
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(document.uri, diagnostic.range, replacement);
        actions.push(fix);
      }
    }

    return actions;
  }
}

/**
 * True for a `CodeAction` that vale-ls's own `fix` RPC built for a
 * `replace`-action alert - the case `ValeSubstitutionCodeActionProvider`
 * above now owns. Used to filter those out of what the server returns (see
 * the `provideCodeActions` middleware in `languageServer.ts`) so they don't
 * stack with our own, correct ones in the same lightbulb menu.
 */
export function isServerReplaceFix(item: vscode.CodeAction | vscode.Command): boolean {
  if (!("diagnostics" in item) || !item.diagnostics?.length) return false;
  const diagnostic = item.diagnostics[0];
  if (diagnostic.source !== "vale-ls") return false;
  return alertDataOf(diagnostic)?.Action?.Name === "replace";
}

export function registerCodeActions(context: ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file", language: "*" },
      new ValeSubstitutionCodeActionProvider(),
      { providedCodeActionKinds: ValeSubstitutionCodeActionProvider.providedCodeActionKinds }
    )
  );
}

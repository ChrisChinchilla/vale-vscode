"use strict";

import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";

import * as utils from "./vsUtils";
import { getReadabilityProblemLocation } from "./vsUtils";
import { getSpellingSuggestions } from "./vsSpelling";

export default class ValeProvider implements vscode.CodeActionProvider {
  private diagnosticCollection!: vscode.DiagnosticCollection;
  private readabilityStatus!: vscode.StatusBarItem;
  private alertMap: Record<string, IValeErrorJSON> = {};
  private diagnosticMap: Record<string, vscode.Diagnostic[]> = {};
  private stylesPath!: string;

  private static commandId: string = "ValeProvider.runCodeAction";
  private command!: vscode.Disposable;
  private logger!: vscode.OutputChannel;

  private async doVale(textDocument: vscode.TextDocument) {
    if (!(await utils.isElligibleDocument(textDocument))) {
      return;
    }

    // Reset out alert map and run-time log:
    this.alertMap = {};
    this.logger.clear();
    try {
      await this.runVale(textDocument);
    } catch (error) {
      vscode.window.showErrorMessage(
        `There was an error running Vale ${error}.`
      );
    }
  }

  private async runVale(file: vscode.TextDocument) {
    const folder = path.dirname(file.fileName);
    const binaryLocation = utils.readBinaryLocation(this.logger, file);
    const configLocation = utils.readFileLocation(this.logger, file);
    if (binaryLocation === null || configLocation === null) {
      // `file` is not part of the workspace, so we could not resolve a workspace-relative path. Ignore this file.
      return;
    }

    // There are two cases we need to handle here:
    //
    // (1) If we're given an explicit value for `--config`, then we should
    // error if it doesn't exist.
    //
    // (2) If we're not given a value (the default is ""), then we need to look
    // for a `.vale.ini`. However, we can't send an error if we don't find one
    // because the user may simply be editing a non-Vale project/file.
    let stylesPath: Array<string> = [];
    if (configLocation !== "" && !fs.existsSync(configLocation)) {
      vscode.window.showErrorMessage(
        `[Vale]: '${configLocation}' does not exist.`
      );
    } else if (configLocation !== "") {
      stylesPath = [
        binaryLocation,
        "--output=JSON",
        "--config",
        configLocation,
        "ls-config",
      ];
    } else {
      stylesPath = [binaryLocation, "--output=JSON", "ls-config"];
    }

    const configOut = await utils.runInWorkspace(folder, stylesPath);
    try {
      const configCLI = JSON.parse(configOut);
      this.stylesPath = configCLI.StylesPath;
      const command = utils.buildCommand(
        binaryLocation,
        configLocation,
        file.fileName
      );

      const stdout = await utils.runInWorkspace(folder, command);
      this.handleJSON(stdout.toString(), file, 0);
    } catch (error) {
      this.logger.appendLine(error as string);
    }
  }

  private handleJSON(
    contents: string,
    doc: vscode.TextDocument,
    offset: number
  ) {
    const diagnostics: vscode.Diagnostic[] = [];
    const backend = "Vale";
    let body = JSON.parse(contents.toString());
    if (body.Code && body.Text) {
      this.logger.appendLine(body.Text);
      if (body.Path) {
        this.logger.appendLine(body.Path);
      }
      return;
    }

    const readabilityProblemLocation = getReadabilityProblemLocation();
    this.readabilityStatus.hide();

    for (let key in body) {
      const alerts = body[key];
      for (var i = 0; i < alerts.length; ++i) {
        // Matches `metric` and `readability` alerts.
        const isReadabilityProblem = alerts[i].Match === "";

        if (isReadabilityProblem && readabilityProblemLocation !== "inline") {
          var readabilityMessage = alerts[0].Message;
          this.updateStatusBarItem(readabilityMessage);
        }

        if (!isReadabilityProblem || readabilityProblemLocation !== "status") {
          let diagnostic = utils.toDiagnostic(
            alerts[i],
            // this.stylesPath,
            backend,
            offset
          );
          let key = `${diagnostic.message}-${diagnostic.range}`;
          this.alertMap[key] = alerts[i];

          diagnostics.push(diagnostic);
        }
      }
    }

    this.diagnosticCollection.set(doc.uri, diagnostics);
    this.diagnosticMap[doc.uri.toString()] = diagnostics;
  }

  private updateStatusBarItem(message: string): void {
    this.readabilityStatus.text = `${message}`;
    this.readabilityStatus.show();
  }

  public async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeAction[]> {
    let diagnostic: vscode.Diagnostic = context.diagnostics[0];
    let actions: vscode.CodeAction[] = [];

    // TODO: This needs more work / testing
    if (diagnostic === undefined) {
      return actions;
    }

    let key = `${diagnostic.message}-${diagnostic.range}`;
    let alert = this.alertMap[key];

    // TODO: Handle rules with no actions defined, name is empty, so again doesn't return empty actions
    // TODO: Is this precise enough for all potential suggest actions?
    const configuration = vscode.workspace.getConfiguration();
    let spellingEnabled: boolean = configuration.get<boolean>(
      "vale.enableSpellcheck",
      false
    );

    if (alert.Action.Name === "suggest" && spellingEnabled == true) {
      // TODO: Sanity, dependency, and OS check
      // TODO: Have to repass range, seems unnecessary
      const suggestions: string[] = await getSpellingSuggestions(
        range,
        document
      );

      suggestions.forEach((word) => {
        const title = "Replace with '" + word + "'";
        const action = new vscode.CodeAction(
          title,
          vscode.CodeActionKind.QuickFix
        );

        const suggestion: IValeActionJSON = { Name: "replace", Params: [word] };
        action.command = {
          title: title,
          command: ValeProvider.commandId,
          arguments: [
            document,
            diagnostic,
            alert.Match,
            suggestion,
            suggestion.Name,
          ],
        };

        actions.push(action);
      });
    } else if (alert.Action.Name !== "") {
      const suggestion = alert.Action;
      const title = utils.toTitle(alert);
      const action = new vscode.CodeAction(
        title,
        vscode.CodeActionKind.QuickFix
      );

      action.command = {
        title: title,
        command: ValeProvider.commandId,
        arguments: [
          document,
          diagnostic,
          alert.Match,
          suggestion,
          alert.Action.Name,
        ],
      };
      actions.push(action);
    }
    return actions;
  }

  private runCodeAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    error: string,
    suggestion: IValeActionJSON,
    action: string
  ): any {
    let docError: string = document.getText(diagnostic.range);

    if (error === docError) {
      // Remove diagnostic from list
      let diagnostics: vscode.Diagnostic[] =
        this.diagnosticMap[document.uri.toString()];
      let index: number = diagnostics.indexOf(diagnostic);

      diagnostics.splice(index, 1);

      // Update with new diagnostics
      this.diagnosticMap[document.uri.toString()] = diagnostics;
      this.diagnosticCollection.set(document.uri, diagnostics);

      // Insert the new text
      let edit = new vscode.WorkspaceEdit();
      if (action === "replace") {
        edit.replace(document.uri, diagnostic.range, suggestion.Params[0]);
      } else if (action === "remove") {
        // NOTE: we need to add a character when deleting to avoid leaving a
        // double space.
        const range = new vscode.Range(
          diagnostic.range.start.line,
          diagnostic.range.start.character,
          diagnostic.range.end.line,
          diagnostic.range.end.character + 1
        );
        edit.delete(document.uri, range);
      }

      return vscode.workspace.applyEdit(edit);
    } else {
      vscode.window.showErrorMessage(
        "The suggestion was not applied because it is out of date."
      );
      console.log(error, docError);
    }
  }

  public async activate(subscriptions: vscode.Disposable[]) {
    this.logger = vscode.window.createOutputChannel("Vale");

    this.command = vscode.commands.registerCommand(
      ValeProvider.commandId,
      this.runCodeAction,
      this
    );
    subscriptions.push(this);

    this.readabilityStatus = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection();

    vscode.workspace.onDidOpenTextDocument(this.doVale, this, subscriptions);
    vscode.workspace.onDidCloseTextDocument(
      (textDocument) => {
        this.diagnosticCollection.delete(textDocument.uri);
      },
      null,
      subscriptions
    );

    vscode.workspace.onDidSaveTextDocument(this.doVale, this);

    vscode.window.visibleTextEditors.forEach(document => {
      this.doVale(document.document)
    });
    
    vscode.languages.registerCodeActionsProvider(
      { scheme: "*", language: "*" },
      this
    );
  }

  public dispose(): void {
    this.diagnosticCollection.clear();

    this.diagnosticCollection.dispose();
    this.command.dispose();
    this.readabilityStatus.dispose();

    this.diagnosticMap = {};
    this.alertMap = {};

    this.logger.dispose();
  }
}

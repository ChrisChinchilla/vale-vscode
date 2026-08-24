import * as vscode from "vscode";

/**
 * UI surfaces: the Vale output channel and the "Vale" Explorer sidebar
 * tree view of commands.
 */

export class ValeCommandItem extends vscode.TreeItem {
  constructor(
    label: string,
    commandId: string,
    commandTitle: string,
    iconName: string,
    tooltip?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = { command: commandId, title: commandTitle };
    this.iconPath = new vscode.ThemeIcon(iconName);
    if (tooltip) {
      this.tooltip = tooltip;
    }
  }
}

export class ValeCommandsProvider
  implements vscode.TreeDataProvider<ValeCommandItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: ValeCommandItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ValeCommandItem[] {
    // Commands with workspace-linked side effects are gated on Workspace
    // Trust the same way as their handlers; diagnostics and an explicit
    // server restart remain available for troubleshooting Restricted Mode.
    if (!vscode.workspace.isTrusted) {
      return [
        new ValeCommandItem(
          "Trust this workspace to use these commands",
          "workbench.action.manageTrust",
          "Manage Workspace Trust",
          "shield",
          "Sync, Show Configuration, and Show Metrics all run the Vale executable, which requires a trusted workspace"
        ),
        new ValeCommandItem(
          "Restart Language Server",
          "vale.restartLanguageServer",
          "Restart Language Server",
          "debug-restart"
        ),
        new ValeCommandItem(
          "Show Diagnostics",
          "vale.showDiagnostics",
          "Show Diagnostics",
          "output"
        ),
      ];
    }

    return [
      new ValeCommandItem(
        "Sync Packages",
        "vale.sync",
        "Sync",
        "sync",
        "Download and install Vale packages defined in your config"
      ),
      new ValeCommandItem(
        "Show Configuration",
        "vale.showConfig",
        "Show Configuration",
        "gear",
        "Display the active Vale configuration (vale ls-config)"
      ),
      new ValeCommandItem(
        "Show File Metrics",
        "vale.showMetrics",
        "Show Metrics",
        "graph",
        "Display readability metrics for the active file (vale ls-metrics)"
      ),
      new ValeCommandItem(
        "Restart Language Server",
        "vale.restartLanguageServer",
        "Restart Language Server",
        "debug-restart",
        "Reinstall if needed and restart every Vale language-server instance"
      ),
      new ValeCommandItem(
        "Show Diagnostics",
        "vale.showDiagnostics",
        "Show Diagnostics",
        "output",
        "Show Vale startup and execution diagnostics"
      ),
    ];
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

export function registerValeCommandsTreeView(
  context: vscode.ExtensionContext
): vscode.TreeView<ValeCommandItem> {
  const valeCommandsProvider = new ValeCommandsProvider();
  const valeTreeView = vscode.window.createTreeView("valeCommands", {
    treeDataProvider: valeCommandsProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(
    valeTreeView,
    valeCommandsProvider,
    vscode.workspace.onDidGrantWorkspaceTrust(() =>
      valeCommandsProvider.refresh()
    )
  );
  return valeTreeView;
}

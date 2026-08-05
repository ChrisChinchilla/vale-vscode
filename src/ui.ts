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
  implements vscode.TreeDataProvider<ValeCommandItem>
{
  getTreeItem(element: ValeCommandItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ValeCommandItem[] {
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
  context.subscriptions.push(valeTreeView);
  return valeTreeView;
}

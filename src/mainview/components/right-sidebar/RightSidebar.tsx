import {
  Pin,
  PanelRight,
  GitBranch,
  FolderTree,
  Activity,
  Terminal,
  Brain,
  Shield,
  Camera,
  Bot,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { PANEL_TABS, type PanelTabId } from "../../layouts/types";
import { StatusPanel } from "../status-panel/StatusPanel";
import { ExplorerSidebar } from "../explorer/ExplorerSidebar";
import { GitPanel } from "../git/GitPanel";
import { RpcPanel } from "../rpc-panel/RpcPanel";
import { MemoryPanel } from "../memory-panel/MemoryPanel";
import { RulesPanel } from "../rules-panel/RulesPanel";
import { SnapshotPanel } from "../snapshot-panel/SnapshotPanel";
import { AgentPanel } from "../agent-panel/AgentPanel";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useGitStore } from "../../stores/use-git-store";
import { useEffect, useRef } from "react";

const TAB_ICONS: Record<PanelTabId, React.ComponentType<{ className?: string }>> = {
  git: GitBranch,
  files: FolderTree,
  status: Activity,
  agent: Bot,
  rpc: Terminal,
  memory: Brain,
  rules: Shield,
  snapshot: Camera,
};

interface RightSidebarProps {
  width: number;
  overlay: boolean;
}

export function RightSidebar({ width, overlay }: RightSidebarProps) {
  const { t } = useTranslation("sidebar");
  const statusPanel = useLayoutStore((s) => s.statusPanel);
  const toggleStatus = useLayoutStore((s) => s.toggleStatus);
  const activePanelTab = useLayoutStore((s) => s.activePanelTab);
  const setActivePanelTab = useLayoutStore((s) => s.setActivePanelTab);
  const listRootDir = useExplorerStore((s) => s.listRootDir);

  const currentPath = useExplorerStore((s) => s.currentPath);

  const treeNodes = useExplorerStore((s) => s.treeNodes);
  const selectedPath = useExplorerStore((s) => s.selectedPath);
  const editingNode = useExplorerStore((s) => s.editingNode);
  const toggleNode = useExplorerStore((s) => s.toggleNode);
  const openFile = useExplorerStore((s) => s.openFile);
  const createFile = useExplorerStore((s) => s.createFile);
  const createDir = useExplorerStore((s) => s.createDir);
  const renameNode = useExplorerStore((s) => s.renameNode);
  const deleteNode = useExplorerStore((s) => s.deleteNode);
  const startEditing = useExplorerStore((s) => s.startEditing);
  const cancelEditing = useExplorerStore((s) => s.cancelEditing);
  const importFiles = useExplorerStore((s) => s.importFiles);

  const isPinned = statusPanel === "pinned";
  const hideStatus = useLayoutStore((s) => s.hideStatus);
  const refreshAll = useGitStore((s) => s.refreshAll);
  const prevPanelVisible = useRef(statusPanel !== "hidden");
  useEffect(() => {
    if (activePanelTab === "files") {
      listRootDir();
    }
  }, [activePanelTab, listRootDir]);

  useEffect(() => {
    if (activePanelTab === "git" && currentPath) {
      refreshAll(currentPath);
    }
  }, [activePanelTab, refreshAll, currentPath]);

  useEffect(() => {
    const isVisible = statusPanel !== "hidden";
    if (isVisible && !prevPanelVisible.current) {
      if (activePanelTab === "git" && currentPath) {
        refreshAll(currentPath);
      } else if (activePanelTab === "files") {
        listRootDir();
      }
    }
    prevPanelVisible.current = isVisible;
  }, [statusPanel, activePanelTab, currentPath, listRootDir]);

  function renderContent() {
    switch (activePanelTab) {
      case "git":
        return <GitPanel hideOuterShell />;
      case "files":
        return (
          <ExplorerSidebar
            treeNodes={treeNodes}
            currentPath={currentPath}
            selectedPath={selectedPath}
            editingNode={editingNode}
            onRefresh={listRootDir}
            onToggle={toggleNode}
            onOpenFile={openFile}
            onCreateFile={createFile}
            onCreateDir={createDir}
            onRenameNode={renameNode}
            onDeleteNode={deleteNode}
            onStartEditing={startEditing}
            onCancelEditing={cancelEditing}
            onImportFiles={importFiles}
            hideOuterShell
          />
        );
      case "status":
        return <StatusPanel />;
      case "agent":
        return <AgentPanel />;
      case "rpc":
        return <RpcPanel />;
      case "memory":
        return <MemoryPanel />;
      case "rules":
        return <RulesPanel />;
      case "snapshot":
        return <SnapshotPanel />;
      default:
        return null;
    }
  }

  const isIconBar = width <= 48;

  if (isIconBar) {
    return (
      <div
        data-testid="right-sidebar"
        className="flex flex-col items-center bg-bg-secondary border-l border-border-primary overflow-hidden z-20 pt-1"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        {PANEL_TABS.map((tab: { id: PanelTabId; label: string }) => {
          const Icon = TAB_ICONS[tab.id];
          return (
            <button
              key={tab.id}
              onClick={(e) => {
                e.stopPropagation();
                setActivePanelTab(tab.id);
              }}
              className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
                activePanelTab === tab.id
                  ? "text-semantic-accent bg-semantic-accent/10"
                  : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover"
              }`}
              title={tab.label}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid="right-sidebar"
      className={`flex flex-col bg-bg-secondary border-l border-border-primary overflow-hidden z-20 ${
        overlay ? "animate-slide-in-right shadow-xl shadow-black/10 dark:shadow-black/30" : ""
      }`}
      style={overlay ? { position: "absolute", right: 0, top: 0, bottom: 0, width } : { width }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center border-b border-border-primary shrink-0 bg-bg-secondary">
        {overlay && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              hideStatus();
            }}
            className="p-1.5 mr-1 rounded-md hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors shrink-0"
            title={t("closePanel")}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleStatus();
          }}
          className={`p-1.5 mr-1 rounded-md transition-colors shrink-0 max-sm:hidden ${isPinned ? "text-semantic-accent bg-semantic-accent/10" : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover"}`}
          title={isPinned ? t("unpinPanel") : t("pinPanel")}
        >
          <Pin className="w-3.5 h-3.5" fill={isPinned ? "currentColor" : "none"} />
        </button>
        <div className="flex items-center overflow-x-auto scrollbar-none">
          {PANEL_TABS.map((tab: { id: PanelTabId; label: string }) => (
            <button
              key={tab.id}
              onClick={(e) => {
                e.stopPropagation();
                setActivePanelTab(tab.id);
              }}
              className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activePanelTab === tab.id
                  ? "text-semantic-accent border-semantic-accent"
                  : "text-text-tertiary border-transparent hover:text-text-primary hover:bg-surface-hover/60"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">{renderContent()}</div>
    </div>
  );
}

import { Pin, PanelRight } from "lucide-react";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { PANEL_TABS, type PanelTabId } from "../../layouts/types";
import { StatusPanel } from "../status-panel/StatusPanel";
import { ExplorerSidebar } from "../explorer/ExplorerSidebar";
import { GitPanel } from "../git/GitPanel";
import { RpcPanel } from "../rpc-panel/RpcPanel";
import { BashPanel } from "../bash-panel/BashPanel";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useEffect } from "react";

interface RightSidebarProps {
  width: number;
  overlay: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
}

export function RightSidebar({ width, overlay, onResizeStart }: RightSidebarProps) {
  const statusPanel = useLayoutStore((s) => s.statusPanel);
  const toggleStatus = useLayoutStore((s) => s.toggleStatus);
  const activePanelTab = useLayoutStore((s) => s.activePanelTab);
  const setActivePanelTab = useLayoutStore((s) => s.setActivePanelTab);
  const listRootDir = useExplorerStore((s) => s.listRootDir);

  const treeNodes = useExplorerStore((s) => s.treeNodes);
  const currentPath = useExplorerStore((s) => s.currentPath);
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
  const isMobile = useLayoutStore((s) => s.breakpoint) === "mobile";
  const hideStatus = useLayoutStore((s) => s.hideStatus);

  useEffect(() => {
    if (activePanelTab === "files") {
      listRootDir();
    }
  }, [activePanelTab, listRootDir]);

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
      case "shell":
        return <BashPanel />;
      case "rpc":
        return <RpcPanel />;
      default:
        return null;
    }
  }

  return (
    <div
      className={`flex flex-col bg-gray-900 border-l border-gray-800 overflow-hidden z-20 ${
        overlay ? "animate-slide-in-right shadow-xl shadow-black/30" : ""
      }`}
      style={
        overlay
          ? { position: "absolute", right: 0, top: 0, bottom: 0, width }
          : { width }
      }
      onClick={(e) => e.stopPropagation()}
    >
      {/* Tab bar + pin */}
      <div className="flex items-center border-b border-gray-800 shrink-0">
        {isMobile && overlay && (
          <button
            onClick={(e) => { e.stopPropagation(); hideStatus(); }}
            className="p-1.5 mr-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
            title="关闭"
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>
        )}
        {!isMobile && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleStatus(); }}
            className={`p-1.5 mr-1 rounded transition-colors ${isPinned ? "text-indigo-400" : "text-gray-600 hover:text-gray-400"}`}
            title={isPinned ? "取消固定" : "固定面板"}
          >
            <Pin className="w-3.5 h-3.5" fill={isPinned ? "currentColor" : "none"} />
          </button>
        )}
        {PANEL_TABS.map((tab: { id: PanelTabId; label: string }) => (
          <button
            key={tab.id}
            onClick={(e) => { e.stopPropagation(); setActivePanelTab(tab.id); }}
            className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              activePanelTab === tab.id
                ? "text-indigo-400 border-b-2 border-indigo-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {renderContent()}
      </div>

      {/* Resize handle */}
      {!overlay && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-10"
          onMouseDown={onResizeStart}
          style={{ position: "absolute", left: -1 }}
        />
      )}
    </div>
  );
}

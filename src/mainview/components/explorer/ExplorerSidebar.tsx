import { useState, useCallback } from "react";
import { Folder, RefreshCw, File, FolderPlus, Pencil, Trash2, Copy } from "lucide-react";
import type { TreeNode, EditingNode } from "../../types";
import type { DropEntry } from "../../utils/drop-handler";
import { readDropItems } from "../../utils/drop-handler";
import { TreeNodeItem } from "./TreeNodeItem";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { InlineInput } from "./InlineInput";
import { PinButton } from "../sidebar/PinButton";

interface ExplorerSidebarProps {
  treeNodes: TreeNode[];
  currentPath: string;
  selectedPath: string | null;
  editingNode: EditingNode | null;
  onPathChange: (path: string) => void;
  onRefresh: () => void;
  onToggle: (path: string) => void;
  onOpenFile: (node: TreeNode) => void;
  onCreateFile: (dirPath: string, name: string) => Promise<void>;
  onCreateDir: (dirPath: string, name: string) => Promise<void>;
  onRenameNode: (oldPath: string, newName: string) => Promise<void>;
  onDeleteNode: (path: string) => Promise<void>;
  onStartEditing: (path: string, type: EditingNode["type"]) => void;
  onCancelEditing: () => void;
  onImportFiles: (entries: DropEntry[], destDir: string) => Promise<number>;
  hideOuterShell?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode | null;
}

export function ExplorerSidebar({
  treeNodes,
  currentPath,
  selectedPath,
  editingNode,
  onPathChange,
  onRefresh,
  onToggle,
  onOpenFile,
  onCreateFile,
  onCreateDir,
  onRenameNode,
  onDeleteNode,
  onStartEditing,
  onCancelEditing,
  onImportFiles,
  hideOuterShell,
}: ExplorerSidebarProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleBlankContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node: null });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const entries = await readDropItems(e.dataTransfer);
    if (entries.length > 0) {
      try {
        await onImportFiles(entries, currentPath);
      } catch { /* error logged in store */ }
    }
  }, [onImportFiles, currentPath]);

  const buildMenuItems = useCallback((): MenuItem[] => {
    if (!contextMenu) return [];
    const node = contextMenu.node;

    if (!node) {
      // Blank area — root context menu
      return [
        { label: "New File", icon: <File className="w-3 h-3" />, onClick: () => onStartEditing(currentPath, "newFile") },
        { label: "New Folder", icon: <FolderPlus className="w-3 h-3" />, onClick: () => onStartEditing(currentPath, "newDir") },
        { label: "Refresh", icon: <RefreshCw className="w-3 h-3" />, onClick: onRefresh, divider: true },
      ];
    }

    const items: MenuItem[] = [];
    if (node.type === "directory") {
      items.push(
        { label: "New File", icon: <File className="w-3 h-3" />, onClick: () => onStartEditing(node.path, "newFile") },
        { label: "New Folder", icon: <FolderPlus className="w-3 h-3" />, onClick: () => onStartEditing(node.path, "newDir") },
      );
    }
    items.push(
      { label: "Rename", icon: <Pencil className="w-3 h-3" />, onClick: () => onStartEditing(node.path, "rename"), divider: items.length > 0 },
      { label: "Delete", icon: <Trash2 className="w-3 h-3" />, onClick: () => setPendingDelete(node.path), danger: true },
      { label: "Copy Path", icon: <Copy className="w-3 h-3" />, onClick: () => navigator.clipboard.writeText(node.path) },
    );
    return items;
  }, [contextMenu, currentPath, onRefresh, onStartEditing]);

  const handleSubmitEdit = useCallback(
    (value: string) => {
      if (!editingNode) return;
      if (editingNode.type === "rename") {
        onRenameNode(editingNode.path, value);
      } else if (editingNode.type === "newFile") {
        onCreateFile(editingNode.path, value);
      } else if (editingNode.type === "newDir") {
        onCreateDir(editingNode.path, value);
      }
    },
    [editingNode, onRenameNode, onCreateFile, onCreateDir],
  );

  // Is root-level editing?
  const isRootEditing =
    editingNode &&
    editingNode.path === currentPath &&
    (editingNode.type === "newFile" || editingNode.type === "newDir");

  const header = (
    <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-700 flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Folder className="w-3.5 h-3.5" />
        Explorer
      </div>
      <PinButton />
    </div>
  );

  const content = (
    <>
      {header}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex gap-2 p-2 border-b border-gray-700">
          <input
            type="text"
            value={currentPath}
            onChange={(e) => onPathChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onRefresh()}
            placeholder="Path"
            className="flex-1 px-2 py-1 text-xs bg-gray-700 rounded text-white border border-gray-600 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={onRefresh}
            className="px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 rounded transition-colors"
            title="List directory"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <div
          className={`flex-1 overflow-y-auto p-1 transition-colors ${
            isDragOver ? "bg-indigo-900/30 ring-1 ring-inset ring-indigo-500/50" : ""
          }`}
          onContextMenu={handleBlankContextMenu}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {treeNodes.length === 0 ? (
            <div className="text-gray-500 text-xs text-center py-4">Enter path and click refresh</div>
          ) : (
            <ul className="space-y-0.5">
              {treeNodes.map((node) => (
                <TreeNodeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={selectedPath}
                  editingNode={editingNode}
                  onToggle={onToggle}
                  onOpenFile={onOpenFile}
                  onContextMenu={handleContextMenu}
                  onSubmitEdit={handleSubmitEdit}
                  onCancelEdit={onCancelEditing}
                />
              ))}
              {isRootEditing && (
                <InlineInput
                  depth={0}
                  onSubmit={handleSubmitEdit}
                  onCancel={onCancelEditing}
                />
              )}
            </ul>
          )}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Confirm Delete"
          message={`Are you sure you want to delete "${pendingDelete.split("/").pop()}"? This action cannot be undone.`}
          onConfirm={() => {
            onDeleteNode(pendingDelete);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );

  if (hideOuterShell) {
    return <div className="flex flex-col flex-1 overflow-hidden">{content}</div>;
  }

  return (
    <div className="w-60 bg-gray-850 border-r border-gray-700 flex flex-col flex-shrink-0">
      {content}
    </div>
  );
}

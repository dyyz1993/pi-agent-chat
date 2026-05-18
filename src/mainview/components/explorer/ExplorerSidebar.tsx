import { useState, useCallback, useEffect } from "react";
import { Folder, RefreshCw, File, FolderPlus, Pencil, Trash2, Copy, Plus } from "lucide-react";
import type { TreeNode, EditingNode } from "../../types";
import type { DropEntry } from "../../utils/drop-handler";
import { readDropItems } from "../../utils/drop-handler";
import { copyToClipboard } from "../../utils/clipboard";
import { TreeNodeItem } from "./TreeNodeItem";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { InlineInput } from "./InlineInput";

interface ExplorerSidebarProps {
  treeNodes: TreeNode[];
  currentPath: string;
  selectedPath: string | null;
  editingNode: EditingNode | null;
  onRefresh: () => void;
  onToggle: (path: string) => void;
  onOpenFile: (node: TreeNode) => void;
  onCreateFile: (dirPath: string, name: string) => Promise<string | null>;
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
  const [copyToast, setCopyToast] = useState<string | null>(null);

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

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const entries = await readDropItems(e.dataTransfer);
      if (entries.length > 0) {
        try {
          await onImportFiles(entries, currentPath);
        } catch {
          /* error logged in store */
        }
      }
    },
    [onImportFiles, currentPath],
  );

  useEffect(() => {
    if (!copyToast) return;
    const timer = setTimeout(() => setCopyToast(null), 2000);
    return () => clearTimeout(timer);
  }, [copyToast]);

  const buildMenuItems = useCallback((): MenuItem[] => {
    if (!contextMenu) return [];
    const node = contextMenu.node;

    if (!node) {
      // Blank area — root context menu
      return [
        {
          label: "New File",
          icon: <File className="w-3 h-3" />,
          onClick: () => onStartEditing(currentPath, "newFile"),
        },
        {
          label: "New Folder",
          icon: <FolderPlus className="w-3 h-3" />,
          onClick: () => onStartEditing(currentPath, "newDir"),
        },
        {
          label: "Refresh",
          icon: <RefreshCw className="w-3 h-3" />,
          onClick: onRefresh,
          divider: true,
        },
      ];
    }

    const items: MenuItem[] = [];
    if (node.type === "directory") {
      items.push(
        {
          label: "New File",
          icon: <File className="w-3 h-3" />,
          onClick: () => {
            if (!node.expanded) onToggle(node.path);
            onStartEditing(node.path, "newFile");
          },
        },
        {
          label: "New Folder",
          icon: <FolderPlus className="w-3 h-3" />,
          onClick: () => {
            if (!node.expanded) onToggle(node.path);
            onStartEditing(node.path, "newDir");
          },
        },
      );
    }
    items.push(
      {
        label: "Rename",
        icon: <Pencil className="w-3 h-3" />,
        onClick: () => onStartEditing(node.path, "rename"),
        divider: items.length > 0,
      },
      {
        label: "Delete",
        icon: <Trash2 className="w-3 h-3" />,
        onClick: () => setPendingDelete(node.path),
        danger: true,
      },
      {
        label: "Copy Path",
        icon: <Copy className="w-3 h-3" />,
        onClick: () => {
          copyToClipboard(node.path).then((ok) => {
            if (ok) setCopyToast(node.path);
          });
        },
      },
    );
    return items;
  }, [contextMenu, currentPath, onRefresh, onStartEditing, onToggle]);

  const handleSubmitEdit = useCallback(
    async (value: string) => {
      if (!editingNode) return;
      if (editingNode.type === "rename") {
        onRenameNode(editingNode.path, value);
      } else if (editingNode.type === "newFile") {
        await onCreateFile(editingNode.path, value);
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
    <div className="px-3 py-2 text-xs font-semibold text-text-tertiary dark:text-text-tertiary uppercase tracking-wide border-b border-border-secondary dark:border-border-secondary flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Folder className="w-3.5 h-3.5" />
        Explorer
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onStartEditing(currentPath, "newFile")}
          className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary hover:text-text-primary dark:hover:text-text-primary transition-colors"
          title="New File"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onRefresh}
          className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary hover:text-text-primary dark:hover:text-text-primary transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  const content = (
    <>
      {header}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div
          className={`flex-1 overflow-y-auto p-1 transition-colors ${
            isDragOver
              ? "bg-indigo-100/50 dark:bg-indigo-900/30 ring-1 ring-inset ring-indigo-500/50"
              : ""
          }`}
          onContextMenu={handleBlankContextMenu}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {treeNodes.length === 0 ? (
            <div className="text-text-tertiary text-xs text-center py-4">
              Enter path and click refresh
            </div>
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
                <InlineInput depth={0} onSubmit={handleSubmitEdit} onCancel={onCancelEditing} />
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

      {copyToast && (
        <div
          className="absolute bottom-3 left-3 right-3 z-40 animate-in fade-in slide-in-from-bottom-2 duration-200 bg-surface-hover dark:bg-surface-hover text-white text-xs px-3 py-2 rounded-lg shadow-lg flex items-center gap-2"
          role="status"
        >
          <Copy className="w-3 h-3 text-status-success shrink-0" />
          <span className="truncate">{copyToast}</span>
        </div>
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
    <div
      data-testid="explorer-sidebar"
      className="w-60 bg-surface-dim dark:bg-surface-code border-r border-border-secondary dark:border-border-secondary flex flex-col flex-shrink-0"
    >
      {content}
    </div>
  );
}

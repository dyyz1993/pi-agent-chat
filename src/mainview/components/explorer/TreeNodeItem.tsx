import { memo } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { TreeNode, EditingNode } from "../../types";
import { getFileIcon } from "../../utils/file-icon";
import { InlineInput } from "./InlineInput";

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  editingNode: EditingNode | null;
  onToggle: (path: string) => void;
  onOpenFile: (node: TreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onSubmitEdit: (value: string) => void;
  onCancelEdit: () => void;
}

function TreeNodeItemInner({
  node,
  depth,
  selectedPath,
  editingNode,
  onToggle,
  onOpenFile,
  onContextMenu,
  onSubmitEdit,
  onCancelEdit,
}: TreeNodeItemProps) {
  const isDir = node.type === "directory";
  const isSelected = selectedPath === node.path;
  const isRenaming = editingNode?.path === node.path && editingNode.type === "rename";
  const isAddingChild =
    isDir &&
    node.expanded &&
    editingNode?.path === node.path &&
    (editingNode.type === "newFile" || editingNode.type === "newDir");

  return (
    <li>
      <div
        className={`flex items-center gap-1.5 px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
          isSelected ? "bg-indigo-600/30 text-white" : "hover:bg-gray-700"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => isDir ? onToggle(node.path) : onOpenFile(node)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, node);
        }}
      >
        {isDir ? (
          node.expanded ? (
            <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-500 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {getFileIcon(node)}
        {isRenaming ? (
          <InlineInput
            defaultValue={node.name}
            depth={depth}
            onSubmit={onSubmitEdit}
            onCancel={onCancelEdit}
          />
        ) : (
          <span className={`truncate ${isDir ? "text-blue-300 font-medium" : "text-gray-300"}`}>
            {node.name}
          </span>
        )}
      </div>
      {isDir && node.expanded && node.children && (
        <ul>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              editingNode={editingNode}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              onSubmitEdit={onSubmitEdit}
              onCancelEdit={onCancelEdit}
            />
          ))}
          {isAddingChild && (
            <InlineInput
              depth={depth + 1}
              onSubmit={onSubmitEdit}
              onCancel={onCancelEdit}
            />
          )}
        </ul>
      )}
    </li>
  );
}

export const TreeNodeItem = memo(TreeNodeItemInner, (prev, next) => {
  // Fast path: same node reference and no editing state change
  if (
    prev.node === next.node &&
    prev.selectedPath === next.selectedPath &&
    prev.editingNode === next.editingNode &&
    prev.depth === next.depth &&
    prev.onToggle === next.onToggle &&
    prev.onOpenFile === next.onOpenFile &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onSubmitEdit === next.onSubmitEdit &&
    prev.onCancelEdit === next.onCancelEdit
  ) {
    return true;
  }
  return false;
});

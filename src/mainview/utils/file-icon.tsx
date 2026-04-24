import {
  FolderOpen,
  Folder,
  FileText,
  FileCode,
  Image,
  FileArchive,
} from "lucide-react";
import type { TreeNode } from "../types";

export function getFileIcon(node: TreeNode) {
  if (node.type === "directory") {
    return node.expanded ? (
      <FolderOpen className="w-4 h-4 text-yellow-400 shrink-0" />
    ) : (
      <Folder className="w-4 h-4 text-yellow-400 shrink-0" />
    );
  }
  const ext = node.name.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx", "js", "jsx"].includes(ext)) return <FileCode className="w-4 h-4 text-blue-400 shrink-0" />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return <Image className="w-4 h-4 text-green-400 shrink-0" />;
  if (["zip", "gz", "tar", "rar"].includes(ext)) return <FileArchive className="w-4 h-4 text-orange-400 shrink-0" />;
  return <FileText className="w-4 h-4 text-gray-400 shrink-0" />;
}

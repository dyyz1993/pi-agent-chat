import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import type { RPCMethods } from "../lib/api-client";
import type { TreeNode, FilePreview, EditingNode } from "../types";
import { isTextFile, isImageFile, formatSize } from "../utils/file-utils";
import { MAX_PREVIEW_SIZE } from "../utils/constants";
import { useAppStore } from "./use-app-store";
import { uploadEntriesWeb, importFilesDesktop, type DropEntry } from "../utils/drop-handler";

interface ExplorerState {
  treeNodes: TreeNode[];
  currentPath: string;
  selectedPath: string | null;
  filePreview: FilePreview | null;
  loadingFile: boolean;
  editingNode: EditingNode | null;

  setCurrentPath: (path: string) => void;
  listRootDir: () => Promise<void>;
  toggleNode: (nodePath: string) => Promise<void>;
  openFile: (node: TreeNode) => Promise<void>;
  closePreview: () => void;

  createFile: (dirPath: string, name: string) => Promise<void>;
  createDir: (dirPath: string, name: string) => Promise<void>;
  renameNode: (oldPath: string, newName: string) => Promise<void>;
  deleteNode: (path: string) => Promise<void>;
  refreshDir: (dirPath: string) => Promise<void>;
  startEditing: (path: string, type: EditingNode["type"]) => void;
  cancelEditing: () => void;
  importFiles: (entries: DropEntry[], destDir: string) => Promise<number>;
}

function entriesToTreeNodes(entries: RPCMethods["file.listDir"]["result"]["entries"]): TreeNode[] {
  return entries.map((e) => ({
    name: e.name,
    path: e.path,
    type: e.type,
    size: e.size,
    children: e.type === "directory" ? [] : undefined,
    expanded: false,
    loaded: false,
  }));
}

function getFileUrl(filePath: string): string {
  const mode = useAppStore.getState().mode;
  if (mode === "desktop") return `file://${filePath}`;
  const baseUrl = apiClient.getBaseUrl();
  const token = apiClient.getAuthToken();
  return `${baseUrl}/file/${encodeURIComponent(filePath)}?token=${token}`;
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

function updateExpanded(nodes: TreeNode[], path: string, expanded: boolean): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === path) return { ...n, expanded };
    if (n.children) return { ...n, children: updateExpanded(n.children, path, expanded) };
    return n;
  });
}

function loadChildren(nodes: TreeNode[], nodePath: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === nodePath) return { ...n, children, expanded: true, loaded: true };
    if (n.children) return { ...n, children: loadChildren(n.children, nodePath, children) };
    return n;
  });
}

function removeNode(nodes: TreeNode[], path: string): TreeNode[] {
  return nodes
    .filter((n) => n.path !== path)
    .map((n) => {
      if (n.children) return { ...n, children: removeNode(n.children, path) };
      return n;
    });
}

function renameInTree(nodes: TreeNode[], oldPath: string, newPath: string, newName: string): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === oldPath) {
      return { ...n, name: newName, path: newPath };
    }
    if (n.children) {
      return { ...n, children: renameInTree(n.children, oldPath, newPath, newName) };
    }
    return n;
  });
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  treeNodes: [],
  currentPath: "",
  selectedPath: null,
  filePreview: null,
  loadingFile: false,
  editingNode: null,

  setCurrentPath: (path) => set({ currentPath: path }),

  listRootDir: async () => {
    const { currentPath } = get();
    const addLog = useAppStore.getState().addLog;
    addLog(`ListDir: ${currentPath}`);
    try {
      const res = await apiClient.call("file.listDir", { path: currentPath });
      set({
        treeNodes: entriesToTreeNodes(res.entries),
        // Update currentPath to the resolved absolute path
        currentPath: res.basePath,
      });
      addLog(`Found ${res.entries.length} items`);
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  toggleNode: async (nodePath: string) => {
    const { treeNodes } = get();
    const addLog = useAppStore.getState().addLog;
    const target = findNode(treeNodes, nodePath);
    if (!target) return;

    if (target.expanded) {
      set({ treeNodes: updateExpanded(treeNodes, nodePath, false) });
    } else if (target.loaded) {
      set({ treeNodes: updateExpanded(treeNodes, nodePath, true) });
    } else {
      addLog(`ListDir: ${nodePath}`);
      try {
        const res = await apiClient.call("file.listDir", { path: nodePath });
        const children = entriesToTreeNodes(res.entries);
        addLog(`Found ${res.entries.length} items`);
        set({ treeNodes: loadChildren(treeNodes, nodePath, children) });
      } catch (err) {
        addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  },

  openFile: async (node: TreeNode) => {
    if (node.type === "directory") return;
    const addLog = useAppStore.getState().addLog;
    set({ selectedPath: node.path, loadingFile: true });

    const fileSize = node.size || 0;
    const preview: FilePreview = {
      path: node.path,
      name: node.name,
      content: null,
      imageUrl: null,
      mimeType: "",
      size: fileSize,
      isText: isTextFile(node.name),
      isImage: isImageFile(node.name),
    };

    try {
      const mode = useAppStore.getState().mode;

      if (preview.isImage) {
        preview.imageUrl = getFileUrl(node.path);
      } else if (preview.isText) {
        if (fileSize > MAX_PREVIEW_SIZE) {
          preview.content = `[File too large to preview: ${formatSize(fileSize)}]\n\nThis file exceeds the 500KB preview limit.\nUse an external editor to view this file.`;
          set({ filePreview: preview, loadingFile: false });
          addLog(`Skipped large file: ${node.name} (${formatSize(fileSize)})`);
          return;
        }

        let text: string;
        if (mode === "desktop") {
          // Desktop: read file via RPC (file:// blocked by webview)
          const res = await apiClient.call("file.readFile", { path: node.path });
          text = res.content;
          preview.mimeType = "text/plain";
        } else {
          // Web: fetch via HTTP file server
          const url = getFileUrl(node.path);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          text = await res.text();
          preview.mimeType = res.headers.get("content-type") || "text/plain";
        }
        preview.content = text;
        preview.totalLines = text.split("\n").length;
      } else {
        preview.content = `[Binary file: ${node.name} (${formatSize(preview.size)})]`;
        preview.isText = true;
      }
      addLog(`Opened: ${node.name}`);
    } catch (err) {
      preview.content = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
      preview.isText = true;
      addLog(`Error opening ${node.name}: ${err instanceof Error ? err.message : String(err)}`);
    }

    set({ filePreview: preview, loadingFile: false });
  },

  closePreview: () => set({ filePreview: null, selectedPath: null }),

  createFile: async (dirPath: string, name: string) => {
    const addLog = useAppStore.getState().addLog;
    try {
      await apiClient.call("file.createFile", { dirPath, name });
      addLog(`Created file: ${name}`);
      set({ editingNode: null });
      await get().refreshDir(dirPath);
    } catch (err) {
      addLog(`Error creating file: ${err instanceof Error ? err.message : String(err)}`);
      set({ editingNode: null });
    }
  },

  createDir: async (dirPath: string, name: string) => {
    const addLog = useAppStore.getState().addLog;
    try {
      await apiClient.call("file.createDir", { dirPath, name });
      addLog(`Created directory: ${name}`);
      set({ editingNode: null });
      await get().refreshDir(dirPath);
    } catch (err) {
      addLog(`Error creating directory: ${err instanceof Error ? err.message : String(err)}`);
      set({ editingNode: null });
    }
  },

  renameNode: async (oldPath: string, newName: string) => {
    const { treeNodes } = get();
    const addLog = useAppStore.getState().addLog;
    try {
      const res = await apiClient.call("file.rename", { oldPath, newName });
      addLog(`Renamed to: ${newName}`);
      set({
        treeNodes: renameInTree(treeNodes, oldPath, res.newPath, newName),
        editingNode: null,
        selectedPath: res.newPath,
      });
    } catch (err) {
      addLog(`Error renaming: ${err instanceof Error ? err.message : String(err)}`);
      set({ editingNode: null });
    }
  },

  deleteNode: async (path: string) => {
    const { treeNodes } = get();
    const addLog = useAppStore.getState().addLog;
    try {
      await apiClient.call("file.delete", { path });
      addLog(`Deleted: ${path}`);
      // Find parent dir to refresh
      const pathParts = path.split("/");
      pathParts.pop();
      const parentPath = pathParts.join("/") || get().currentPath;
      set({ treeNodes: removeNode(treeNodes, path) });
      // Clear preview if the deleted file was being previewed
      const { selectedPath } = get();
      if (selectedPath === path) {
        set({ selectedPath: null, filePreview: null });
      }
      await get().refreshDir(parentPath);
    } catch (err) {
      addLog(`Error deleting: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  refreshDir: async (dirPath: string) => {
    const { treeNodes, currentPath } = get();
    const addLog = useAppStore.getState().addLog;
    // If refreshing root
    if (dirPath === currentPath) {
      await get().listRootDir();
      return;
    }
    try {
      const res = await apiClient.call("file.listDir", { path: dirPath });
      const children = entriesToTreeNodes(res.entries);
      set({ treeNodes: loadChildren(treeNodes, dirPath, children) });
    } catch (err) {
      addLog(`Error refreshing: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  startEditing: (path, type) => set({ editingNode: { path, type } }),
  cancelEditing: () => set({ editingNode: null }),

  importFiles: async (entries, destDir) => {
    const addLog = useAppStore.getState().addLog;
    const mode = useAppStore.getState().mode;
    try {
      const count = mode === "desktop"
        ? await importFilesDesktop(entries, destDir)
        : await uploadEntriesWeb(entries, destDir);
      addLog(`Imported ${count} items to ${destDir}`);
      await get().refreshDir(destDir);
      return count;
    } catch (err) {
      addLog(`Import error: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  },
}));

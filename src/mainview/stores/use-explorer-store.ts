import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import type { RPCMethods } from "../lib/api-client";
import type { TreeNode, FilePreview, EditingNode } from "../types";
import { isTextFile, isImageFile, formatSize } from "../utils/file-utils";
import { MAX_PREVIEW_SIZE } from "../utils/constants";
import { useAppStore } from "./use-app-store";
import { useChatOverlayStore } from "./use-chat-overlay-store";
import { uploadEntriesWeb, importFilesDesktop, type DropEntry } from "../utils/drop-handler";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("file");

interface ExplorerState {
  treeNodes: TreeNode[];
  currentPath: string;
  selectedPath: string | null;
  filePreview: FilePreview | null;
  loadingFile: boolean;
  editingNode: EditingNode | null;
  _explorerVersion: number;
  _fileWatchSubId: string | null;
  _refreshDebounceTimer: ReturnType<typeof setTimeout> | null;
  _pendingRefreshDirs: Set<string>;

  setCurrentPath: (path: string) => void;
  listRootDir: () => Promise<void>;
  toggleNode: (nodePath: string) => Promise<void>;
  openFile: (node: TreeNode, editable?: boolean) => Promise<void>;
  closePreview: () => void;

  createFile: (dirPath: string, name: string) => Promise<string | null>;
  createDir: (dirPath: string, name: string) => Promise<void>;
  saveFileContent: (filePath: string, content: string) => Promise<void>;
  setFileEditable: (editable: boolean) => void;
  renameNode: (oldPath: string, newName: string) => Promise<void>;
  deleteNode: (path: string) => Promise<void>;
  refreshDir: (dirPath: string) => Promise<void>;
  startEditing: (path: string, type: EditingNode["type"]) => void;
  cancelEditing: () => void;
  importFiles: (entries: DropEntry[], destDir: string) => Promise<number>;
  subscribeFileWatcher: () => Promise<void>;
  unsubscribeFileWatcher: () => void;
}

function entriesToTreeNodes(entries: RPCMethods["file.listDir"]["result"]["entries"]): TreeNode[] {
  return entries.map((e) => ({
    name: e.name,
    path: e.path,
    type: e.type,
    size: e.size,
    isIgnored: e.isIgnored,
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
  let changed = false;
  const result = nodes.map((n) => {
    if (n.path === path) {
      changed = true;
      return { ...n, expanded };
    }
    if (n.children) {
      const newChildren = updateExpanded(n.children, path, expanded);
      if (newChildren !== n.children) {
        changed = true;
        return { ...n, children: newChildren };
      }
    }
    return n;
  });
  return changed ? result : nodes;
}

function loadChildren(nodes: TreeNode[], nodePath: string, children: TreeNode[]): TreeNode[] {
  let changed = false;
  const result = nodes.map((n) => {
    if (n.path === nodePath) {
      changed = true;
      return { ...n, children, expanded: true, loaded: true };
    }
    if (n.children) {
      const newChildren = loadChildren(n.children, nodePath, children);
      if (newChildren !== n.children) {
        changed = true;
        return { ...n, children: newChildren };
      }
    }
    return n;
  });
  return changed ? result : nodes;
}

function removeNode(nodes: TreeNode[], path: string): TreeNode[] {
  let changed = false;
  const result = nodes
    .filter((n) => {
      if (n.path === path) {
        changed = true;
        return false;
      }
      return true;
    })
    .map((n) => {
      if (n.children) {
        const newChildren = removeNode(n.children, path);
        if (newChildren !== n.children) {
          changed = true;
          return { ...n, children: newChildren };
        }
      }
      return n;
    });
  return changed ? result : nodes;
}

function renameInTree(
  nodes: TreeNode[],
  oldPath: string,
  newPath: string,
  newName: string,
): TreeNode[] {
  let changed = false;
  const result = nodes.map((n) => {
    if (n.path === oldPath) {
      changed = true;
      return { ...n, name: newName, path: newPath };
    }
    if (n.children) {
      const newChildren = renameInTree(n.children, oldPath, newPath, newName);
      if (newChildren !== n.children) {
        changed = true;
        return { ...n, children: newChildren };
      }
    }
    return n;
  });
  return changed ? result : nodes;
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  treeNodes: [],
  currentPath: "",
  selectedPath: null,
  filePreview: null,
  loadingFile: false,
  editingNode: null,
  _explorerVersion: 0,
  _fileWatchSubId: null,
  _refreshDebounceTimer: null,
  _pendingRefreshDirs: new Set<string>(),

  setCurrentPath: (path) =>
    set({ currentPath: path, _explorerVersion: get()._explorerVersion + 1 }),

  listRootDir: async () => {
    const { currentPath, _explorerVersion } = get();
    if (!currentPath) return;
    const addLog = useAppStore.getState().addLog;
    addLog(`ListDir: ${currentPath}`);
    try {
      const res = await apiClient.call("file.listDir", { path: currentPath });
      if (_explorerVersion !== get()._explorerVersion) return;
      set({
        treeNodes: entriesToTreeNodes(res.entries),
      });
      addLog(`Found ${res.entries.length} items`);
      get().subscribeFileWatcher();
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

  openFile: async (node: TreeNode, editable?: boolean) => {
    if (node.type === "directory") return;
    const addLog = useAppStore.getState().addLog;

    const fileSize = node.size ?? 0;
    const preview: FilePreview = {
      path: node.path,
      name: node.name,
      content: null,
      imageUrl: null,
      mimeType: "",
      size: fileSize,
      isText: isTextFile(node.name),
      isImage: isImageFile(node.name),
      editable,
    };

    // Immediately show overlay with loading state
    set({ selectedPath: node.path, loadingFile: true, filePreview: preview });
    useChatOverlayStore.getState().openFile();

    try {
      if (preview.isImage) {
        preview.imageUrl = getFileUrl(node.path);
      } else if (preview.isText) {
        if (fileSize > MAX_PREVIEW_SIZE) {
          preview.content = `[File too large to preview: ${formatSize(fileSize)}]\n\nThis file exceeds the 500KB preview limit.\nUse an external editor to view this file.`;
          set({ filePreview: { ...preview }, loadingFile: false });
          addLog(`Skipped large file: ${node.name} (${formatSize(fileSize)})`);
          return;
        }

        const res = await apiClient.call("file.readFile", { path: node.path });
        const text = res.content;
        preview.mimeType = "text/plain";
        preview.content = text;
        preview.totalLines = (text.match(/\n/g) ?? []).length + 1;
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

    set({ filePreview: { ...preview }, loadingFile: false });
  },

  closePreview: () => {
    useChatOverlayStore.getState().close();
    set({ filePreview: null, selectedPath: null });
  },

  createFile: async (dirPath: string, name: string) => {
    const addLog = useAppStore.getState().addLog;
    try {
      const res = await apiClient.call("file.createFile", { dirPath, name });
      addLog(`Created file: ${name}`);
      set({ editingNode: null });
      await get().refreshDir(dirPath);
      // Auto-open the new file in editable preview
      const node = findNode(get().treeNodes, res.path);
      if (node) {
        await get().openFile(node, true);
      }
      return res.path;
    } catch (err) {
      addLog(`Error creating file: ${err instanceof Error ? err.message : String(err)}`);
      set({ editingNode: null });
      return null;
    }
  },

  saveFileContent: async (filePath: string, content: string) => {
    const addLog = useAppStore.getState().addLog;
    try {
      await apiClient.call("file.writeFile", { path: filePath, content });
      addLog(`Saved: ${filePath}`);
      const { filePreview } = get();
      if (filePreview && filePreview.path === filePath) {
        set({
          filePreview: {
            ...filePreview,
            content,
            totalLines: content.split("\n").length,
          },
        });
      }
    } catch (err) {
      addLog(`Error saving file: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  setFileEditable: (editable: boolean) => {
    const { filePreview } = get();
    if (filePreview) {
      set({ filePreview: { ...filePreview, editable } });
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
      const count =
        mode === "desktop"
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

  subscribeFileWatcher: async () => {
    const { _fileWatchSubId, currentPath } = get();
    if (_fileWatchSubId || !currentPath) return;

    try {
      const subId = await apiClient.subscribe("file.changed", (payload) => {
        const state = get();
        const { currentPath: cp, treeNodes, _refreshDebounceTimer, _pendingRefreshDirs } = state;
        if (!cp) return;

        const changedDir =
          payload.changedPath.includes("/") || payload.changedPath.includes("\\")
            ? payload.changedPath.substring(
                0,
                payload.changedPath.lastIndexOf(payload.changedPath.includes("/") ? "/" : "\\"),
              )
            : cp;

        if (changedDir !== cp) {
          const node = findNode(treeNodes, changedDir);
          if (!node || !node.expanded) return;
        }

        _pendingRefreshDirs.add(changedDir === cp ? cp : changedDir);

        if (_refreshDebounceTimer) clearTimeout(_refreshDebounceTimer);
        const timer = setTimeout(() => {
          const dirs = new Set(get()._pendingRefreshDirs);
          set({ _refreshDebounceTimer: null, _pendingRefreshDirs: new Set() });
          for (const dir of dirs) {
            get().refreshDir(dir);
          }
        }, 500);
        set({ _refreshDebounceTimer: timer });
      });
      set({ _fileWatchSubId: subId });
    } catch (e) {
      log.warn("Failed to subscribe to file watcher", { error: String(e) });
    }
  },

  unsubscribeFileWatcher: () => {
    const { _fileWatchSubId, _refreshDebounceTimer } = get();
    if (_refreshDebounceTimer) clearTimeout(_refreshDebounceTimer);
    if (_fileWatchSubId) {
      apiClient.unsubscribe(_fileWatchSubId);
    }
    set({ _fileWatchSubId: null, _refreshDebounceTimer: null, _pendingRefreshDirs: new Set() });
  },
}));

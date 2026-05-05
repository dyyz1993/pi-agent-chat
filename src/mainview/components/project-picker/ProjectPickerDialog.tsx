import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  FolderOpen,
  Folder,
  Search,
  ChevronRight,
  ChevronLeft,
  Home,
  Star,
  Trash2,
  Pin,
  Loader2,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import type { RecentProject, DirectoryEntry, FavoriteFolder } from "../../types";
import { useFocusTrap } from "../../hooks/use-focus-trap";

interface ProjectPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string, name: string) => void;
}

type LeftView = "default" | "browse";

const CACHE_KEY_RECENTS = "pi-picker-recents";
const CACHE_KEY_FAVORITES = "pi-picker-favorites";
const CACHE_TTL = 5 * 60 * 1000;

function readCache<T>(key: string): { data: T; ts: number } | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as { data: T; ts: number };
  } catch {
    return undefined;
  }
}

function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* localStorage unavailable in some contexts */
  }
}

function isCacheValid(ts: number) {
  return Date.now() - ts < CACHE_TTL;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function pathBasename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

function pathDirname(p: string): string | null {
  const normalized = p.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return null;
  return "/" + parts.slice(0, -1).join("/");
}

function splitPath(p: string): { label: string; path: string }[] {
  const normalized = p.replace(/\\/g, "/");
  if (normalized === "/") return [{ label: "/", path: "/" }];
  const parts = normalized.split("/").filter(Boolean);
  let acc = "";
  return parts.map((part) => {
    acc += "/" + part;
    return { label: part, path: acc };
  });
}

export function ProjectPickerDialog({ open, onClose, onSelect }: ProjectPickerDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(false);

  const [leftView, setLeftView] = useState<LeftView>("default");
  const [currentPath, setCurrentPath] = useState<string>("");
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryEntry[]>([]);
  const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolder[]>([]);
  const [browserSearchQuery, setBrowserSearchQuery] = useState("");
  const [browsingLoading, setBrowsingLoading] = useState(false);

  const homePathRef = useRef<string>("");
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const desktopDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(mobileDialogRef, { onEscape: onClose });
  useFocusTrap(desktopDialogRef, { onEscape: onClose });

  const loadRecentsAndFavorites = useCallback((forceRefresh = false) => {
    const cachedRecents = readCache<RecentProject[]>(CACHE_KEY_RECENTS);
    const cachedFavorites = readCache<FavoriteFolder[]>(CACHE_KEY_FAVORITES);

    if (!forceRefresh) {
      if (cachedRecents && isCacheValid(cachedRecents.ts)) {
        setRecents(cachedRecents.data);
      }
      if (cachedFavorites && isCacheValid(cachedFavorites.ts)) {
        setFavoriteFolders(cachedFavorites.data);
      }
    }

    setLoading(true);
    Promise.all([
      apiClient.call("project.listRecent", {}),
      apiClient.call("project.listFavoriteFolders", {}),
      apiClient.call("project.listConfiguredPaths", {}),
    ])
      .then(([recentResult, favResult, pathsResult]) => {
        const projects = (recentResult.projects as RecentProject[]) || [];
        const folders = (favResult.folders as FavoriteFolder[]) || [];
        const paths = (pathsResult.paths as { path: string; type: string }[]) || [];
        setRecents(projects);
        setFavoriteFolders(folders);
        writeCache(CACHE_KEY_RECENTS, projects);
        writeCache(CACHE_KEY_FAVORITES, folders);
        const home = paths.find((p) => p.type === "home");
        if (home) homePathRef.current = home.path;
      })
      .catch((err) => {
        console.warn("[ProjectPicker] loadRecentProjects failed:", err);
        if (!cachedRecents || !isCacheValid(cachedRecents.ts)) setRecents([]);
        if (!cachedFavorites || !isCacheValid(cachedFavorites.ts)) setFavoriteFolders([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setBrowserSearchQuery("");
      setLeftView("default");
      setCurrentPath("");
      setDirectoryEntries([]);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }
    loadRecentsAndFavorites();
  }, [open, loadRecentsAndFavorites]);

  useEffect(() => {
    if (!open || leftView !== "browse" || !currentPath) return;
    let cancelled = false;
    setBrowsingLoading(true);
    apiClient
      .call("project.listDirectory", {
        dirPath: currentPath,
        searchQuery: browserSearchQuery || undefined,
      })
      .then((result) => {
        if (!cancelled) setDirectoryEntries((result.entries as DirectoryEntry[]) || []);
      })
      .catch((err) => {
        console.warn("[ProjectPicker] listDir failed:", err);
        if (!cancelled) setDirectoryEntries([]);
      })
      .finally(() => {
        if (!cancelled) setBrowsingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leftView, currentPath, browserSearchQuery]);

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setLeftView("browse");
    setBrowserSearchQuery("");
  }, []);

  const exitBrowse = useCallback(() => {
    setLeftView("default");
    setCurrentPath("");
    setDirectoryEntries([]);
    setBrowserSearchQuery("");
  }, []);

  const navigateUp = useCallback(() => {
    if (!currentPath) return;
    const parent = pathDirname(currentPath);
    if (parent === null) {
      exitBrowse();
    } else {
      setCurrentPath(parent);
      setBrowserSearchQuery("");
    }
  }, [currentPath, exitBrowse]);

  const handleSelectCurrentFolder = useCallback(() => {
    if (!currentPath) return;
    const name = pathBasename(currentPath);
    onSelect(currentPath, name);
    onClose();
  }, [currentPath, onSelect, onClose]);

  const handleSelectFolder = useCallback(
    (path: string) => {
      onSelect(path, pathBasename(path));
      onClose();
    },
    [onSelect, onClose],
  );

  const handleToggleFavoriteFolder = useCallback(
    async (e: React.MouseEvent, folderPath: string) => {
      e.stopPropagation();
      try {
        const result = await apiClient.call("project.toggleFavoriteFolder", { folderPath });
        const updated = (result.favorites as FavoriteFolder[]) || [];
        setFavoriteFolders(updated);
        writeCache(CACHE_KEY_FAVORITES, updated);
      } catch (err) {
        console.warn("[ProjectPicker] toggleFavorite failed:", err);
      }
    },
    [],
  );

  const handleTogglePin = useCallback(async (e: React.MouseEvent, projectPath: string) => {
    e.stopPropagation();
    try {
      await apiClient.call("project.toggleProjectPin", { projectPath });
      setRecents((prev) => {
        const updated = prev.map((r) => (r.path === projectPath ? { ...r, pinned: !r.pinned } : r));
        writeCache(CACHE_KEY_RECENTS, updated);
        return updated;
      });
    } catch (err) {
      console.warn("[ProjectPicker] togglePin failed:", err);
    }
  }, []);

  const handleSelectRecent = useCallback(
    (proj: RecentProject) => {
      onSelect(proj.path, proj.name);
      onClose();
    },
    [onClose, onSelect],
  );

  const handleRemoveRecent = useCallback(async (e: React.MouseEvent, projectPath: string) => {
    e.stopPropagation();
    try {
      await apiClient.call("project.removeRecent", { projectPath });
      setRecents((prev) => {
        const updated = prev.filter((r) => r.path !== projectPath);
        writeCache(CACHE_KEY_RECENTS, updated);
        return updated;
      });
    } catch (err) {
      console.warn("[ProjectPicker] removeRecent failed:", err);
    }
  }, []);

  const filtered = recents.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.path.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const sortedRecents = [...filtered].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.lastOpened - a.lastOpened;
  });

  const isFav = (path: string) => favoriteFolders.some((f) => f.path === path);

  if (!open) return null;

  const renderProjectList = (projects: RecentProject[], mobile?: boolean) => {
    if (loading && projects.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      );
    }
    if (projects.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
          <FolderOpen className={mobile ? "w-10 h-10 opacity-30" : "w-8 h-8 opacity-30"} />
          <span className="text-sm">{searchQuery ? "没有匹配的项目" : "暂无最近打开的项目"}</span>
        </div>
      );
    }

    return projects.map((proj) => (
      <div
        key={proj.path}
        role="button"
        tabIndex={0}
        onClick={() => handleSelectRecent(proj)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSelectRecent(proj);
        }}
        className={`w-full flex items-center gap-3 text-left group transition-colors cursor-pointer ${
          mobile
            ? "px-4 py-3.5 rounded-xl active:bg-gray-800/80"
            : "px-3 py-2.5 rounded-lg hover:bg-gray-800/60"
        }`}
      >
        <Folder
          className={
            mobile ? "w-5 h-5 text-indigo-400/70 shrink-0" : "w-4 h-4 text-indigo-400/70 shrink-0"
          }
        />
        <div className="flex-1 min-w-0">
          <div
            className={
              mobile
                ? "text-sm font-medium text-gray-200 truncate"
                : "text-[12px] font-medium text-gray-200 truncate"
            }
          >
            {proj.name}
          </div>
          <div
            className={
              mobile ? "text-[11px] text-gray-500 truncate" : "text-[10px] text-gray-500 truncate"
            }
          >
            {proj.path}
          </div>
          {proj.sessionCount > 0 && (
            <div className="text-[10px] text-gray-600">{proj.sessionCount} 个会话</div>
          )}
        </div>
        <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(proj.lastOpened)}</span>
        <button
          onClick={(e) => handleTogglePin(e, proj.path)}
          className={`p-1 rounded hover:bg-gray-700/50 transition-all shrink-0 ${
            proj.pinned
              ? "text-amber-400 opacity-100"
              : "opacity-0 group-hover:opacity-100 text-gray-600 hover:text-amber-400"
          }`}
        >
          <Pin className="w-3 h-3" fill={proj.pinned ? "currentColor" : "none"} />
        </button>
        <button
          onClick={(e) => handleRemoveRecent(e, proj.path)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-600/20 text-gray-600 hover:text-red-400 transition-all shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    ));
  };

  const renderBreadcrumb = () => {
    if (!currentPath) return null;
    const segments = splitPath(currentPath);
    return (
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800 bg-gray-800/30 overflow-x-auto scrollbar-none">
        <button
          onClick={leftView === "browse" ? navigateUp : exitBrowse}
          className="p-1 rounded hover:bg-gray-700/50 text-gray-500 hover:text-gray-300 transition-colors shrink-0"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center gap-0.5 min-w-0 flex-1">
          {segments.map((seg, i) => (
            <div key={seg.path} className="flex items-center gap-0.5 shrink-0">
              {i > 0 && <ChevronRight className="w-3 h-3 text-gray-600 mx-0.5 shrink-0" />}
              <button
                onClick={() => navigateTo(seg.path)}
                className={`text-xs truncate max-w-[120px] px-1.5 py-0.5 rounded transition-colors ${
                  i === segments.length - 1
                    ? "text-indigo-300 font-medium bg-indigo-500/10"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
                }`}
              >
                {seg.label}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFolderList = () => {
    if (browsingLoading) {
      return (
        <div className="flex items-center justify-center py-10 text-gray-500 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载文件夹...
        </div>
      );
    }
    const dirs = directoryEntries.filter((e) => e.isDirectory);
    if (dirs.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-gray-600 gap-2">
          <Folder className="w-8 h-8 opacity-30" />
          <span className="text-xs">{browserSearchQuery ? "没有匹配的文件夹" : "此目录为空"}</span>
        </div>
      );
    }
    return dirs.map((entry) => (
      <div
        key={entry.path}
        className="w-full flex items-center gap-2 px-3 py-2 text-left group hover:bg-gray-800/50 rounded-lg transition-colors"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigateTo(entry.path)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigateTo(entry.path);
          }}
          className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
        >
          <Folder className="w-4 h-4 text-blue-400/70 shrink-0" />
          <span className="text-[12px] text-gray-200 truncate">{entry.name}</span>
        </div>
        <button
          onClick={() => handleSelectFolder(entry.path)}
          className="p-1 rounded hover:bg-indigo-500/20 text-gray-600 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          title="选择此文件夹作为项目"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => handleToggleFavoriteFolder(e, entry.path)}
          className={`p-1 rounded hover:bg-gray-700/50 transition-all shrink-0 ${
            isFav(entry.path)
              ? "text-amber-400 opacity-100"
              : "opacity-0 group-hover:opacity-100 text-gray-600 hover:text-amber-400"
          }`}
          title={isFav(entry.path) ? "取消收藏" : "收藏此目录"}
        >
          <Star className="w-3 h-3" fill={isFav(entry.path) ? "currentColor" : "none"} />
        </button>
        <ChevronRight
          onClick={() => navigateTo(entry.path)}
          className="w-3 h-3 text-gray-600 group-hover:text-gray-400 cursor-pointer shrink-0"
        />
      </div>
    ));
  };

  const renderFavoriteFolders = () => {
    if (favoriteFolders.length === 0) {
      return (
        <div className="px-4 py-4 text-center">
          <Star className="w-6 h-6 text-gray-700 mx-auto mb-1.5" />
          <p className="text-[10px] text-gray-600">浏览文件夹时可收藏常用目录</p>
        </div>
      );
    }
    return favoriteFolders.map((folder) => (
      <div
        key={folder.path}
        role="button"
        tabIndex={0}
        onClick={() => handleSelectFolder(folder.path)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSelectFolder(folder.path);
        }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left group cursor-pointer hover:bg-gray-800/50 rounded-lg transition-colors"
      >
        <Folder className="w-4 h-4 text-amber-400/70 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[12px] text-gray-200 truncate block">{folder.name}</span>
          <span className="text-[10px] text-gray-500 truncate block">{folder.path}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigateTo(folder.path);
          }}
          className="p-1 rounded hover:bg-gray-700/50 text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          title="浏览此目录"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => handleToggleFavoriteFolder(e, folder.path)}
          className="p-1 rounded hover:bg-red-600/20 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          title="取消收藏"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    ));
  };

  const renderLeftDefault = () => (
    <>
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          <p className="text-xs font-medium text-gray-300">收藏的目录</p>
        </div>
        <p className="text-[10px] text-gray-500 mt-0.5">点击选择项目，箭头浏览子目录</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-0.5">
        {renderFavoriteFolders()}
      </div>

      <div className="shrink-0 px-4 py-2.5 border-t border-gray-800">
        <button
          onClick={() => navigateTo(homePathRef.current || "/")}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-lg text-xs text-indigo-300 transition-colors"
        >
          <Home className="w-3.5 h-3.5" />
          浏览其他目录
        </button>
      </div>
    </>
  );

  const renderLeftBrowse = () => (
    <>
      {renderBreadcrumb()}
      <div className="px-3 py-2 border-b border-gray-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
          <input
            value={browserSearchQuery}
            onChange={(e) => setBrowserSearchQuery(e.target.value)}
            placeholder="搜索当前目录..."
            className="w-full pl-7 pr-3 py-1.5 bg-gray-800/50 border border-gray-700/50 rounded-md text-[11px] text-gray-300 placeholder:text-gray-600 outline-none focus:border-indigo-500/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">{renderFolderList()}</div>
      <div className="shrink-0 px-4 py-2.5 border-t border-gray-800">
        <button
          onClick={handleSelectCurrentFolder}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-medium text-white transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          选择当前文件夹
        </button>
      </div>
    </>
  );

  const renderLeftPanel = () => (
    <div className="w-[45%] min-w-[260px] border-r border-gray-800 flex flex-col">
      {leftView === "browse" ? renderLeftBrowse() : renderLeftDefault()}
    </div>
  );

  return (
    <>
      {/* Mobile view */}
      <div
        ref={mobileDialogRef}
        className="md:hidden fixed inset-0 z-[100] bg-gray-950 flex flex-col animate-slide-in-up"
        role="dialog"
        aria-modal="true"
        aria-label="选择项目"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-white">选择项目</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-gray-800 text-gray-400"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2.5 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索项目..."
              className="w-full pl-9 pr-4 py-2.5 bg-gray-800/60 border border-gray-700/50 rounded-xl text-sm text-gray-200 placeholder:text-gray-500 outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {favoriteFolders.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 px-1 py-1.5">
                <Star className="w-3 h-3 text-amber-400" />
                <span className="text-[11px] font-medium text-gray-400">收藏</span>
              </div>
              <div className="space-y-0.5">
                {favoriteFolders.map((folder) => (
                  <div
                    key={folder.path}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectFolder(folder.path)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSelectFolder(folder.path);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl active:bg-gray-800/80 cursor-pointer"
                  >
                    <Folder className="w-5 h-5 text-amber-400/70 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-200 truncate">
                        {folder.name}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">{folder.path}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sortedRecents.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-1 py-1.5">
                <FolderOpen className="w-3 h-3 text-gray-500" />
                <span className="text-[11px] font-medium text-gray-400">最近</span>
              </div>
              {renderProjectList(sortedRecents, true)}
            </div>
          )}

          {!loading && favoriteFolders.length === 0 && sortedRecents.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-gray-600 gap-2">
              <FolderOpen className="w-10 h-10 opacity-30" />
              <span className="text-sm">暂无项目</span>
            </div>
          )}
        </div>
      </div>

      {/* Desktop view */}
      <div className="hidden md:flex fixed inset-0 z-[100] items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        <div
          ref={desktopDialogRef}
          className="relative w-full max-w-4xl h-[70vh] mx-4 bg-gray-900 rounded-xl border border-gray-700/50 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          role="dialog"
          aria-modal="true"
          aria-label="选择项目"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
            <h2 className="text-sm font-semibold text-white">选择项目</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 flex overflow-hidden min-h-0">
            {renderLeftPanel()}

            {/* Right — Recent & Pinned */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-xs font-medium text-gray-300">最近的文件夹</p>
                  <p className="text-[10px] text-gray-500">{sortedRecents.length} 个文件夹可用</p>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索..."
                    className="pl-7 pr-3 py-1 w-36 bg-gray-800/50 border border-gray-700/50 rounded-md text-[11px] text-gray-300 placeholder:text-gray-600 outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
                {renderProjectList(sortedRecents)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

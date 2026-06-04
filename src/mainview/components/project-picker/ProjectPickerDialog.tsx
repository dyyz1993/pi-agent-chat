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
  Plus,
  FolderPlus,
  ArrowDownAZ,
  Clock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../shared/lib/logger";
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

const logger = createLogger("session");

function readCache<T>(key: string): { data: T; ts: number } | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as { data: T; ts: number };
  } catch (e) {
    logger.warn("Failed to read cache", { key, error: String(e) });
    return undefined;
  }
}

function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch (e) {
    logger.warn("Failed to write cache", { key, error: String(e) });
  }
}

function isCacheValid(ts: number) {
  return Date.now() - ts < CACHE_TTL;
}

function dedupeRecents(projects: RecentProject[]): RecentProject[] {
  const map = new Map<string, RecentProject>();
  for (const p of projects) {
    const existing = map.get(p.path);
    if (!existing || p.lastOpened > existing.lastOpened) {
      map.set(p.path, p);
    }
  }
  return Array.from(map.values());
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
  const { t } = useTranslation("sidebar");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileTab, setMobileTab] = useState<"recents" | "favorites" | "browse">("recents");

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t("picker.timeAgo.minutes", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("picker.timeAgo.hours", { count: hours });
    return t("picker.timeAgo.days", { count: Math.floor(hours / 24) });
  }
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(false);

  const [leftView, setLeftView] = useState<LeftView>("default");
  const [currentPath, setCurrentPath] = useState<string>("");
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryEntry[]>([]);
  const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolder[]>([]);
  const [browserSearchQuery, setBrowserSearchQuery] = useState("");
  const [browsingLoading, setBrowsingLoading] = useState(false);
  const [browserSortBy, setBrowserSortBy] = useState<"mtime" | "name">("mtime");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);

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
        setRecents(dedupeRecents(cachedRecents.data));
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
        const deduped = dedupeRecents(projects);
        const folders = (favResult.folders as FavoriteFolder[]) || [];
        const paths = (pathsResult.paths as { path: string; type: string }[]) || [];
        setRecents(deduped);
        setFavoriteFolders(folders);
        writeCache(CACHE_KEY_RECENTS, deduped);
        writeCache(CACHE_KEY_FAVORITES, folders);
        const home = paths.find((p) => p.type === "home");
        if (home) homePathRef.current = home.path;
      })
      .catch((err) => {
        logger.warn("loadRecentProjects failed", { error: String(err) });
        if (!cachedRecents || !isCacheValid(cachedRecents.ts)) setRecents([]);
        if (!cachedFavorites || !isCacheValid(cachedFavorites.ts)) setFavoriteFolders([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setMobileTab("recents");
      setBrowserSearchQuery("");
      setLeftView("default");
      setCurrentPath("");
      setDirectoryEntries([]);
      setBrowserSortBy("mtime");
      setShowCreateFolder(false);
      setNewFolderName("");
      setCreating(false);
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
        sortBy: browserSortBy,
      })
      .then((result) => {
        if (!cancelled) setDirectoryEntries((result.entries as DirectoryEntry[]) || []);
      })
      .catch((err) => {
        logger.warn("listDir failed", { error: String(err) });
        if (!cancelled) setDirectoryEntries([]);
      })
      .finally(() => {
        if (!cancelled) setBrowsingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leftView, currentPath, browserSearchQuery, browserSortBy]);

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

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim().replace(/[/\\]/g, "");
    if (!name || !currentPath) return;
    setCreating(true);
    try {
      const result = await apiClient.call("project.createDirectory", {
        parentPath: currentPath,
        folderName: name,
      });
      if (result.ok) {
        navigateTo(result.path as string);
        setShowCreateFolder(false);
        setNewFolderName("");
      }
    } catch (e) {
      logger.warn("Failed to create directory", {
        parentPath: currentPath,
        folderName: name,
        error: String(e),
      });
    } finally {
      setCreating(false);
    }
  }, [newFolderName, currentPath, navigateTo]);

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
        logger.warn("toggleFavorite failed", { error: String(err) });
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
      logger.warn("togglePin failed", { error: String(err) });
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
      logger.warn("removeRecent failed", { error: String(err) });
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
        <div className="flex items-center justify-center h-full text-text-tertiary text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("picker.loading")}
        </div>
      );
    }
    if (projects.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-text-secondary gap-2">
          <FolderOpen className={mobile ? "w-10 h-10 opacity-30" : "w-8 h-8 opacity-30"} />
          <span className="text-sm">
            {searchQuery ? t("picker.noMatchingProjects") : t("picker.noRecentProjects")}
          </span>
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
            ? "px-4 py-3.5 rounded-xl active:bg-surface-hover dark:active:bg-surface-dim/80"
            : "px-3 py-2.5 rounded-lg hover:bg-surface-hover dark:hover:bg-surface-dim/60"
        }`}
      >
        <Folder
          className={
            mobile
              ? "w-5 h-5 text-semantic-accent/70 shrink-0"
              : "w-4 h-4 text-semantic-accent/70 shrink-0"
          }
        />
        <div className="flex-1 min-w-0">
          <div
            className={
              mobile
                ? "text-sm font-medium text-text-primary truncate"
                : "text-[12px] font-medium text-text-primary truncate"
            }
          >
            {proj.name}
          </div>
          <div
            className={
              mobile
                ? "text-[11px] text-text-tertiary truncate"
                : "text-[10px] text-text-tertiary truncate"
            }
          >
            {proj.path}
          </div>
          {proj.sessionCount > 0 && (
            <div className="text-[10px] text-text-secondary">
              {t("picker.sessionCount", { count: proj.sessionCount })}
            </div>
          )}
        </div>
        <span className="text-[10px] text-text-secondary shrink-0">{timeAgo(proj.lastOpened)}</span>
        <button
          onClick={(e) => handleTogglePin(e, proj.path)}
          className={`p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-hover/50 transition-all shrink-0 ${
            proj.pinned
              ? "text-status-warning opacity-100"
              : "opacity-0 group-hover:opacity-100 text-text-secondary hover:text-status-warning"
          }`}
        >
          <Pin className="w-3 h-3" fill={proj.pinned ? "currentColor" : "none"} />
        </button>
        <button
          onClick={(e) => handleRemoveRecent(e, proj.path)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-status-error/20 text-text-secondary hover:text-status-error transition-all shrink-0"
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
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-secondary dark:border-surface-code bg-surface-dim dark:bg-surface-dim/30 overflow-x-auto scrollbar-none">
        <button
          onClick={leftView === "browse" ? navigateUp : exitBrowse}
          className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-hover/50 text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors shrink-0"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center gap-0.5 min-w-0 flex-1">
          {segments.map((seg, i) => (
            <div key={seg.path} className="flex items-center gap-0.5 shrink-0">
              {i > 0 && <ChevronRight className="w-3 h-3 text-text-secondary mx-0.5 shrink-0" />}
              <button
                onClick={() => navigateTo(seg.path)}
                className={`text-xs truncate max-w-[120px] px-1.5 py-0.5 rounded transition-colors ${
                  i === segments.length - 1
                    ? "text-semantic-accent font-medium bg-semantic-accent/10"
                    : "text-text-tertiary hover:text-text-secondary dark:hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover/50"
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
        <div className="flex items-center justify-center py-10 text-text-tertiary text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("picker.loadingFolders")}
        </div>
      );
    }
    const dirs = directoryEntries.filter((e) => e.isDirectory);
    if (dirs.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-text-secondary gap-2">
          <Folder className="w-8 h-8 opacity-30" />
          <span className="text-xs">
            {browserSearchQuery ? t("picker.noMatchingFolders") : t("picker.emptyDirectory")}
          </span>
        </div>
      );
    }
    return dirs.map((entry) => (
      <div
        key={entry.path}
        className="w-full flex items-center gap-2 px-3 py-2 text-left group hover:bg-surface-hover dark:hover:bg-surface-dim/50 rounded-lg transition-colors"
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
          <Folder className="w-4 h-4 text-status-info/70 shrink-0" />
          <span className="text-[12px] text-text-primary truncate">{entry.name}</span>
        </div>
        <button
          onClick={() => handleSelectFolder(entry.path)}
          className="p-1 rounded hover:bg-semantic-accent/20 text-text-secondary hover:text-semantic-accent opacity-0 group-hover:opacity-100 transition-all shrink-0"
          title={t("picker.selectFolderAsProject")}
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => handleToggleFavoriteFolder(e, entry.path)}
          className={`p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-hover/50 transition-all shrink-0 ${
            isFav(entry.path)
              ? "text-status-warning opacity-100"
              : "opacity-0 group-hover:opacity-100 text-text-secondary hover:text-status-warning"
          }`}
          title={isFav(entry.path) ? t("picker.unfavorite") : t("picker.favoriteDir")}
        >
          <Star className="w-3 h-3" fill={isFav(entry.path) ? "currentColor" : "none"} />
        </button>
        <ChevronRight
          onClick={() => navigateTo(entry.path)}
          className="w-3 h-3 text-text-secondary group-hover:text-text-tertiary cursor-pointer shrink-0"
        />
      </div>
    ));
  };

  const renderFavoriteFolders = () => {
    if (favoriteFolders.length === 0) {
      return (
        <div className="px-4 py-4 text-center">
          <Star className="w-6 h-6 text-text-secondary mx-auto mb-1.5" />
          <p className="text-[10px] text-text-secondary">{t("picker.noFavoritesHint")}</p>
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
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left group cursor-pointer hover:bg-surface-hover dark:hover:bg-surface-dim/50 rounded-lg transition-colors"
      >
        <Folder className="w-4 h-4 text-status-warning/70 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[12px] text-text-primary truncate block">{folder.name}</span>
          <span className="text-[10px] text-text-tertiary truncate block">{folder.path}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigateTo(folder.path);
          }}
          className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-hover/50 text-text-secondary hover:text-status-info opacity-0 group-hover:opacity-100 transition-all shrink-0"
          title={t("picker.browseDir")}
        >
          <ChevronRight className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => handleToggleFavoriteFolder(e, folder.path)}
          className="p-1 rounded hover:bg-status-error/20 text-text-secondary hover:text-status-error opacity-0 group-hover:opacity-100 transition-all shrink-0"
          title={t("picker.unfavorite")}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    ));
  };

  const renderLeftDefault = () => (
    <>
      <div className="px-4 py-3 border-b border-border-secondary dark:border-surface-code">
        <div className="flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-status-warning" />
          <p className="text-xs font-medium text-text-secondary">{t("picker.favoritedDirs")}</p>
        </div>
        <p className="text-[10px] text-text-tertiary mt-0.5">{t("picker.favoritedDirsHint")}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-0.5">
        {renderFavoriteFolders()}
      </div>

      <div className="shrink-0 px-4 py-2.5 border-t border-border-secondary dark:border-surface-code">
        <button
          onClick={() => navigateTo(homePathRef.current || "/")}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-semantic-accent/20 hover:bg-semantic-accent/30 border border-semantic-accent/30 rounded-lg text-xs text-semantic-accent transition-colors"
        >
          <Home className="w-3.5 h-3.5" />
          {t("picker.browseOtherDirs")}
        </button>
      </div>
    </>
  );

  const renderLeftBrowse = () => (
    <>
      {renderBreadcrumb()}
      <div className="px-3 py-2 border-b border-border-secondary dark:border-surface-code">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary" />
            <input
              value={browserSearchQuery}
              onChange={(e) => setBrowserSearchQuery(e.target.value)}
              placeholder={t("picker.searchCurrentDir")}
              className="w-full pl-7 pr-3 py-1.5 bg-surface-code dark:bg-surface-dim/50 border border-border-secondary dark:border-border-secondary/50 rounded-md text-[11px] text-text-secondary placeholder:text-text-secondary outline-none focus:border-semantic-accent/50"
            />
          </div>
          <button
            onClick={() => setBrowserSortBy((prev) => (prev === "mtime" ? "name" : "mtime"))}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-md border text-[10px] transition-colors shrink-0 ${
              browserSortBy === "mtime"
                ? "border-semantic-accent/40 bg-semantic-accent/10 text-semantic-accent"
                : "border-border-secondary dark:border-border-secondary/50 text-text-tertiary hover:text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover/50"
            }`}
            title={browserSortBy === "mtime" ? t("picker.sortByModified") : t("picker.sortByName")}
          >
            {browserSortBy === "mtime" ? (
              <Clock className="w-3 h-3" />
            ) : (
              <ArrowDownAZ className="w-3 h-3" />
            )}
            {browserSortBy === "mtime" ? t("picker.sortModified") : t("picker.sortName")}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">{renderFolderList()}</div>
      <div className="shrink-0 px-4 py-2.5 border-t border-border-secondary dark:border-surface-code">
        <button
          onClick={handleSelectCurrentFolder}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-semantic-accent hover:bg-semantic-accent rounded-lg text-xs font-medium text-white transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {t("picker.selectCurrentFolder")}
        </button>
      </div>
    </>
  );

  const renderLeftPanel = () => (
    <div className="w-[45%] min-w-[260px] border-r border-border-secondary dark:border-surface-code flex flex-col">
      {leftView === "browse" ? renderLeftBrowse() : renderLeftDefault()}
    </div>
  );

  return (
    <>
      {/* Mobile view */}
      <div
        ref={mobileDialogRef}
        className="md:hidden fixed inset-0 z-[100] bg-surface-code flex flex-col animate-slide-in-up"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        role="dialog"
        aria-modal="true"
        aria-label={t("picker.title")}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-border-secondary dark:border-surface-code shrink-0"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
        >
          <h2 className="text-sm font-semibold text-text-primary">{t("picker.title")}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary"
            aria-label={t("picker.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex bg-surface-code dark:bg-surface-dim/50 mx-3 mt-3 rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => setMobileTab("recents")}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${
              mobileTab === "recents"
                ? "bg-bg-elevated dark:bg-surface-hover text-text-primary shadow-sm"
                : "text-text-tertiary"
            }`}
          >
            {t("picker.recents")}
          </button>
          <button
            onClick={() => setMobileTab("favorites")}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${
              mobileTab === "favorites"
                ? "bg-bg-elevated dark:bg-surface-hover text-text-primary shadow-sm"
                : "text-text-tertiary"
            }`}
          >
            {t("picker.favorites")}
          </button>
          <button
            onClick={() => {
              setMobileTab("browse");
              if (leftView !== "browse") navigateTo(homePathRef.current || "/");
            }}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${
              mobileTab === "browse"
                ? "bg-bg-elevated dark:bg-surface-hover text-text-primary shadow-sm"
                : "text-text-tertiary"
            }`}
          >
            {t("picker.browse")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 pt-2 flex flex-col min-h-0">
          {mobileTab === "recents" && (
            <div className="flex-1 flex flex-col">
              <div className="relative py-2 shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("picker.searchProject")}
                  className="w-full pl-9 pr-4 py-2.5 bg-surface-code dark:bg-surface-dim/60 border border-border-secondary dark:border-border-secondary/50 rounded-xl text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-semantic-accent/50"
                />
              </div>
              {renderProjectList(sortedRecents, true)}
              {!loading && sortedRecents.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-text-secondary gap-2">
                  <FolderOpen className="w-10 h-10 opacity-30" />
                  <span className="text-sm">
                    {searchQuery ? t("picker.noMatchingProjects") : t("picker.noRecentProjects")}
                  </span>
                </div>
              )}
            </div>
          )}

          {mobileTab === "favorites" && (
            <div className="flex-1 flex flex-col">
              {favoriteFolders.length > 0 ? (
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
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl active:bg-surface-hover dark:active:bg-surface-dim/80 cursor-pointer"
                    >
                      <Folder className="w-5 h-5 text-status-warning/70 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text-primary truncate">
                          {folder.name}
                        </div>
                        <div className="text-[11px] text-text-tertiary truncate">{folder.path}</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMobileTab("browse");
                          navigateTo(folder.path);
                        }}
                        className="p-2 rounded-lg active:bg-surface-hover dark:active:bg-surface-hover/50 text-text-tertiary active:text-status-info shrink-0"
                        title={t("picker.browseDir")}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => handleToggleFavoriteFolder(e, folder.path)}
                        className="p-2 rounded-lg active:bg-surface-hover dark:active:bg-surface-hover/50 text-text-tertiary active:text-status-error shrink-0"
                        title={t("picker.unfavorite")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 text-text-secondary gap-2">
                  <Star className="w-10 h-10 opacity-30" />
                  <span className="text-sm">{t("picker.noFavoritesHint")}</span>
                </div>
              )}
            </div>
          )}

          {mobileTab === "browse" && (
            <div className="flex-1 flex flex-col min-h-0">
              {renderBreadcrumb()}
              <div className="px-1 py-2 shrink-0">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary" />
                    <input
                      value={browserSearchQuery}
                      onChange={(e) => setBrowserSearchQuery(e.target.value)}
                      placeholder={t("picker.searchCurrentDir")}
                      className="w-full pl-7 pr-3 py-2 bg-surface-code dark:bg-surface-dim/60 border border-border-secondary dark:border-border-secondary/50 rounded-xl text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-semantic-accent/50"
                    />
                  </div>
                  <button
                    onClick={() =>
                      setBrowserSortBy((prev) => (prev === "mtime" ? "name" : "mtime"))
                    }
                    className={`flex items-center gap-1 px-2.5 py-2 rounded-xl border text-xs transition-colors shrink-0 ${
                      browserSortBy === "mtime"
                        ? "border-semantic-accent/40 bg-semantic-accent/10 text-semantic-accent"
                        : "border-border-secondary dark:border-border-secondary/50 text-text-tertiary active:text-text-secondary active:bg-surface-hover"
                    }`}
                  >
                    {browserSortBy === "mtime" ? (
                      <Clock className="w-3.5 h-3.5" />
                    ) : (
                      <ArrowDownAZ className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {browsingLoading ? (
                  <div className="flex items-center justify-center py-10 text-text-tertiary text-sm gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("picker.loadingFolders")}
                  </div>
                ) : (
                  (() => {
                    const dirs = directoryEntries.filter((e) => e.isDirectory);
                    if (dirs.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-10 text-text-secondary gap-2">
                          <Folder className="w-8 h-8 opacity-30" />
                          <span className="text-xs">
                            {browserSearchQuery
                              ? t("picker.noMatchingFolders")
                              : t("picker.emptyDirectory")}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-0.5">
                        {dirs.map((entry) => (
                          <div
                            key={entry.path}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl active:bg-surface-hover dark:active:bg-surface-dim/80 cursor-pointer"
                            onClick={() => navigateTo(entry.path)}
                          >
                            <Folder className="w-5 h-5 text-status-info/70 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-text-primary truncate">
                                {entry.name}
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectFolder(entry.path);
                              }}
                              className="p-2 rounded-lg active:bg-surface-hover dark:active:bg-surface-hover/50 text-text-tertiary active:text-semantic-accent shrink-0"
                              title={t("picker.selectFolderAsProject")}
                            >
                              <FolderOpen className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => handleToggleFavoriteFolder(e, entry.path)}
                              className={`p-2 rounded-lg active:bg-surface-hover dark:active:bg-surface-hover/50 shrink-0 ${
                                isFav(entry.path)
                                  ? "text-status-warning"
                                  : "text-text-tertiary active:text-status-warning"
                              }`}
                              title={
                                isFav(entry.path) ? t("picker.unfavorite") : t("picker.favoriteDir")
                              }
                            >
                              <Star
                                className="w-4 h-4"
                                fill={isFav(entry.path) ? "currentColor" : "none"}
                              />
                            </button>
                            <ChevronRight className="w-4 h-4 text-text-tertiary shrink-0" />
                          </div>
                        ))}
                      </div>
                    );
                  })()
                )}
              </div>
              <div className="shrink-0 pt-2 space-y-2">
                {showCreateFolder && (
                  <div className="flex items-center gap-2">
                    <input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateFolder();
                        if (e.key === "Escape") {
                          setShowCreateFolder(false);
                          setNewFolderName("");
                        }
                      }}
                      placeholder={t("picker.newFolderName")}
                      autoFocus
                      className="flex-1 px-3 py-2 bg-surface-code dark:bg-surface-dim/60 border border-border-secondary dark:border-border-secondary/50 rounded-xl text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-semantic-accent/50"
                    />
                    <button
                      onClick={handleCreateFolder}
                      disabled={!newFolderName.trim() || creating}
                      className="p-2 rounded-xl bg-semantic-accent active:bg-semantic-accent text-white disabled:opacity-40 shrink-0"
                    >
                      {creating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowCreateFolder((v) => !v);
                      setNewFolderName("");
                    }}
                    className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${
                      showCreateFolder
                        ? "bg-surface-hover dark:bg-surface-dim text-text-secondary"
                        : "bg-surface-code dark:bg-surface-dim/60 text-text-secondary active:bg-surface-hover dark:active:bg-surface-hover"
                    }`}
                  >
                    <FolderPlus className="w-4 h-4" />
                    {t("picker.createFolder")}
                  </button>
                  <button
                    onClick={handleSelectCurrentFolder}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-semantic-accent active:bg-semantic-accent rounded-xl text-sm font-medium text-white transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                    {t("picker.selectCurrentFolder")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Desktop view */}
      <div className="hidden md:flex fixed inset-0 z-[100] items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        <div
          ref={desktopDialogRef}
          className="relative w-full max-w-4xl h-[70vh] mx-4 bg-bg-elevated dark:bg-surface-code rounded-xl border border-border-secondary dark:border-border-secondary/50 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          role="dialog"
          aria-modal="true"
          aria-label={t("picker.title")}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-secondary dark:border-surface-code shrink-0">
            <h2 className="text-sm font-semibold text-text-primary">{t("picker.title")}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-primary transition-colors"
              aria-label={t("picker.close")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 flex overflow-hidden min-h-0">
            {renderLeftPanel()}

            {/* Right — Recent & Pinned */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-3 border-b border-border-secondary dark:border-surface-code flex items-center justify-between shrink-0">
                <div>
                  <p className="text-xs font-medium text-text-secondary">
                    {t("picker.recentFolders")}
                  </p>
                  <p className="text-[10px] text-text-tertiary">
                    {t("picker.foldersAvailable", { count: sortedRecents.length })}
                  </p>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("picker.searchPlaceholder")}
                    className="pl-7 pr-3 py-1 w-36 bg-surface-code dark:bg-surface-dim/50 border border-border-secondary dark:border-border-secondary/50 rounded-md text-[11px] text-text-secondary placeholder:text-text-tertiary dark:placeholder:text-text-secondary outline-none focus:border-semantic-accent/50"
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

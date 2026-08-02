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
  Server,
  PlugZap,
  Sparkles,
  RefreshCw,
  Check,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../shared/lib/logger";
import { apiClient } from "../../lib/api-client";
import type { QuickCreateAutoStart } from "../../lib/quick-create-auto-start";
import type { RecentProject, DirectoryEntry, FavoriteFolder } from "../../types";
import { useFocusTrap } from "../../hooks/use-focus-trap";
import { useAsyncGuard } from "../../hooks/use-async-guard";
import { IconButton } from "../primitives";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useInitialQcTier, type QcTier } from "./use-initial-qc-tier";

interface ProjectPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (
    path: string,
    name: string,
    options?: { quickStart?: QuickCreateAutoStart },
  ) => void | Promise<void>;
  onOpenRemoteProject?: () => void;
}

type LeftView = "default" | "browse" | "quickcreate";
type MobileTab = "recents" | "favorites" | "browse" | "quickcreate";
type QcMobileStep = "input" | "confirm";

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

function compactMiddle(value: string, max = 64): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) * 0.58);
  const tail = Math.floor((max - 1) * 0.42);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function getRecentProjectDisplay(project: RecentProject) {
  if (project.runtime === "ssh" && project.remote) {
    const isSandbox = project.remote.sshRuntimeKind === "ssh-command";
    return {
      isRemote: true,
      isSandbox,
      title: project.name || pathBasename(project.remote.remotePath) || project.remote.host,
      primary: project.remote.host,
      secondary: project.remote.remotePath,
      searchable: `${project.name} ${project.remote.host} ${project.remote.remotePath}`,
    };
  }
  return {
    isRemote: false,
    isSandbox: false,
    title: project.name || pathBasename(project.path),
    primary: project.path,
    secondary: "",
    searchable: `${project.name} ${project.path}`,
  };
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

export function ProjectPickerDialog({
  open,
  onClose,
  onSelect,
  onOpenRemoteProject,
}: ProjectPickerDialogProps) {
  const { t } = useTranslation("sidebar");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileTab, setMobileTab] = useState<MobileTab>("recents");

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
  // null = 正常选项目模式；"defaultDir" = 浏览器用来选默认项目目录
  const [browseMode, setBrowseMode] = useState<"defaultDir" | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryEntry[]>([]);
  const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolder[]>([]);
  const [browserSearchQuery, setBrowserSearchQuery] = useState("");
  const [browsingLoading, setBrowsingLoading] = useState(false);
  const [browserSortBy, setBrowserSortBy] = useState<"mtime" | "name">("mtime");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);

  // 快速创建项目相关状态
  const initialQcTier = useInitialQcTier();

  const [qcRequirement, setQcRequirement] = useState("");
  const [qcTier, setQcTier] = useState<QcTier>(initialQcTier);
  const [qcGenerating, setQcGenerating] = useState(false);
  const [qcGenError, setQcGenError] = useState<string | null>(null);
  const [qcName, setQcName] = useState("");
  const [qcDescription, setQcDescription] = useState("");
  const [qcPlan, setQcPlan] = useState<{
    goal: string;
    techStack: string[];
    steps: string[];
    testing: string;
  } | null>(null);
  const [qcDefaultDir, setQcDefaultDir] = useState<string | null>(null);
  const [qcDefaultDirLoaded, setQcDefaultDirLoaded] = useState(false);
  const [qcCreating, setQcCreating] = useState(false);
  const [qcCreateError, setQcCreateError] = useState<string | null>(null);
  const [qcMobileStep, setQcMobileStep] = useState<QcMobileStep>("input");

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
      // 重置快速创建状态
      setQcRequirement("");
      setQcTier(initialQcTier);
      setQcGenerating(false);
      setQcGenError(null);
      setQcName("");
      setQcDescription("");
      setQcPlan(null);
      setQcCreating(false);
      setQcCreateError(null);
      setQcMobileStep("input");
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
    const wasPickingDefaultDir = browseMode === "defaultDir";
    setBrowseMode(null);
    setLeftView(wasPickingDefaultDir ? "quickcreate" : "default");
    setCurrentPath("");
    setDirectoryEntries([]);
    setBrowserSearchQuery("");
  }, [browseMode]);

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
    // 选默认项目目录模式：保存到配置，不进入项目
    if (browseMode === "defaultDir") {
      apiClient
        .call("project.setDefaultProjectDir", { dir: currentPath })
        .then(() => {
          setQcDefaultDir(currentPath);
          setQcCreateError(null);
        })
        .catch((err) => {
          logger.warn("setDefaultProjectDir failed", { error: String(err) });
          setQcCreateError(t("picker.qc.defaultDirSaveFailed", "保存默认目录失败"));
        })
        .finally(() => {
          setBrowseMode(null);
          setLeftView("quickcreate");
        });
      return;
    }
    // 正常模式：选当前目录作为项目打开
    const name = pathBasename(currentPath);
    onSelect(currentPath, name);
    onClose();
  }, [currentPath, browseMode, onSelect, onClose, t]);

  const [handleCreateFolder, isCreatingFolder] = useAsyncGuard(
    useCallback(async () => {
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
    }, [newFolderName, currentPath, navigateTo]),
  );

  const handleSelectFolder = useCallback(
    (path: string) => {
      onSelect(path, pathBasename(path));
      onClose();
    },
    [onSelect, onClose],
  );

  // -------- 快速创建项目 --------

  const ensureQcDefaultDirLoaded = useCallback(async () => {
    if (qcDefaultDirLoaded) return;
    try {
      const result = await apiClient.call("project.getDefaultProjectDir", {});
      const dir = (result.dir as string | null) ?? null;
      setQcDefaultDir(dir);
    } catch (err) {
      logger.warn("getDefaultProjectDir failed", { error: String(err) });
      setQcDefaultDir(null);
    } finally {
      setQcDefaultDirLoaded(true);
    }
  }, [qcDefaultDirLoaded]);

  const [handleQcPickDefaultDir, isPickingDefaultDir] = useAsyncGuard(
    useCallback(async () => {
      // 先试原生 openFolder（桌面端）
      try {
        const picked = await apiClient.call("project.browseFolder", {
          defaultPath: qcDefaultDir ?? undefined,
        });
        if (!("cancelled" in picked)) {
          const dir = (picked.path as string) || null;
          if (dir) {
            await apiClient.call("project.setDefaultProjectDir", { dir });
            setQcDefaultDir(dir);
            setQcCreateError(null);
            return;
          }
        }
      } catch (err) {
        logger.warn("browseFolder RPC failed", { error: String(err) });
      }

      // Web 模式 fallback：进入应用内目录浏览器让用户点选
      // 复用 renderLeftBrowse，切到 browse 视图 + 标记 defaultDir 模式
      setBrowseMode("defaultDir");
      navigateTo(qcDefaultDir ?? homePathRef.current ?? "/");
      setLeftView("browse");
    }, [qcDefaultDir, navigateTo]),
  );

  const [handleQcGenerate, isGenerating] = useAsyncGuard(
    useCallback(async () => {
      const requirement = qcRequirement.trim();
      if (!requirement) return;
      setQcGenerating(true);
      setQcGenError(null);
      try {
        const result = await apiClient.call("project.generateName", {
          requirement,
          tier: qcTier,
        });
        const name = (result.name as string) ?? "";
        const description = (result.description as string) ?? "";
        const plan = result.plan as {
          goal: string;
          techStack: string[];
          steps: string[];
          testing: string;
        } | undefined;
        if (!name) {
          setQcGenError(t("picker.qc.generateFailed"));
          return;
        }
        setQcName(name);
        setQcDescription(description);
        setQcPlan(plan ?? null);
        setQcMobileStep("confirm");
      } catch (err) {
        logger.warn("generateName failed", { error: String(err) });
        setQcGenError(
          err instanceof Error ? err.message : t("picker.qc.generateFailed"),
        );
      } finally {
        setQcGenerating(false);
      }
    }, [qcRequirement, qcTier, t]),
  );

  const [handleQcConfirm, isConfirming] = useAsyncGuard(
    useCallback(async () => {
      const parentDir = qcDefaultDir;
      const folderName = qcName.trim();
      if (!parentDir) {
        setQcCreateError(t("picker.qc.noDefaultDir"));
        return;
      }
      if (!folderName) {
        setQcCreateError(t("picker.qc.invalidName"));
        return;
      }
      setQcCreating(true);
      setQcCreateError(null);
      try {
        const result = await apiClient.call("project.confirmQuickCreate", {
          parentDir,
          folderName,
          ...(qcPlan ? { plan: qcPlan } : {}),
          ...(qcDescription ? { description: qcDescription } : {}),
        });
        if (!result.ok) {
          setQcCreateError((result.error as string) ?? t("picker.qc.createFailed"));
          return;
        }
        const pushNotif = useNotificationStore.getState().push;
        for (const warning of (result.warnings as string[] | undefined) ?? []) {
          pushNotif({ message: warning, level: "warning" });
        }
        const projectPath = result.path as string;
        await onSelect(projectPath, folderName, {
          quickStart: {
            requirement: qcRequirement.trim(),
            description: qcDescription,
            plan: qcPlan,
          },
        });
        onClose();
      } catch (err) {
        logger.warn("confirmQuickCreate failed", { error: String(err) });
        setQcCreateError(
          err instanceof Error ? err.message : t("picker.qc.createFailed"),
        );
      } finally {
        setQcCreating(false);
      }
    }, [qcDefaultDir, qcDescription, qcName, qcPlan, qcRequirement, onSelect, onClose, t]),
  );

  // 触发加载默认目录的 effect
  useEffect(() => {
    if (!open) return;
    if (mobileTab === "quickcreate" || leftView === "quickcreate") {
      ensureQcDefaultDirLoaded();
    }
  }, [open, mobileTab, leftView, ensureQcDefaultDirLoaded]);

  // 主页也要加载默认目录，因为主页现在显示目录状态条
  useEffect(() => {
    if (!open) return;
    ensureQcDefaultDirLoaded();
  }, [open, ensureQcDefaultDirLoaded]);

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

  const filtered = recents.filter((project) =>
    getRecentProjectDisplay(project).searchable.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const sortedRecents = [...filtered].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.lastOpened - a.lastOpened;
  });

  const isFav = (path: string) => favoriteFolders.some((f) => f.path === path);

  if (!open) return null;

  const handleOpenRemote = () => {
    onClose();
    onOpenRemoteProject?.();
  };

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

    return projects.map((proj) => {
      const display = getRecentProjectDisplay(proj);
      const Icon = display.isRemote ? (display.isSandbox ? PlugZap : Server) : Folder;
      const iconColorClass = display.isRemote
        ? display.isSandbox
          ? "border-runtime-sandbox/30 bg-runtime-sandbox/10 text-runtime-sandbox"
          : "border-runtime-ssh/25 bg-runtime-ssh/10 text-runtime-ssh"
        : "border-border-secondary bg-bg-elevated text-runtime-local";
      return (
        <div
          key={proj.path}
          role="button"
          tabIndex={0}
          onClick={() => handleSelectRecent(proj)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSelectRecent(proj);
          }}
          className={`group w-full cursor-pointer rounded-lg border text-left transition-colors ${
            display.isRemote
              ? "border-transparent hover:border-border-secondary hover:bg-surface-hover dark:hover:bg-surface-dim/60"
              : "border-transparent hover:border-border-secondary hover:bg-surface-hover dark:hover:bg-surface-dim/60"
          } focus-visible:border-border-focus focus-visible:bg-surface-hover focus-visible:outline-none ${
            mobile ? "px-4 py-3.5 active:bg-surface-hover" : "px-3 py-2.5"
          }`}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`mt-0.5 flex shrink-0 items-center justify-center rounded-md border ${
                mobile ? "h-9 w-9" : "h-8 w-8"
              } ${iconColorClass}`}
            >
              <Icon className={mobile ? "h-5 w-5" : "h-4 w-4"} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className={
                    mobile
                      ? "truncate text-sm font-semibold text-text-primary"
                      : "truncate text-[13px] font-semibold text-text-primary"
                  }
                >
                  {display.title}
                </div>
                {display.isRemote && (
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                      display.isSandbox
                        ? "border-runtime-sandbox/25 bg-runtime-sandbox/10 text-runtime-sandbox"
                        : "border-runtime-ssh/25 bg-runtime-ssh/10 text-runtime-ssh"
                    }`}
                  >
                    {display.isSandbox ? "Sandbox" : t("picker.remoteBadge")}
                  </span>
                )}
              </div>
              <div
                className={
                  mobile
                    ? "mt-1 truncate text-[12px] text-text-secondary"
                    : "mt-1 truncate text-[11px] text-text-secondary"
                }
              >
                {display.isRemote ? display.primary : compactMiddle(display.primary)}
              </div>
              {display.isRemote && (
                <div
                  className={
                    mobile
                      ? "mt-0.5 truncate font-mono text-[11px] text-text-tertiary"
                      : "mt-0.5 truncate font-mono text-[10px] text-text-tertiary"
                  }
                >
                  {compactMiddle(display.secondary, mobile ? 72 : 54)}
                </div>
              )}
              {proj.sessionCount > 0 && (
                <div className="mt-1 text-[10px] text-text-secondary">
                  {t("picker.sessionCount", { count: proj.sessionCount })}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-[10px] text-text-secondary">{timeAgo(proj.lastOpened)}</span>
              <button
                onClick={(e) => handleTogglePin(e, proj.path)}
                className={`rounded p-1 transition-all hover:bg-surface-hover dark:hover:bg-surface-hover/50 ${
                  proj.pinned
                    ? "text-status-warning opacity-100"
                    : "text-text-secondary opacity-0 hover:text-status-warning group-hover:opacity-100"
                }`}
                aria-label={proj.pinned ? t("unpin") : t("pin")}
              >
                <Pin className="h-3 w-3" fill={proj.pinned ? "currentColor" : "none"} />
              </button>
              <button
                onClick={(e) => handleRemoveRecent(e, proj.path)}
                className="rounded p-1 text-text-secondary opacity-0 transition-all hover:bg-status-error/20 hover:text-status-error group-hover:opacity-100"
                aria-label={t("picker.removeRecent")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      );
    });
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
                    ? "text-accent font-medium bg-accent/10"
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
          className="p-1 rounded hover:bg-accent/20 text-text-secondary hover:text-accent opacity-0 group-hover:opacity-100 transition-all shrink-0"
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
        <div className="space-y-2">
          <button
            onClick={() => setLeftView("quickcreate")}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg text-xs text-white font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t("picker.qc.entry")}
          </button>
          <button
            onClick={() => navigateTo(homePathRef.current || "/")}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent/10 hover:bg-accent/15 border border-accent/30 rounded-lg text-xs text-accent transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            {t("picker.browseOtherDirs")}
          </button>
          {onOpenRemoteProject && (
            <button
              onClick={handleOpenRemote}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-runtime-ssh/10 hover:bg-runtime-ssh/15 border border-runtime-ssh/30 rounded-lg text-xs text-runtime-ssh transition-colors"
            >
              <Server className="w-3.5 h-3.5" />
              {t("picker.openRemoteProject")}
            </button>
          )}
        </div>
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
              className="w-full pl-7 pr-3 py-1.5 bg-surface-code dark:bg-surface-dim/50 border border-border-secondary dark:border-border-secondary/50 rounded-md text-[11px] text-text-secondary placeholder:text-text-secondary outline-none focus:border-accent/50"
            />
          </div>
          <button
            onClick={() => setBrowserSortBy((prev) => (prev === "mtime" ? "name" : "mtime"))}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-md border text-[10px] transition-colors shrink-0 ${
              browserSortBy === "mtime"
                ? "border-accent/40 bg-accent/10 text-accent"
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
      <div className="shrink-0 px-3 py-2 border-t border-border-secondary dark:border-surface-code space-y-2">
        {showCreateFolder && (
          <div className="flex items-center gap-1.5">
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
              className="flex-1 px-2.5 py-1.5 bg-surface-code dark:bg-surface-dim/50 border border-border-secondary dark:border-border-secondary/50 rounded-md text-[11px] text-text-secondary placeholder:text-text-secondary outline-none focus:border-accent/50"
            />
            <button
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || creating || isCreatingFolder}
              className="p-1.5 rounded-md bg-accent hover:bg-accent-hover text-white disabled:opacity-40 shrink-0"
            >
              {creating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
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
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors shrink-0 ${
              showCreateFolder
                ? "bg-surface-hover dark:bg-surface-dim text-text-secondary"
                : "bg-surface-code dark:bg-surface-dim/60 text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover"
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            {t("picker.createFolder")}
          </button>
          <button
            onClick={handleSelectCurrentFolder}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-[11px] font-medium text-white transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {browseMode === "defaultDir"
              ? t("picker.qc.setAsDefaultDir", "设为默认目录")
              : t("picker.selectCurrentFolder")}
          </button>
        </div>
      </div>
    </>
  );

  // -------- 快速创建：左侧输入面板（也用于移动端 input 步） --------

  const renderQuickCreateInput = (mobile: boolean) => (
    <div className="flex flex-col h-full">
      <div className={`${mobile ? "px-4 py-3" : "px-4 py-3"} border-b border-border-secondary dark:border-surface-code shrink-0`}>
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <p className="text-xs font-medium text-text-secondary">{t("picker.qc.inputTitle")}</p>
        </div>
        <p className="text-[10px] text-text-tertiary mt-0.5">{t("picker.qc.inputHint")}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <textarea
          value={qcRequirement}
          onChange={(e) => setQcRequirement(e.target.value)}
          placeholder={t("picker.qc.requirementPlaceholder")}
          rows={mobile ? 5 : 7}
          className="w-full px-3 py-2 bg-surface-code dark:bg-surface-dim/50 border border-border-secondary dark:border-border-secondary/50 rounded-md text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50 resize-none"
        />

        <div>
          <p className="text-[10px] text-text-tertiary mb-1.5">{t("picker.qc.tierLabel")}</p>
          <div className="flex gap-1.5">
            {(["fast", "pro", "max"] as QcTier[]).map((tier) => (
              <button
                key={tier}
                onClick={() => setQcTier(tier)}
                className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                  qcTier === tier
                    ? "bg-accent/15 text-accent border border-accent/40"
                    : "bg-surface-code dark:bg-surface-dim/60 text-text-tertiary border border-border-secondary dark:border-border-secondary/50 hover:text-text-secondary"
                }`}
              >
                {t(`picker.qc.tier.${tier}`)}
              </button>
            ))}
          </div>
        </div>

        {qcGenError && (
          <div className="px-3 py-2 rounded-md bg-status-error/10 border border-status-error/30 text-[11px] text-status-error">
            {qcGenError}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 py-2.5 border-t border-border-secondary dark:border-surface-code">
        <button
          onClick={handleQcGenerate}
          disabled={!qcRequirement.trim() || qcGenerating || isGenerating}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs text-white font-medium transition-colors"
        >
          {qcGenerating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("picker.qc.generating")}
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              {t("picker.qc.generate")}
            </>
          )}
        </button>
      </div>
    </div>
  );

  // -------- 快速创建：右侧确认面板（也用于移动端 confirm 步） --------

  const renderQuickCreateConfirm = (mobile: boolean) => (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border-secondary dark:border-surface-code shrink-0">
        <div className="flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 text-status-success" />
          <p className="text-xs font-medium text-text-secondary">{t("picker.qc.confirmTitle")}</p>
        </div>
        <p className="text-[10px] text-text-tertiary mt-0.5">{t("picker.qc.confirmHint")}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] text-text-tertiary">{t("picker.qc.nameLabel")}</p>
            <button
              onClick={handleQcGenerate}
              disabled={qcGenerating || !qcRequirement.trim() || isGenerating}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-accent hover:bg-accent/10 disabled:opacity-40 transition-colors"
              title={t("picker.qc.regenerate")}
            >
              {qcGenerating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              {t("picker.qc.regenerate")}
            </button>
          </div>
          <input
            value={qcName}
            onChange={(e) => setQcName(e.target.value)}
            placeholder={t("picker.qc.namePlaceholder")}
            className="w-full px-3 py-2 bg-surface-code dark:bg-surface-dim/50 border border-border-secondary dark:border-border-secondary/50 rounded-md text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50"
          />
          {qcDescription && (
            <p className="mt-1.5 text-[11px] text-text-secondary leading-relaxed">
              {qcDescription}
            </p>
          )}
        </div>

        {qcPlan && (
          <div className="rounded-md border border-border-secondary dark:border-border-secondary/50 bg-surface-code/40 dark:bg-surface-dim/30 p-3 space-y-2.5">
            {qcPlan.goal && (
              <div>
                <p className="text-[10px] font-medium text-text-tertiary mb-0.5">{t("picker.qc.planGoalLabel")}</p>
                <p className="text-[11px] text-text-primary leading-relaxed">{qcPlan.goal}</p>
              </div>
            )}
            {qcPlan.techStack.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-text-tertiary mb-1">{t("picker.qc.planStackLabel")}</p>
                <div className="flex flex-wrap gap-1">
                  {qcPlan.techStack.map((tech, i) => (
                    <span
                      key={`tech-${i}-${tech}`}
                      className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {qcPlan.steps.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-text-tertiary mb-1">{t("picker.qc.planStepsLabel")}</p>
                <ol className="space-y-1">
                  {qcPlan.steps.map((step, i) => (
                    <li key={`step-${i}-${step.slice(0, 8)}`} className="flex gap-1.5 text-[11px] text-text-secondary leading-relaxed">
                      <span className="text-accent font-medium shrink-0">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {qcPlan.testing && (
              <div>
                <p className="text-[10px] font-medium text-text-tertiary mb-0.5">{t("picker.qc.planTestingLabel")}</p>
                <p className="text-[11px] text-text-secondary leading-relaxed">{qcPlan.testing}</p>
              </div>
            )}
          </div>
        )}

        <div className="rounded-md border border-status-success/25 bg-status-success/5 dark:bg-status-success/10 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-status-success shrink-0" />
            <p className="text-[10px] font-medium text-text-secondary">
              {t("picker.qc.deliveryTitle", "交付门槛")}
            </p>
          </div>
          <ul className="space-y-1 text-[11px] text-text-secondary leading-relaxed">
            <li>
              {t(
                "picker.qc.deliverySafeInstall",
                "安装失败先重试/查日志，不默认递归删除 node_modules、lockfile 或项目文件。",
              )}
            </li>
            <li>
              {t(
                "picker.qc.deliveryValidation",
                "完成前必须提供 validation packet：自动测试、构建、浏览器验收、边界场景和未测风险。",
              )}
            </li>
            <li>
              {t(
                "picker.qc.deliveryPreviewPort",
                "后续启动的本地端口只是临时预览地址，不代表主应用功能或产品端口。",
              )}
            </li>
          </ul>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] text-text-tertiary">{t("picker.qc.defaultDirLabel")}</p>
            <button
              onClick={handleQcPickDefaultDir}
              disabled={isPickingDefaultDir}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-accent hover:bg-accent/10 transition-colors"
            >
              <FolderOpen className="w-3 h-3" />
              {t("picker.qc.changeDir")}
            </button>
          </div>
          {qcDefaultDir ? (
            <div className="px-3 py-2 rounded-md bg-surface-code dark:bg-surface-dim/50 border border-border-secondary dark:border-border-secondary/50 text-[11px] text-text-secondary break-all">
              {qcDefaultDir}
            </div>
          ) : (
            <button
              onClick={handleQcPickDefaultDir}
              disabled={isPickingDefaultDir}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-status-warning/10 border border-status-warning/40 text-[11px] text-status-warning hover:bg-status-warning/20 transition-colors text-left"
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span>{t("picker.qc.noDefaultDirSet")}</span>
            </button>
          )}
        </div>

        {qcDefaultDir && (
          <div className="px-3 py-2 rounded-md bg-accent/5 dark:bg-accent/10 border border-accent/20 text-[10px] text-text-tertiary break-all">
            <span className="text-text-tertiary">{t("picker.qc.previewPathLabel", "将创建于")}：</span>
            <span className="text-text-secondary font-medium">
              {qcDefaultDir}/{qcName || "project-name"}
            </span>
          </div>
        )}

        {qcCreateError && (
          <div className="px-3 py-2 rounded-md bg-status-error/10 border border-status-error/30 text-[11px] text-status-error">
            {qcCreateError}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 py-2.5 border-t border-border-secondary dark:border-surface-code space-y-2">
        {mobile && (
          <button
            onClick={() => setQcMobileStep("input")}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-surface-code dark:bg-surface-dim/60 text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover rounded-lg text-xs font-medium transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("picker.qc.backToInput")}
          </button>
        )}
        <button
          onClick={handleQcConfirm}
          disabled={!qcName.trim() || !qcDefaultDir || qcCreating || isConfirming}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs text-white font-medium transition-colors"
        >
          {qcCreating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("picker.qc.creating")}
            </>
          ) : (
            <>
              <FolderPlus className="w-3.5 h-3.5" />
              {t("picker.qc.confirmAndOpen")}
            </>
          )}
        </button>
      </div>
    </div>
  );

  const renderLeftPanel = () => (
    <div className="w-[45%] min-w-[260px] border-r border-border-secondary dark:border-surface-code flex flex-col">
      {leftView === "browse"
        ? renderLeftBrowse()
        : leftView === "quickcreate"
          ? renderQuickCreateInput(false)
          : renderLeftDefault()}
    </div>
  );

  return (
    <>
      {/* Mobile view */}
      <div
        ref={mobileDialogRef}
        className="md:hidden fixed inset-0 z-fullscreen bg-bg-elevated dark:bg-surface-code flex flex-col overflow-hidden animate-slide-in-up"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        role="dialog"
        aria-modal="true"
        aria-label={t("picker.title")}
      >
        <div
          className="surface-header-safe-top flex items-center justify-between px-4 py-3 border-b border-border-secondary shrink-0"
        >
          <h2 className="text-sm font-semibold text-text-primary">{t("picker.title")}</h2>
          <IconButton label={t("picker.close")} size="md" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconButton>
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
          <button
            onClick={() => {
              setMobileTab("quickcreate");
              setQcMobileStep("input");
            }}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors ${
              mobileTab === "quickcreate"
                ? "bg-bg-elevated dark:bg-surface-hover text-text-primary shadow-sm"
                : "text-text-tertiary"
            }`}
          >
            {t("picker.qc.tab")}
          </button>
        </div>
        {onOpenRemoteProject && (
          <button
            onClick={handleOpenRemote}
            className="mx-3 mt-2 flex items-center justify-center gap-2 rounded-xl border border-runtime-ssh/30 bg-runtime-ssh/10 px-4 py-2.5 text-sm font-medium text-runtime-ssh active:bg-runtime-ssh/15"
          >
            <Server className="w-4 h-4" />
            {t("picker.openRemoteProject")}
          </button>
        )}

        <div className="flex-1 overflow-y-auto px-3 pb-4 pt-2 flex flex-col min-h-0">
          {mobileTab === "recents" && (
            <div className="flex-1 flex flex-col">
              <div className="relative py-2 shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("picker.searchProject")}
                  className="w-full pl-9 pr-4 py-2.5 bg-surface-code dark:bg-surface-dim/60 border border-border-secondary dark:border-border-secondary/50 rounded-xl text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50"
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
                      className="w-full pl-7 pr-3 py-2 bg-surface-code dark:bg-surface-dim/60 border border-border-secondary dark:border-border-secondary/50 rounded-xl text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50"
                    />
                  </div>
                  <button
                    onClick={() =>
                      setBrowserSortBy((prev) => (prev === "mtime" ? "name" : "mtime"))
                    }
                    className={`flex items-center gap-1 px-2.5 py-2 rounded-xl border text-xs transition-colors shrink-0 ${
                      browserSortBy === "mtime"
                        ? "border-accent/40 bg-accent/10 text-accent"
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
                              className="p-2 rounded-lg active:bg-surface-hover dark:active:bg-surface-hover/50 text-text-tertiary active:text-accent shrink-0"
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
                      className="flex-1 px-3 py-2 bg-surface-code dark:bg-surface-dim/60 border border-border-secondary dark:border-border-secondary/50 rounded-xl text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50"
                    />
                    <button
                      onClick={handleCreateFolder}
                      disabled={!newFolderName.trim() || creating || isCreatingFolder}
                      className="p-2 rounded-xl bg-accent active:bg-accent-hover text-white disabled:opacity-40 shrink-0"
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
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-accent active:bg-accent-hover rounded-xl text-sm font-medium text-white transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                    {t("picker.selectCurrentFolder")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {mobileTab === "quickcreate" && (
            <div className="flex-1 flex flex-col min-h-0 -mx-3 -mt-2 -mb-4">
              {qcMobileStep === "input"
                ? renderQuickCreateInput(true)
                : renderQuickCreateConfirm(true)}
            </div>
          )}
        </div>
      </div>

      {/* Desktop view */}
      <div className="hidden md:flex fixed inset-0 z-modal items-center justify-center">
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
            <IconButton label={t("picker.close")} size="md" onClick={onClose}>
              <X className="w-4 h-4" />
            </IconButton>
          </div>

          <div className="flex-1 flex overflow-hidden min-h-0">
            {renderLeftPanel()}

            {/* Right — Recent & Pinned / 快速创建确认面板 */}
            {leftView === "quickcreate" ? (
              <div className="flex-1 flex flex-col min-w-0">
                {renderQuickCreateConfirm(false)}
              </div>
            ) : (
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
                      className="pl-7 pr-3 py-1 w-36 bg-surface-code dark:bg-surface-dim/50 border border-border-secondary dark:border-border-secondary/50 rounded-md text-[11px] text-text-secondary placeholder:text-text-tertiary dark:placeholder:text-text-secondary outline-none focus:border-accent/50"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
                  {renderProjectList(sortedRecents)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

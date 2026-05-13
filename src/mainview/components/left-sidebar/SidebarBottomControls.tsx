import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  ChevronDown,
  Check,
  Cpu,
  Brain,
  Star,
  Search,
  FolderTree,
  GitBranch,
  Plus,
  Zap,
  Target,
  Settings2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/use-session-store";
import { useGitStore } from "../../stores/use-git-store";
import { useTierStore, TIER_KEYS } from "../../stores/use-tier-store";
import type { TierKey } from "../../stores/use-tier-store";
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";
import { ThemeMenu } from "../theme/ThemeMenu";

const log = createLogger("chat");

interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
}

const THINKING_LEVEL_KEYS = [
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXHigh",
] as const;

type ThinkingLevel = (typeof THINKING_LEVEL_VALUES)[number];

function modelKey(m: ModelInfo): string {
  return `${m.provider}/${m.id}`;
}

function formatModelName(modelId: string): string {
  return modelId
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/(\d+)/g, " $1")
    .trim();
}

const THINKING_LEVEL_VALUES = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export function SidebarBottomControls() {
  const { t } = useTranslation("status");
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const currentModel = useSessionStore((s) => s.currentModel);
  const currentThinkingLevel = useSessionStore((s) => s.currentThinkingLevel);
  const availableModels = useSessionStore((s) => s.availableModels);
  const setCurrentModel = useSessionStore((s) => s.setCurrentModel);
  const setThinkingLevel = useSessionStore((s) => s.setThinkingLevel);
  const fetchModelState = useSessionStore((s) => s.fetchModelState);

  const [modelOpen, setModelOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const modelRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    apiClient
      .call("project.getModelFavorites", {})
      .then((res) => setFavorites(new Set(res.favorites)))
      .catch(() => setFavorites(new Set()));
  }, []);

  const currentTier = useTierStore((s) => s.currentTier);
  const switchToTier = useTierStore((s) => s.switchToTier);
  const fetchTierConfig = useTierStore((s) => s.fetchTierConfig);
  const tierModels = useTierStore((s) => s.tierModels);
  const [switchingTier, setSwitchingTier] = useState(false);
  const [tierConfigOpen, setTierConfigOpen] = useState(false);
  const [tierConfigModels, setTierConfigModels] = useState<Record<string, string>>({});
  const [tierConfigSaving, setTierConfigSaving] = useState(false);
  const tierConfigRef = useRef<HTMLDivElement>(null);

  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const addProjectTab = useSessionStore((s) => s.addProjectTab);

  const worktrees = useGitStore((s) => s.worktrees);
  const isGitRepo = useGitStore((s) => s.isGitRepo);
  const fetchWorktrees = useGitStore((s) => s.fetchWorktrees);
  const addWorktreeAction = useGitStore((s) => s.addWorktree);

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const sessionFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    if (sessionFetchedRef.current === activeSessionId) return;
    sessionFetchedRef.current = activeSessionId;
    fetchModelState(activeSessionId);
    fetchTierConfig(activeSessionId);
  }, [activeSessionId, fetchModelState, fetchTierConfig]);

  const currentTab = projectTabs.find((t) => t.id === activeProjectId);
  const activeTabPath = currentTab?.path ?? "";

  const currentSession = useMemo(() => {
    if (!activeSessionId) return null;
    for (const sessions of Object.values(sessionsByProject)) {
      const found = sessions.find((s) => s.sessionId === activeSessionId);
      if (found) return found;
    }
    return null;
  }, [activeSessionId, sessionsByProject]);

  const currentWorkspace = useMemo(() => {
    if (!currentSession) return worktrees[0] ?? null;
    return (
      worktrees.find((wt) => currentSession.projectPath === wt.path) ??
      [...worktrees]
        .sort((a, b) => b.path.length - a.path.length)
        .find((wt) => currentSession.projectPath.startsWith(wt.path)) ??
      worktrees[0] ??
      null
    );
  }, [currentSession, worktrees]);

  const workspaceName = currentWorkspace
    ? currentWorkspace.isMain
      ? t("mainWorkspace")
      : currentWorkspace.branch
    : t("notLoaded");
  const workspacePath = currentWorkspace?.path ?? "";

  useEffect(() => {
    if (activeTabPath && isGitRepo) {
      fetchWorktrees(activeTabPath);
    }
  }, [activeTabPath, fetchWorktrees, isGitRepo]);

  useEffect(() => {
    if (!modelOpen && !thinkingOpen && !workspaceOpen && !tierConfigOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
      if (thinkingRef.current && !thinkingRef.current.contains(e.target as Node))
        setThinkingOpen(false);
      if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node))
        setWorkspaceOpen(false);
      if (tierConfigRef.current && !tierConfigRef.current.contains(e.target as Node))
        setTierConfigOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModelOpen(false);
        setThinkingOpen(false);
        setWorkspaceOpen(false);
        setTierConfigOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [modelOpen, thinkingOpen, workspaceOpen, tierConfigOpen]);

  useEffect(() => {
    if (modelOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery("");
      setShowFavoritesOnly(false);
    }
  }, [modelOpen]);

  const toggleFavorite = useCallback((key: string) => {
    apiClient
      .call("project.toggleModelFavorite", { modelKey: key })
      .then((res) => setFavorites(new Set(res.favorites)))
      .catch(() => {});
  }, []);

  const handleSwitchWorkspace = useCallback((wt: { path: string }) => {
    const state = useSessionStore.getState();
    if (state.activeSessionId) {
      state.updateSessionProjectPath(state.activeSessionId, wt.path);
    }
    setWorkspaceOpen(false);
  }, []);

  const handleCreateWorktree = useCallback(async () => {
    if (!newBranch.trim() || !activeTabPath || creating) return;
    setCreating(true);
    try {
      const wt = await addWorktreeAction(
        activeTabPath,
        newBranch.trim(),
        sourceBranch || undefined,
      );
      setShowCreateDialog(false);
      setNewBranch("");
      setSourceBranch("");
      setWorkspaceOpen(false);
      await useSessionStore.getState().createNewSession(wt.path);
    } catch (err) {
      console.warn("[SidebarControls] worktree add failed:", err);
    }
    setCreating(false);
  }, [newBranch, activeTabPath, sourceBranch, creating, addWorktreeAction, addProjectTab]);

  const handleSwitchTier = useCallback(
    async (tier: TierKey) => {
      if (!activeSessionId || switchingTier) return;
      setSwitchingTier(true);
      await switchToTier(tier, activeSessionId);
      setSwitchingTier(false);
    },
    [activeSessionId, switchingTier, switchToTier],
  );

  const handleOpenTierConfig = useCallback(async () => {
    if (!activeSessionId) return;
    setTierConfigModels({ ...tierModels });
    setTierConfigOpen(true);
  }, [activeSessionId, tierModels]);

  const handleSaveTierConfig = useCallback(async () => {
    if (!activeSessionId) return;
    setTierConfigSaving(true);
    try {
      await apiClient.call("agent.setTierModels", {
        sessionId: activeSessionId,
        models: tierConfigModels,
      });
      setTierConfigOpen(false);
      await fetchTierConfig(activeSessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("save tier config failed", { error: msg });
    }
    setTierConfigSaving(false);
  }, [activeSessionId, tierConfigModels, fetchTierConfig]);

  const handleSelectModel = useCallback(
    async (model: ModelInfo) => {
      if (!activeSessionId || switching) return;
      if (currentModel?.id === model.id && currentModel?.provider === model.provider) {
        setModelOpen(false);
        return;
      }
      setSwitching(true);
      try {
        await apiClient.call("agent.setModel", {
          sessionId: activeSessionId,
          provider: model.provider,
          modelId: model.id,
        });
        setCurrentModel(model.provider, model.id);
        useTierStore.getState().syncTierFromModel(model.provider, model.id);
      } catch (err) {
        console.warn("[SidebarControls] setModel failed:", err);
      }
      setSwitching(false);
      setModelOpen(false);
    },
    [activeSessionId, switching, currentModel, setCurrentModel],
  );

  const handleSelectThinking = useCallback(
    async (level: ThinkingLevel) => {
      if (!activeSessionId || switching || currentThinkingLevel === level) {
        setThinkingOpen(false);
        return;
      }
      setSwitching(true);
      try {
        await apiClient.call("agent.setThinkingLevel", {
          sessionId: activeSessionId,
          level,
        });
        setThinkingLevel(level);
      } catch (err) {
        console.warn("[SidebarControls] setThinkingLevel failed:", err);
      }
      setSwitching(false);
      setThinkingOpen(false);
    },
    [activeSessionId, switching, currentThinkingLevel, setThinkingLevel],
  );

  let displayModels = availableModels;
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    displayModels = displayModels.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.name?.toLowerCase().includes(q) ?? false) ||
        formatModelName(m.id).toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }
  if (showFavoritesOnly) {
    displayModels = displayModels.filter((m) => favorites.has(modelKey(m)));
  }

  const modelDisplay = currentModel
    ? `${currentModel.provider}/${currentModel.name ?? formatModelName(currentModel.id)}`
    : t("notLoaded");
  const thinkingDisplay = currentThinkingLevel
    ? (() => {
        const idx = THINKING_LEVEL_VALUES.indexOf(
          currentThinkingLevel as (typeof THINKING_LEVEL_VALUES)[number],
        );
        return idx >= 0 ? t(THINKING_LEVEL_KEYS[idx]) : currentThinkingLevel;
      })()
    : t("default");

  return (
    <div className="shrink-0 border-t border-gray-200/80 dark:border-gray-800/80 px-3 py-2 space-y-1.5">
      <div className="relative" ref={workspaceRef}>
        {!isGitRepo ? (
          <div className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-400 dark:text-gray-600">
            <FolderTree className="w-3 h-3 shrink-0" />
            <div className="flex flex-col min-w-0 flex-1 text-left">
              <span className="truncate">{t("notGitRepo")}</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-600 truncate">
                {activeTabPath.split("/").pop()}
              </span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              setWorkspaceOpen(!workspaceOpen);
              setModelOpen(false);
              setThinkingOpen(false);
            }}
            disabled={!activeSessionId}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-800/60 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-40"
            aria-expanded={workspaceOpen}
            aria-label={t("workspaceSelect")}
          >
            <FolderTree className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />
            <div className="flex flex-col min-w-0 flex-1 text-left">
              <span className="truncate">{workspaceName}</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-600 truncate">
                {workspacePath}
              </span>
            </div>
            <ChevronDown
              className={`w-3 h-3 shrink-0 transition-transform ${workspaceOpen ? "rotate-180" : ""}`}
            />
          </button>
        )}
        {isGitRepo && workspaceOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-64 overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-xl flex flex-col">
            <div className="overflow-y-auto flex-1 py-1">
              {worktrees.map((wt) => {
                const isActive = currentWorkspace?.path === wt.path;
                const name = wt.isMain ? t("mainWorkspace") : wt.branch;
                return (
                  <button
                    key={wt.path}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                      isActive
                        ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                        : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                    onClick={() => handleSwitchWorkspace(wt)}
                  >
                    {isActive ? (
                      <Check className="w-3 h-3 shrink-0 text-indigo-400" />
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{name}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {wt.path}
                      </span>
                    </div>
                    {!wt.isMain && <GitBranch className="w-3 h-3 shrink-0 text-cyan-500/60" />}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-gray-200/60 dark:border-gray-700/60">
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-cyan-600 dark:text-cyan-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                onClick={() => {
                  setShowCreateDialog(true);
                  setSourceBranch(currentWorkspace?.branch ?? "");
                }}
              >
                <Plus className="w-3 h-3 shrink-0" />
                <span>{t("newWorkspace")}</span>
              </button>
            </div>
          </div>
        )}
        {showCreateDialog && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-xl p-3 space-y-2">
            <div className="text-xs font-medium text-gray-800 dark:text-gray-200">
              {t("newWorkspaceTitle")}
            </div>
            <div className="space-y-1.5">
              <div>
                <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">
                  {t("baseBranch")}
                </label>
                <select
                  value={sourceBranch}
                  onChange={(e) => setSourceBranch(e.target.value)}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-300 outline-none"
                >
                  {worktrees.map((wt) => (
                    <option key={wt.path} value={wt.branch}>
                      {wt.branch}
                      {wt.isMain ? t("mainBranch") : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">
                  {t("newBranchName")}
                </label>
                <input
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  placeholder="feature-xxx"
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-300 outline-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewBranch("");
                }}
                className="px-2 py-1 rounded text-xs text-gray-400 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {t("cancel", { ns: "common" })}
              </button>
              <button
                onClick={handleCreateWorktree}
                disabled={!newBranch.trim() || creating}
                className="px-2 py-1 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                {creating ? t("creating") : t("create")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="relative" ref={modelRef}>
        <button
          onClick={() => {
            setModelOpen(!modelOpen);
            setThinkingOpen(false);
            setWorkspaceOpen(false);
          }}
          disabled={!activeSessionId}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-800/60 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-40"
          aria-expanded={modelOpen}
          aria-label={t("modelSelect")}
        >
          <Cpu className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />
          <span className="truncate flex-1 text-left">
            {t("modelLabel", { model: modelDisplay })}
          </span>
          <ChevronDown
            className={`w-3 h-3 shrink-0 transition-transform ${modelOpen ? "rotate-180" : ""}`}
          />
        </button>
        {modelOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-64 overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-xl flex flex-col">
            <div className="px-2 py-1.5 border-b border-gray-200/60 dark:border-gray-700/60 shrink-0">
              <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-gray-100/60 dark:bg-gray-900/60 border border-gray-200/50 dark:border-gray-700/50">
                <Search className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={t("searchModels")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-[11px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 outline-none min-w-0"
                />
                <button
                  onClick={() => setShowFavoritesOnly((v) => !v)}
                  className={`p-0.5 rounded transition-colors shrink-0 ${
                    showFavoritesOnly
                      ? "text-amber-400"
                      : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                  }`}
                  title={showFavoritesOnly ? t("showAll") : t("showFavoritesOnly")}
                >
                  <Star className={`w-3.5 h-3.5 ${showFavoritesOnly ? "fill-amber-400" : ""}`} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 py-1">
              {availableModels.length === 0 ? (
                <div className="text-gray-400 dark:text-gray-500 text-xs text-center py-3">
                  {t("noAvailableModels")}
                </div>
              ) : displayModels.length === 0 ? (
                <div className="text-gray-400 dark:text-gray-500 text-xs text-center py-3">
                  {showFavoritesOnly ? t("noFavoriteModels") : t("noResults", { ns: "common" })}
                </div>
              ) : (
                displayModels.map((m) => renderModelItem(m))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="relative flex items-center gap-1 px-2 py-0.5">
        {TIER_KEYS.map((tier: TierKey) => {
          const isActive = currentTier === tier;
          const icons: Record<TierKey, React.ComponentType<{ className?: string }>> = {
            fast: Zap,
            pro: Target,
            max: Brain,
          };
          const labels: Record<TierKey, string> = {
            fast: t("tierFast"),
            pro: t("tierPro"),
            max: t("tierMax"),
          };
          const Icon = icons[tier];

          return (
            <button
              key={tier}
              onClick={() => {
                if (!switchingTier && activeSessionId) {
                  handleSwitchTier(tier);
                }
              }}
              disabled={switchingTier || !activeSessionId}
              className={`
                flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all duration-150 flex-1 justify-center
                ${
                  isActive
                    ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 font-medium ring-1 ring-indigo-500/30"
                    : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
              title={labels[tier]}
            >
              <Icon className="w-2.5 h-2.5 shrink-0" />
              <span>{labels[tier]}</span>
            </button>
          );
        })}
        <button
          onClick={handleOpenTierConfig}
          disabled={!activeSessionId}
          className="p-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 shrink-0"
          title={t("tierConfigTitle", "Configure tier models")}
          aria-label={t("tierConfigTitle", "Configure tier models")}
        >
          <Settings2 className="w-3 h-3" />
        </button>

        {tierConfigOpen && (
          <div
            ref={tierConfigRef}
            className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-xl p-3 space-y-2"
          >
            <div className="text-xs font-medium text-gray-800 dark:text-gray-200">
              {t("tierConfigTitle", "Configure tier models")}
            </div>
            {TIER_KEYS.map((tier) => {
              const labels: Record<TierKey, string> = {
                fast: t("tierFast"),
                pro: t("tierPro"),
                max: t("tierMax"),
              };
              const icons: Record<TierKey, React.ComponentType<{ className?: string }>> = {
                fast: Zap,
                pro: Target,
                max: Brain,
              };
              const Icon = icons[tier];
              return (
                <div key={tier} className="flex items-center gap-2">
                  <div className="flex items-center gap-1 w-14 shrink-0">
                    <Icon className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                    <span className="text-[11px] text-gray-600 dark:text-gray-300">
                      {labels[tier]}
                    </span>
                  </div>
                  <select
                    value={tierConfigModels[tier] ?? ""}
                    onChange={(e) => {
                      setTierConfigModels((prev) => ({ ...prev, [tier]: e.target.value }));
                    }}
                    className="flex-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-[11px] text-gray-700 dark:text-gray-300 outline-none min-w-0"
                  >
                    <option value="">
                      {currentModel
                        ? t("tierConfigDefault", "默认 ({{model}})", {
                            model:
                              currentModel.name ?? `${currentModel.provider}/${currentModel.id}`,
                          })
                        : t("tierConfigDefaultPlain", "-- 默认 --")}
                    </option>
                    {availableModels.map((m) => (
                      <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                        {m.name ?? `${m.provider}/${m.id}`}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setTierConfigOpen(false)}
                className="px-2 py-1 rounded text-[11px] text-gray-400 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {t("cancel", { ns: "common" })}
              </button>
              <button
                onClick={handleSaveTierConfig}
                disabled={tierConfigSaving}
                className="px-2 py-1 rounded text-[11px] bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                {tierConfigSaving ? t("saving", "Saving...") : t("save", "Save")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="relative" ref={thinkingRef}>
        <button
          onClick={() => {
            setThinkingOpen(!thinkingOpen);
            setModelOpen(false);
            setWorkspaceOpen(false);
          }}
          disabled={!activeSessionId}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-800/60 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-40"
          aria-expanded={thinkingOpen}
          aria-label={t("thinkingSelect")}
        >
          <Brain className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />
          <span className="truncate flex-1 text-left">
            {t("thinkingLabel", { level: thinkingDisplay })}
          </span>
          <ChevronDown
            className={`w-3 h-3 shrink-0 transition-transform ${thinkingOpen ? "rotate-180" : ""}`}
          />
        </button>
        {thinkingOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-xl py-1">
            {THINKING_LEVEL_VALUES.map((value, idx) => {
              const isActive = currentThinkingLevel === value;
              return (
                <button
                  key={value}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                      : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                  onClick={() => handleSelectThinking(value)}
                >
                  {isActive ? (
                    <Check className="w-3 h-3 shrink-0 text-indigo-400" />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span>{t(THINKING_LEVEL_KEYS[idx])}</span>
                  <span className="text-gray-400 dark:text-gray-500 ml-auto text-[10px] font-mono">
                    {value}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ThemeMenu />
    </div>
  );

  function renderModelItem(m: ModelInfo) {
    const isActive = currentModel?.id === m.id && currentModel?.provider === m.provider;
    const key = modelKey(m);
    const isFav = favorites.has(key);
    return (
      <div
        key={key}
        className={`group flex items-center px-2 py-1.5 transition-colors ${
          isActive
            ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
            : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleSelectModel(m);
          }}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
        >
          {isActive ? (
            <Check className="w-3 h-3 shrink-0 text-indigo-400" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <div className="flex flex-col min-w-0">
            <span className="truncate text-xs">{m.name ?? formatModelName(m.id)}</span>
            <span className="text-[10px] text-cyan-500/60 font-mono">
              {m.provider} · {m.id}
            </span>
          </div>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(key);
          }}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-300/50 dark:hover:bg-gray-600/50 transition-all shrink-0"
          title={isFav ? t("unfavorite") : t("favorite")}
        >
          <Star
            className={`w-3 h-3 ${isFav ? "fill-amber-400 text-amber-400 opacity-100" : "text-gray-400 dark:text-gray-500"}`}
          />
        </button>
      </div>
    );
  }
}

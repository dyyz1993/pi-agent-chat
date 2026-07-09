import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  ChevronDown,
  Check,
  Cpu,
  Brain,
  Bot,
  FolderTree,
  GitBranch,
  Plus,
  Wrench,
  Search,
  ClipboardList,
  Zap,
  Target,
  Settings2,
  RefreshCw,
  Star,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/use-session-store";
import { formatFilePath } from "../../lib/format-path";
import { useGitStore } from "../../stores/use-git-store";
import { useTierStore, TIER_KEYS } from "../../stores/use-tier-store";
import type { TierKey } from "../../stores/use-tier-store";
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";
import { ThemeMenu } from "../theme/ThemeMenu";
import { ModelPickerButton } from "../model-picker/ModelPickerButton";
import { CopyButton } from "../chat/CopyButton";
import { DropdownSelect, AnchoredPopover } from "../primitives";
import { useAgentStore, getSourceLabel, isGlobalAgent } from "../../stores/use-agent-store";
import { AgentAvatar } from "../agent-avatar/AgentAvatar";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useEffectiveSessionId } from "../../hooks/use-effective-session-id";

const log = createLogger("chat");
const EMPTY_AVAILABLE_MODELS: ReturnType<typeof useSessionStore.getState>["availableModels"] = [];

const THINKING_LEVEL_KEYS = [
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXHigh",
] as const;

type ThinkingLevel = (typeof THINKING_LEVEL_VALUES)[number];

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
  const activeSessionId = useEffectiveSessionId();
  const agentReady = useSessionStore(
    useCallback(
      (s) => (activeSessionId ? !!s.agentReady[activeSessionId] : false),
      [activeSessionId],
    ),
  );
  const currentModel = useSessionStore(
    useCallback(
      (s) =>
        activeSessionId
          ? (s.modelBySession?.[activeSessionId] ??
            (s.activeSessionId === activeSessionId ? s.currentModel : null))
          : null,
      [activeSessionId],
    ),
  );
  const modelStateLoading = useSessionStore((s) => s.modelStateLoading);
  const currentThinkingLevel = useSessionStore((s) => s.currentThinkingLevel);
  const availableModels = useSessionStore(
    useCallback(
      (s) =>
        activeSessionId
          ? (s.availableModelsBySession?.[activeSessionId] ??
            (s.activeSessionId === activeSessionId ? s.availableModels : EMPTY_AVAILABLE_MODELS))
          : EMPTY_AVAILABLE_MODELS,
      [activeSessionId],
    ),
  );
  const setCurrentModel = useSessionStore((s) => s.setCurrentModel);
  const setThinkingLevel = useSessionStore((s) => s.setThinkingLevel);
  const fetchModelState = useSessionStore((s) => s.fetchModelState);
  const fetchInitialState = useSessionStore((s) => s.fetchInitialState);

  const [thinkingOpen, setThinkingOpen] = useState(false);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const thinkingButtonRef = useRef<HTMLButtonElement>(null);
  const [switching, setSwitching] = useState(false);

  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);

  const tabProjectPath = useSessionStore((s) => {
    const tab = s.projectTabs.find((t) => t.id === s.activeProjectId);
    return tab?.path ?? null;
  });

  const currentSession = useMemo(() => {
    if (!activeSessionId) return null;
    for (const sessions of Object.values(sessionsByProject)) {
      const found = sessions.find((s) => s.sessionId === activeSessionId);
      if (found) return found;
    }
    return null;
  }, [activeSessionId, sessionsByProject]);

  // Tier is scoped to the effective session project, not only the active tab.
  // This keeps refresh/subsession/worktree selection aligned with the model row.
  const projectPath = currentSession?.projectPath ?? tabProjectPath;

  const currentTier = useTierStore((s) =>
    projectPath ? s.getCurrentTier(projectPath) : null,
  );
  const switchToTier = useTierStore((s) => s.switchToTier);
  const fetchTierConfig = useTierStore((s) => s.fetchTierConfig);
  const saveProjectTierConfig = useTierStore((s) => s.saveProjectTierConfig);
  const tierModels = useTierStore((s) =>
    projectPath ? s.getTierModels(projectPath) : s.globalDefaults,
  );
  const [switchingTier, setSwitchingTier] = useState(false);
  const [tierConfigOpen, setTierConfigOpen] = useState(false);
  const [tierConfigModels, setTierConfigModels] = useState<Record<string, string>>({});
  const [tierConfigSaving, setTierConfigSaving] = useState(false);
  const tierConfigRef = useRef<HTMLDivElement>(null);
  const tierConfigButtonRef = useRef<HTMLButtonElement>(null);

  const currentAgent = useAgentStore((s) =>
    activeSessionId ? (s.currentAgentBySession[activeSessionId] ?? "build") : "build",
  );
  const agents = useAgentStore((s) => s.agents);
  const agentFavorites = useAgentStore((s) => s.agentFavorites);
  const agentDetailBySession = useAgentStore((s) => s.agentDetailBySession);
  const agentSwitching = useAgentStore((s) =>
    activeSessionId ? (s.switchingBySession[activeSessionId] ?? false) : false,
  );
  const switchAgent = useAgentStore((s) => s.switchAgent);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const toggleAgentFavorite = useAgentStore((s) => s.toggleAgentFavorite);
  const [agentOpen, setAgentOpen] = useState(false);
  const agentRef = useRef<HTMLDivElement>(null);
  const agentButtonRef = useRef<HTMLButtonElement>(null);

  const addProjectTab = useSessionStore((s) => s.addProjectTab);

  const worktrees = useGitStore((s) => s.worktrees);
  const isGitRepo = useGitStore((s) => s.isGitRepo);
  const fetchWorktrees = useGitStore((s) => s.fetchWorktrees);
  const refreshGitAll = useGitStore((s) => s.refreshAll);
  const addWorktreeAction = useGitStore((s) => s.addWorktree);

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceRefreshing, setWorkspaceRefreshing] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const createDialogButtonRef = useRef<HTMLButtonElement>(null);
  const [newBranch, setNewBranch] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);

  const sessionFetchedRef = useRef<string | null>(null);
  const tierFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    if (sessionFetchedRef.current === activeSessionId) return;
    sessionFetchedRef.current = activeSessionId;
    fetchInitialState(activeSessionId, { force: true });
    fetchModelState(activeSessionId, { force: true });
  }, [activeSessionId, fetchInitialState, fetchModelState]);

  useEffect(() => {
    if (!activeSessionId || !projectPath) return;
    const key = `${activeSessionId}:${projectPath}`;
    if (tierFetchedRef.current === key) return;
    tierFetchedRef.current = key;
    fetchTierConfig(activeSessionId);
  }, [activeSessionId, projectPath, fetchTierConfig]);

  const currentTab = projectTabs.find((t) => t.id === activeProjectId);
  const activeTabPath = currentTab?.path ?? "";

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
  const workspaceDisplayName = currentTab?.remote ? currentTab.name : workspaceName;
  const workspaceDisplayPath = currentTab?.remote
    ? `${currentTab.remote.host}:${currentTab.remote.remotePath}`
    : workspacePath;

  useEffect(() => {
    if (activeTabPath && isGitRepo) {
      fetchWorktrees(activeTabPath);
    }
  }, [activeTabPath, fetchWorktrees, isGitRepo]);

  const refreshWorkspaceGit = useCallback(async () => {
    if (!activeTabPath || workspaceRefreshing) return;
    setWorkspaceRefreshing(true);
    try {
      await refreshGitAll(activeTabPath);
    } finally {
      setWorkspaceRefreshing(false);
    }
  }, [activeTabPath, refreshGitAll, workspaceRefreshing]);

  useEffect(() => {
    if (!tierConfigOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (tierConfigRef.current && !tierConfigRef.current.contains(e.target as Node)) {
        const el = e.target as HTMLElement;
        if (!el.closest?.("[data-model-picker-dropdown]")) {
          setTierConfigOpen(false);
        }
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTierConfigOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [tierConfigOpen]);

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
      log.warn("worktree add failed", { error: String(err) });
    }
    setCreating(false);
  }, [newBranch, activeTabPath, sourceBranch, creating, addWorktreeAction, addProjectTab]);

  const handleSwitchTier = useCallback(
    async (tier: TierKey) => {
      if (!activeSessionId || !agentReady || switchingTier) return;
      setSwitchingTier(true);
      await switchToTier(tier, activeSessionId);
      setSwitchingTier(false);
    },
    [activeSessionId, agentReady, switchingTier, switchToTier],
  );

  const refreshModelsForActiveSession = useCallback(() => {
    if (!activeSessionId || !agentReady) return;
    void apiClient
      .call("agent.reload", { sessionId: activeSessionId })
      .catch((err) => {
        log.warn("refresh models reload failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        fetchModelState(activeSessionId);
      });
  }, [activeSessionId, agentReady, fetchModelState]);

  const handleOpenTierConfig = useCallback(async () => {
    if (!activeSessionId) return;
    refreshModelsForActiveSession();
    setTierConfigModels({ ...tierModels });
    setTierConfigOpen(true);
  }, [activeSessionId, refreshModelsForActiveSession, tierModels]);

  const handleSaveTierConfig = useCallback(async () => {
    if (!activeSessionId || !projectPath) return;
    setTierConfigSaving(true);
    try {
      useTierStore.getState().setProjectTierModels(projectPath, tierConfigModels);
      await saveProjectTierConfig(projectPath);
      setTierConfigOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("save tier config failed", { error: msg });
    }
    setTierConfigSaving(false);
  }, [activeSessionId, projectPath, tierConfigModels, saveProjectTierConfig]);

  const handleSelectModel = useCallback(
    async (key: string) => {
      if (!activeSessionId || switching) return;
      const [provider, ...rest] = key.split("/");
      const modelId = rest.join("/");
      if (currentModel?.id === modelId && currentModel?.provider === provider) return;
      setSwitching(true);
      try {
        await apiClient.call("agent.reload", { sessionId: activeSessionId });
        await apiClient.call("agent.setModel", {
          sessionId: activeSessionId,
          provider,
          modelId,
        });
        setCurrentModel(provider, modelId);
        if (projectPath) {
          const tierStore = useTierStore.getState();
          const models = tierStore.getTierModels(projectPath);
          const matchedTier = TIER_KEYS.find(
            (tier) => models[tier]?.toLowerCase() === `${provider}/${modelId}`.toLowerCase(),
          );
          if (matchedTier) {
            tierStore.setProjectCurrentTier(projectPath, matchedTier);
          }
        }
        fetchModelState(activeSessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("setModel failed", { error: message });
        useNotificationStore.getState().push({
          message: t(
            "modelSwitchFailed",
            "模型切换失败。请确认 API Key 已保存，然后点击刷新资源或重试。",
          ),
          level: "error",
          sessionId: activeSessionId,
        });
      }
      setSwitching(false);
    },
    [activeSessionId, switching, currentModel, setCurrentModel, projectPath, fetchModelState, t],
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
        log.warn("setThinkingLevel failed", { error: String(err) });
      }
      setSwitching(false);
      setThinkingOpen(false);
    },
    [activeSessionId, switching, currentThinkingLevel, setThinkingLevel],
  );

  const modelDisplay = currentModel
    ? `${currentModel.provider}/${currentModel.name ?? formatModelName(currentModel.id)}`
    : modelStateLoading
      ? t("loading")
      : t("notLoaded");
  const thinkingDisplay = !currentModel?.reasoning
    ? t("thinkingOff")
    : currentThinkingLevel
      ? (() => {
          const idx = THINKING_LEVEL_VALUES.indexOf(
            currentThinkingLevel as (typeof THINKING_LEVEL_VALUES)[number],
          );
          return idx >= 0 ? t(THINKING_LEVEL_KEYS[idx]) : currentThinkingLevel;
        })()
      : t("default");

  const currentAgentInfo = useMemo(
    () => agents.find((agent) => agent.name === currentAgent) ?? null,
    [agents, currentAgent],
  );
  const currentAgentColorValue =
    activeSessionId && agentDetailBySession[activeSessionId]?.color
      ? agentDetailBySession[activeSessionId].color
      : currentAgentInfo?.color;
  const currentAgentAvatar =
    activeSessionId && agentDetailBySession[activeSessionId]?.avatar
      ? agentDetailBySession[activeSessionId].avatar
      : currentAgentInfo?.avatar;
  const currentAgentFilePath =
    activeSessionId && agentDetailBySession[activeSessionId]?.filePath
      ? agentDetailBySession[activeSessionId].filePath
      : currentAgentInfo?.filePath;

  return (
    <div className="shrink-0 border-t border-border-secondary/80 dark:border-surface-dim/80 px-3 py-2 space-y-1.5">
      <div className="relative" ref={agentRef}>
        <button
          ref={agentButtonRef}
          onClick={() => {
            const nextOpen = !agentOpen;
            setAgentOpen(nextOpen);
            if (nextOpen && activeSessionId && agentReady) {
              void fetchAgents(activeSessionId);
            }
            setThinkingOpen(false);
            setWorkspaceOpen(false);
            setTierConfigOpen(false);
          }}
          disabled={!activeSessionId || !agentReady || agentSwitching}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-tertiary hover:bg-surface-hover/60 dark:hover:bg-surface-dim/60 hover:text-text-secondary dark:hover:text-text-secondary transition-colors disabled:opacity-40 whitespace-nowrap"
          aria-expanded={agentOpen}
          aria-label={t("agentSelect")}
        >
          {currentAgentAvatar || currentAgentColorValue ? (
            <AgentAvatar
              avatar={currentAgentAvatar}
              agentFilePath={currentAgentFilePath}
              color={currentAgentColorValue}
              fallbackIcon={Bot}
              className="w-3.5 h-3.5 rounded-full shrink-0 text-text-tertiary"
              title={currentAgent}
            />
          ) : (
            <Bot className="w-3 h-3 shrink-0 text-text-tertiary" />
          )}
          <span className="truncate flex-1 text-left">
            {currentAgent === "build"
              ? t("agentBuild")
              : currentAgent === "explore"
                ? t("agentExplore")
                : currentAgent === "plan"
                  ? t("agentPlan")
                  : currentAgent}
          </span>
          <ChevronDown
            className={`w-3 h-3 shrink-0 transition-transform ${agentOpen ? "rotate-180" : ""}`}
          />
        </button>
        <AnchoredPopover
          anchorRef={agentButtonRef}
          open={agentOpen}
          onClose={() => setAgentOpen(false)}
          placement="top"
          align="start"
          minWidth={260}
          maxWidth={320}
          maxHeight={240}
          className="bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-md shadow-xl overflow-hidden flex flex-col"
        >
          <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 py-1">
            {agents.map((agent) => {
              const isActive = currentAgent === agent.name;
              const isFavorite = agentFavorites.has(agent.name);
              const iconMap: Record<string, LucideIcon> = {
                build: Wrench,
                explore: Search,
                plan: ClipboardList,
              };
              const Icon = iconMap[agent.name] || Bot;
              return (
                <div
                  key={agent.name}
                  role="button"
                  tabIndex={0}
                  className={`w-full text-left px-3 py-2 text-xs flex items-start gap-2 transition-colors cursor-pointer ${
                    isActive
                      ? "bg-accent/10"
                      : "text-text-secondary dark:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
                  }`}
                  onClick={async () => {
                    if (activeSessionId && agentReady && !agentSwitching && !isActive) {
                      await switchAgent(agent.name, activeSessionId);
                    }
                    setAgentOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      (e.target as HTMLElement).click();
                    }
                  }}
                >
                  <button
                    type="button"
                    className={`mt-0.5 -ml-0.5 p-0.5 rounded text-text-tertiary hover:text-accent hover:bg-accent/10 transition-colors ${
                      isFavorite ? "text-accent" : ""
                    }`}
                    title={isFavorite ? t("unfavorite") : t("favorite")}
                    aria-label={isFavorite ? t("unfavorite") : t("favorite")}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void toggleAgentFavorite(agent.name);
                    }}
                  >
                    <Star className="w-3 h-3" fill={isFavorite ? "currentColor" : "none"} />
                  </button>
                  <AgentAvatar
                    avatar={agent.avatar}
                    agentFilePath={agent.filePath}
                    color={agent.color}
                    fallbackIcon={Icon}
                    className={`w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 ${
                      isActive ? "text-accent" : "text-text-tertiary"
                    }`}
                    title={agent.name}
                  />
                  <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-medium truncate ${isActive ? "text-accent" : ""}`}>{agent.name}</span>
                        <span
                          className={`text-[9px] px-1 py-0.5 rounded shrink-0 font-mono ${
                            isGlobalAgent(agent.source)
                              ? "bg-accent/10 text-accent"
                              : "bg-surface-dim text-text-tertiary"
                          }`}
                          title={getSourceLabel(agent.source)}
                        >
                          {getSourceLabel(agent.source)}
                        </span>
                      </div>
                      {agent.description && (
                        <div className="text-text-tertiary text-[10px] mt-0.5 truncate">
                          {agent.description}
                        </div>
                      )}
                      {agent.filePath && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span
                            className="text-[9px] text-text-tertiary truncate"
                            title={agent.filePath}
                          >
                            {formatFilePath(agent.filePath)}
                          </span>
                          <CopyButton
                            text={agent.filePath}
                            size="xs"
                            className="text-[9px] text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary"
                            title={agent.filePath}
                          />
                        </div>
                      )}
                    </div>
                    {isActive && <Check className="w-3 h-3 shrink-0 text-accent mt-0.5" />}
                    {agent.tier && (
                      <span className="text-[10px] text-text-tertiary shrink-0 mt-0.5">
                        {agent.tier}
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
        </AnchoredPopover>
      </div>

      <div className="relative" ref={workspaceRef}>
        {!isGitRepo ? (
          <button
            type="button"
            onClick={() => void refreshWorkspaceGit()}
            disabled={!activeTabPath || workspaceRefreshing}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-tertiary hover:bg-surface-hover/60 dark:hover:bg-surface-dim/60 hover:text-text-secondary dark:hover:text-text-secondary transition-colors disabled:opacity-50 disabled:cursor-wait"
            title="Refresh Git status"
            aria-label="Refresh Git status"
          >
            <FolderTree className="w-3 h-3 shrink-0" />
            <div className="flex flex-col min-w-0 flex-1 text-left">
              <span className="truncate">{t("notGitRepo")}</span>
              <span className="text-[10px] text-text-tertiary truncate">
                {workspaceDisplayPath || activeTabPath.split("/").pop()}
              </span>
            </div>
            <RefreshCw
              className={`w-3 h-3 shrink-0 ${workspaceRefreshing ? "animate-spin" : ""}`}
            />
          </button>
        ) : (
          <button
            ref={workspaceButtonRef}
            onClick={() => {
              const nextOpen = !workspaceOpen;
              setWorkspaceOpen(nextOpen);
              setThinkingOpen(false);
              if (nextOpen) void refreshWorkspaceGit();
            }}
            disabled={!activeSessionId || !agentReady}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-tertiary hover:bg-surface-hover/60 dark:hover:bg-surface-dim/60 hover:text-text-secondary dark:hover:text-text-secondary transition-colors disabled:opacity-40"
            aria-expanded={workspaceOpen}
            aria-label={t("workspaceSelect")}
          >
            <FolderTree className="w-3 h-3 shrink-0 text-text-tertiary" />
            <div className="flex flex-col min-w-0 flex-1 text-left">
              <span className="truncate">{workspaceDisplayName}</span>
              <span className="text-[10px] text-text-tertiary truncate">
                {workspaceDisplayPath}
              </span>
            </div>
            <ChevronDown
              className={`w-3 h-3 shrink-0 transition-transform ${workspaceOpen ? "rotate-180" : ""}`}
            />
          </button>
        )}
        {isGitRepo && (
          <AnchoredPopover
            anchorRef={workspaceButtonRef}
            open={workspaceOpen}
            onClose={() => {
              setWorkspaceOpen(false);
              setShowCreateDialog(false);
            }}
            placement="top"
            align="start"
            minWidth={240}
            maxWidth={300}
            className="bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-md shadow-xl overflow-hidden flex flex-col"
          >
            <div className="max-h-64 flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 py-1">
                {worktrees.map((wt) => {
                  const isActive = currentWorkspace?.path === wt.path;
                  const name = wt.isMain ? t("mainWorkspace") : wt.branch;
                  return (
                    <button
                      key={wt.path}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                        isActive
                          ? "bg-accent/10"
                          : "text-text-secondary dark:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
                      }`}
                      onClick={() => handleSwitchWorkspace(wt)}
                    >
                      {isActive ? (
                        <Check className="w-3 h-3 shrink-0 text-accent" />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={`truncate ${isActive ? "text-accent font-medium" : ""}`}>{name}</span>
                        <span className="text-[10px] text-text-tertiary truncate">{wt.path}</span>
                      </div>
                      {!wt.isMain && <GitBranch className="w-3 h-3 shrink-0 text-text-tertiary" />}
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-border-secondary/60">
                <button
                  ref={createDialogButtonRef}
                  className="w-full text-left px-3 py-1.5 text-xs text-accent hover:bg-surface-hover dark:hover:bg-surface-hover flex items-center gap-2 transition-colors"
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
          </AnchoredPopover>
        )}
        {showCreateDialog && (
          <AnchoredPopover
            anchorRef={createDialogButtonRef}
            open={showCreateDialog}
            onClose={() => {
              setShowCreateDialog(false);
              setNewBranch("");
            }}
            placement="top"
            align="start"
            minWidth={260}
            className="bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-md shadow-xl p-3 space-y-2"
          >
            <div className="text-xs font-medium text-text-primary">{t("newWorkspaceTitle")}</div>
            <div className="space-y-1.5">
              <div>
                <label className="text-[10px] text-text-tertiary block mb-0.5">
                  {t("baseBranch")}
                </label>
                <DropdownSelect
                  value={sourceBranch}
                  onChange={setSourceBranch}
                  ariaLabel={t("baseBranch")}
                  className="w-full rounded px-2 py-1 text-xs"
                  options={worktrees.map((wt) => ({
                    value: wt.branch,
                    label: `${wt.branch}${wt.isMain ? t("mainBranch") : ""}`,
                  }))}
                />
              </div>
              <div>
                <label className="text-[10px] text-text-tertiary block mb-0.5">
                  {t("newBranchName")}
                </label>
                <input
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  placeholder="feature-xxx"
                  className="w-full bg-bg-elevated dark:bg-surface-code border border-border-secondary rounded px-2 py-1 text-xs text-text-secondary outline-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewBranch("");
                }}
                className="px-2 py-1 rounded text-xs text-text-tertiary hover:bg-surface-hover dark:hover:bg-surface-hover"
              >
                {t("cancel", { ns: "common" })}
              </button>
              <button
                onClick={handleCreateWorktree}
                disabled={!newBranch.trim() || creating}
                className="px-2 py-1 rounded text-xs bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
              >
                {creating ? t("creating") : t("create")}
              </button>
            </div>
          </AnchoredPopover>
        )}
      </div>

      <div>
        <ModelPickerButton
          models={availableModels}
          value={currentModel ? `${currentModel.provider}/${currentModel.id}` : ""}
          onChange={handleSelectModel}
          disabled={!activeSessionId || !agentReady}
          placement="up"
          onOpenChange={(open) => {
            if (open) {
              refreshModelsForActiveSession();
              setThinkingOpen(false);
              setWorkspaceOpen(false);
              setTierConfigOpen(false);
            }
          }}
          renderTrigger={({ open }) => (
            <button
              disabled={!activeSessionId || !agentReady}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-tertiary hover:bg-surface-hover/60 dark:hover:bg-surface-dim/60 hover:text-text-secondary dark:hover:text-text-secondary transition-colors disabled:opacity-40 ${open ? "bg-surface-code/60 dark:bg-surface-dim/60" : ""}`}
              aria-expanded={open}
              aria-label={t("modelSelect")}
            >
              <Cpu className="w-3 h-3 shrink-0 text-text-tertiary" />
              <span
                className={`truncate flex-1 text-left${modelStateLoading ? " animate-pulse opacity-60" : ""}`}
              >
                {t("modelLabel", { model: modelDisplay })}
              </span>
              <ChevronDown
                className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
          )}
        />
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
                if (!switchingTier && activeSessionId && agentReady) {
                  handleSwitchTier(tier);
                }
              }}
              disabled={switchingTier || !activeSessionId || !agentReady}
              className={`
                flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all duration-150 flex-1 min-w-0 justify-center overflow-hidden whitespace-nowrap
                ${
                  isActive
                    ? "bg-accent/10 text-accent font-medium ring-1 ring-accent/25"
                    : "text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-dim"
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
              title={labels[tier]}
            >
              <Icon className="w-2.5 h-2.5 shrink-0" />
              <span className="min-w-0 truncate">{labels[tier]}</span>
            </button>
          );
        })}
        <button
          ref={tierConfigButtonRef}
          onClick={handleOpenTierConfig}
          disabled={!activeSessionId || !agentReady}
          className="p-0.5 rounded text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-dim transition-colors disabled:opacity-40 shrink-0"
          title={t("tierConfigTitle", "Configure tier models")}
          aria-label={t("tierConfigTitle", "Configure tier models")}
        >
          <Settings2 className="w-3 h-3" />
        </button>

        {tierConfigOpen && (
          <AnchoredPopover
            anchorRef={tierConfigButtonRef}
            open={tierConfigOpen}
            onClose={() => setTierConfigOpen(false)}
            placement="top"
            align="end"
            minWidth={240}
            maxHeight={280}
            closeOnOutsideClick={false}
            closeOnEscape={false}
            className="bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-md shadow-xl flex flex-col"
          >
            <div ref={tierConfigRef} className="flex flex-col overflow-hidden flex-1 min-h-0">
              <div className="px-3 py-2 text-xs font-medium text-text-primary shrink-0 border-b border-border-secondary/60">
                {t("tierConfigTitle", "Configure tier models")}
              </div>
              <div className="overflow-y-auto overflow-x-hidden flex-1 py-1.5 px-2 space-y-1.5">
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
                      <div className="flex items-center gap-1 w-12 shrink-0">
                        <Icon className="w-3 h-3 text-text-tertiary shrink-0" />
                        <span className="text-[11px] text-text-secondary truncate">{labels[tier]}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <ModelPickerButton
                          models={availableModels}
                          value={tierConfigModels[tier] ?? ""}
                          onChange={(v) => {
                            setTierConfigModels((prev) => ({ ...prev, [tier]: v }));
                          }}
                          onOpenChange={(open) => {
                            if (open) refreshModelsForActiveSession();
                          }}
                          placement="up"
                          dropdownMinWidth={420}
                          dropdownMaxWidth={520}
                          placeholder={
                            currentModel
                              ? t("tierConfigDefault", "默认 ({{model}})", {
                                  model:
                                    currentModel.name ?? `${currentModel.provider}/${currentModel.id}`,
                                })
                              : t("tierConfigDefaultPlain", "-- 默认 --")
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border-secondary/60 shrink-0">
                <button
                  onClick={() => setTierConfigOpen(false)}
                  className="px-2 py-1 rounded text-[11px] text-text-tertiary hover:bg-surface-hover dark:hover:bg-surface-hover whitespace-nowrap"
                >
                  {t("cancel", { ns: "common" })}
                </button>
                <button
                  onClick={handleSaveTierConfig}
                  disabled={tierConfigSaving}
                  className="px-2 py-1 rounded text-[11px] bg-accent text-white hover:bg-accent/90 disabled:opacity-40 whitespace-nowrap"
                >
                  {tierConfigSaving ? t("saving", "Saving...") : t("save", "Save")}
                </button>
              </div>
            </div>
          </AnchoredPopover>
        )}
      </div>

      <div className="relative" ref={thinkingRef}>
        <button
          ref={thinkingButtonRef}
          onClick={() => {
            setThinkingOpen(!thinkingOpen);
            setWorkspaceOpen(false);
          }}
          disabled={!activeSessionId || !agentReady || !currentModel?.reasoning}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-tertiary hover:bg-surface-hover/60 dark:hover:bg-surface-dim/60 hover:text-text-secondary dark:hover:text-text-secondary transition-colors disabled:opacity-40 whitespace-nowrap"
          aria-expanded={thinkingOpen}
          aria-label={t("thinkingSelect")}
          title={
            !currentModel?.reasoning
              ? t("thinkingNotSupported", "当前模型不支持思考模式")
              : t("thinkingSelect")
          }
        >
          <Brain className="w-3 h-3 shrink-0 text-text-tertiary" />
          <span className="truncate flex-1 text-left">
            {t("thinkingLabel", { level: thinkingDisplay })}
          </span>
          <ChevronDown
            className={`w-3 h-3 shrink-0 transition-transform ${thinkingOpen ? "rotate-180" : ""}`}
          />
        </button>
        <AnchoredPopover
          anchorRef={thinkingButtonRef}
          open={thinkingOpen}
          onClose={() => setThinkingOpen(false)}
          placement="top"
          align="start"
          minWidth={200}
          maxHeight={240}
          className="bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-md shadow-xl overflow-hidden flex flex-col"
        >
          <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 py-1">
            {THINKING_LEVEL_VALUES.map((value, idx) => {
              const isActive = currentThinkingLevel === value;
              return (
                <button
                  key={value}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-accent/10"
                      : "text-text-secondary dark:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
                  }`}
                  onClick={() => handleSelectThinking(value)}
                >
                  {isActive ? (
                    <Check className="w-3 h-3 shrink-0 text-accent" />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className={`whitespace-nowrap ${isActive ? "text-accent font-medium" : ""}`}>{t(THINKING_LEVEL_KEYS[idx])}</span>
                  <span className="text-text-tertiary ml-auto text-[10px] font-mono whitespace-nowrap">
                    {value}
                  </span>
                </button>
              );
            })}
          </div>
        </AnchoredPopover>
      </div>

      <ThemeMenu />
    </div>
  );
}

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
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/use-session-store";
import { useGitStore } from "../../stores/use-git-store";
import { useTierStore, TIER_KEYS } from "../../stores/use-tier-store";
import type { TierKey } from "../../stores/use-tier-store";
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";
import { ThemeMenu } from "../theme/ThemeMenu";
import { ModelPickerButton } from "../model-picker/ModelPickerButton";
import { CopyButton } from "../chat/CopyButton";
import { useAgentStore, getSourceLabel, isGlobalAgent } from "../../stores/use-agent-store";

const log = createLogger("chat");

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
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const currentModel = useSessionStore((s) => s.currentModel);
  const currentThinkingLevel = useSessionStore((s) => s.currentThinkingLevel);
  const availableModels = useSessionStore((s) => s.availableModels);
  const setCurrentModel = useSessionStore((s) => s.setCurrentModel);
  const setThinkingLevel = useSessionStore((s) => s.setThinkingLevel);
  const fetchModelState = useSessionStore((s) => s.fetchModelState);

  const [thinkingOpen, setThinkingOpen] = useState(false);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const [switching, setSwitching] = useState(false);

  const currentTier = useTierStore((s) => s.currentTier);
  const switchToTier = useTierStore((s) => s.switchToTier);
  const fetchTierConfig = useTierStore((s) => s.fetchTierConfig);
  const tierModels = useTierStore((s) => s.tierModels);
  const [switchingTier, setSwitchingTier] = useState(false);
  const [tierConfigOpen, setTierConfigOpen] = useState(false);
  const [tierConfigModels, setTierConfigModels] = useState<Record<string, string>>({});
  const [tierConfigSaving, setTierConfigSaving] = useState(false);
  const tierConfigRef = useRef<HTMLDivElement>(null);

  const currentAgent = useAgentStore((s) =>
    activeSessionId ? (s.currentAgentBySession[activeSessionId] ?? "build") : "build",
  );
  const agents = useAgentStore((s) => s.agents);
  const agentSwitching = useAgentStore((s) =>
    activeSessionId ? (s.switchingBySession[activeSessionId] ?? false) : false,
  );
  const switchAgent = useAgentStore((s) => s.switchAgent);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const [agentOpen, setAgentOpen] = useState(false);
  const agentRef = useRef<HTMLDivElement>(null);

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
    fetchAgents(activeSessionId);
  }, [activeSessionId, fetchModelState, fetchTierConfig, fetchAgents]);

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
    if (!agentOpen && !thinkingOpen && !workspaceOpen && !tierConfigOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) setAgentOpen(false);
      if (thinkingRef.current && !thinkingRef.current.contains(e.target as Node))
        setThinkingOpen(false);
      if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node))
        setWorkspaceOpen(false);
      if (tierConfigRef.current && !tierConfigRef.current.contains(e.target as Node)) {
        const el = e.target as HTMLElement;
        if (!el.closest?.("[data-model-picker-dropdown]")) {
          setTierConfigOpen(false);
        }
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAgentOpen(false);
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
  }, [agentOpen, thinkingOpen, workspaceOpen, tierConfigOpen]);

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
      // If the currently active tier exists, re-apply it to switch to the new model
      const { currentTier: activeTier, tierModels: updatedModels } = useTierStore.getState();
      if (activeTier && updatedModels[activeTier]) {
        await switchToTier(activeTier, activeSessionId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("save tier config failed", { error: msg });
    }
    setTierConfigSaving(false);
  }, [activeSessionId, tierConfigModels, fetchTierConfig, switchToTier]);

  const handleSelectModel = useCallback(
    async (key: string) => {
      if (!activeSessionId || switching) return;
      const [provider, ...rest] = key.split("/");
      const modelId = rest.join("/");
      if (currentModel?.id === modelId && currentModel?.provider === provider) return;
      setSwitching(true);
      try {
        await apiClient.call("agent.setModel", {
          sessionId: activeSessionId,
          provider,
          modelId,
        });
        setCurrentModel(provider, modelId);
        useTierStore.getState().syncTierFromModel(provider, modelId);
      } catch (err) {
        console.warn("[SidebarControls] setModel failed:", err);
      }
      setSwitching(false);
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
      <div className="relative" ref={agentRef}>
        <button
          onClick={() => {
            setAgentOpen(!agentOpen);
            setThinkingOpen(false);
            setWorkspaceOpen(false);
            setTierConfigOpen(false);
          }}
          disabled={!activeSessionId || agentSwitching}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-800/60 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-40"
          aria-expanded={agentOpen}
          aria-label={t("agentSelect")}
        >
          <Bot className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />
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
        {agentOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-xl py-1">
            <div className="overflow-y-auto max-h-[15rem]">
              {agents.map((agent) => {
                const isActive = currentAgent === agent.name;
                const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
                  build: Wrench,
                  explore: Search,
                  plan: ClipboardList,
                };
                const Icon = iconMap[agent.name] || Bot;
                return (
                  <button
                    key={agent.name}
                    className={`w-full text-left px-3 py-2 text-xs flex items-start gap-2 transition-colors ${
                      isActive
                        ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                        : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                    onClick={async () => {
                      if (activeSessionId && !agentSwitching && !isActive) {
                        await switchAgent(agent.name, activeSessionId);
                      }
                      setAgentOpen(false);
                    }}
                  >
                    {isActive ? (
                      <Check className="w-3 h-3 shrink-0 text-indigo-400 mt-0.5" />
                    ) : (
                      <Icon className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{agent.name}</span>
                        <span
                          className={`text-[9px] px-1 py-0.5 rounded shrink-0 font-mono ${
                            isGlobalAgent(agent.source)
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          }`}
                          title={getSourceLabel(agent.source)}
                        >
                          {getSourceLabel(agent.source)}
                        </span>
                      </div>
                      {agent.description && (
                        <div className="text-gray-400 dark:text-gray-500 text-[10px] mt-0.5 truncate">
                          {agent.description}
                        </div>
                      )}
                      {agent.filePath && (
                        <CopyButton
                          text={agent.filePath}
                          size="xs"
                          className="text-[9px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 mt-0.5 w-fit"
                          title={agent.filePath}
                        />
                      )}
                    </div>
                    {agent.tier && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 mt-0.5">
                        {agent.tier}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

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

      <div>
        <ModelPickerButton
          models={availableModels}
          value={currentModel ? `${currentModel.provider}/${currentModel.id}` : ""}
          onChange={handleSelectModel}
          disabled={!activeSessionId}
          placement="up"
          onOpenChange={(open) => {
            if (open) {
              setThinkingOpen(false);
              setWorkspaceOpen(false);
              setTierConfigOpen(false);
            }
          }}
          renderTrigger={({ open }) => (
            <button
              disabled={!activeSessionId}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-800/60 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-40 ${open ? "bg-gray-100/60 dark:bg-gray-800/60" : ""}`}
              aria-expanded={open}
              aria-label={t("modelSelect")}
            >
              <Cpu className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />
              <span className="truncate flex-1 text-left">
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
                  <div className="flex-1 min-w-0">
                    <ModelPickerButton
                      models={availableModels}
                      value={tierConfigModels[tier] ?? ""}
                      onChange={(v) => {
                        setTierConfigModels((prev) => ({ ...prev, [tier]: v }));
                      }}
                      placement="up"
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
}

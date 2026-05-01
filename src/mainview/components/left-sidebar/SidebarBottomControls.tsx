import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { ChevronDown, Check, Cpu, Brain, Star, Search, FolderTree, GitBranch, Plus } from "lucide-react";
import { useSessionStore } from "../../stores/use-session-store";
import { useGitStore } from "../../stores/use-git-store";
import { apiClient } from "../../lib/api-client";

interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
}

const THINKING_LEVELS = [
  { value: "off", label: "关闭" },
  { value: "minimal", label: "极简" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number]["value"];

const FAVORITES_KEY = "pi-agent-model-favorites";

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveFavorites(favs: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
}

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

function formatThinkingLabel(level: ThinkingLevel): string {
  return THINKING_LEVELS.find((l) => l.value === level)?.label ?? level;
}

export function SidebarBottomControls() {
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
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const modelRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [switching, setSwitching] = useState(false);

  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const addProjectTab = useSessionStore((s) => s.addProjectTab);

  const worktrees = useGitStore((s) => s.worktrees);
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
  }, [activeSessionId, fetchModelState]);

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
      worktrees.find((wt) => currentSession.projectPath.startsWith(wt.path)) ??
      worktrees[0] ??
      null
    );
  }, [currentSession, worktrees]);

  const workspaceName = currentWorkspace
    ? currentWorkspace.isMain
      ? "主工作区"
      : currentWorkspace.branch
    : "未加载";
  const workspacePath = currentWorkspace?.path ?? "";

  useEffect(() => {
    if (activeTabPath && worktrees.length === 0) {
      fetchWorktrees(activeTabPath);
    }
  }, [activeTabPath, worktrees.length, fetchWorktrees]);

  useEffect(() => {
    if (!modelOpen && !thinkingOpen && !workspaceOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
      if (thinkingRef.current && !thinkingRef.current.contains(e.target as Node)) setThinkingOpen(false);
      if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node)) setWorkspaceOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setModelOpen(false); setThinkingOpen(false); setWorkspaceOpen(false); } };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [modelOpen, thinkingOpen, workspaceOpen]);

  useEffect(() => {
    if (modelOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery("");
      setShowFavoritesOnly(false);
    }
  }, [modelOpen]);

  const toggleFavorite = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  const handleSwitchWorkspace = useCallback((wt: { path: string }) => {
    const sessions = sessionsByProject[wt.path];
    if (sessions && sessions.length > 0) {
      useSessionStore.getState().setActiveSession(sessions[0].sessionId);
    }
    setWorkspaceOpen(false);
  }, [sessionsByProject]);

  const handleCreateWorktree = useCallback(async () => {
    if (!newBranch.trim() || !activeTabPath || creating) return;
    setCreating(true);
    try {
      const wt = await addWorktreeAction(activeTabPath, newBranch.trim(), sourceBranch || undefined);
      setShowCreateDialog(false);
      setNewBranch("");
      setSourceBranch("");
      setWorkspaceOpen(false);
      await useSessionStore.getState().createNewSession(wt.path);
    } catch {
    }
    setCreating(false);
  }, [newBranch, activeTabPath, sourceBranch, creating, addWorktreeAction, addProjectTab]);

  const handleSelectModel = useCallback(async (model: ModelInfo) => {
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
    } catch {}
    setSwitching(false);
    setModelOpen(false);
  }, [activeSessionId, switching, currentModel, setCurrentModel]);

  const handleSelectThinking = useCallback(async (level: ThinkingLevel) => {
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
    } catch {}
    setSwitching(false);
    setThinkingOpen(false);
  }, [activeSessionId, switching, currentThinkingLevel, setThinkingLevel]);

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
    ? `${currentModel.provider}/${currentModel.name || formatModelName(currentModel.id)}`
    : "未加载";
  const thinkingDisplay = currentThinkingLevel ? formatThinkingLabel(currentThinkingLevel as ThinkingLevel) : "默认";

  return (
    <div className="shrink-0 border-t border-gray-800/80 px-3 py-2 space-y-1.5">
      <div className="relative" ref={workspaceRef}>
        <button
          onClick={() => { setWorkspaceOpen(!workspaceOpen); setModelOpen(false); setThinkingOpen(false); }}
          disabled={!activeSessionId}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-800/60 hover:text-gray-300 transition-colors disabled:opacity-40"
        >
          <FolderTree className="w-3 h-3 shrink-0 text-gray-500" />
          <div className="flex flex-col min-w-0 flex-1 text-left">
            <span className="truncate">{workspaceName}</span>
            <span className="text-[10px] text-gray-600 truncate">{workspacePath}</span>
          </div>
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${workspaceOpen ? "rotate-180" : ""}`} />
        </button>
        {workspaceOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-64 overflow-hidden bg-gray-800 border border-gray-600 rounded-md shadow-xl flex flex-col">
            <div className="overflow-y-auto flex-1 py-1">
              {worktrees.map((wt) => {
                const isActive = currentWorkspace?.path === wt.path;
                const name = wt.isMain ? "主工作区" : wt.branch;
                return (
                  <button
                    key={wt.path}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                      isActive ? "bg-indigo-500/15 text-indigo-300" : "text-gray-200 hover:bg-gray-700"
                    }`}
                    onClick={() => handleSwitchWorkspace(wt)}
                  >
                    {isActive ? <Check className="w-3 h-3 shrink-0 text-indigo-400" /> : <span className="w-3 shrink-0" />}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{name}</span>
                      <span className="text-[10px] text-gray-500 truncate">{wt.path}</span>
                    </div>
                    {!wt.isMain && <GitBranch className="w-3 h-3 shrink-0 text-cyan-500/60" />}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-gray-700/60">
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-cyan-400 hover:bg-gray-700 flex items-center gap-2 transition-colors"
                onClick={() => { setShowCreateDialog(true); setSourceBranch(currentWorkspace?.branch ?? ""); }}
              >
                <Plus className="w-3 h-3 shrink-0" />
                <span>新建 Workspace...</span>
              </button>
            </div>
          </div>
        )}
        {showCreateDialog && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-gray-800 border border-gray-600 rounded-md shadow-xl p-3 space-y-2">
            <div className="text-xs font-medium text-gray-200">新建 Workspace</div>
            <div className="space-y-1.5">
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">基于分支</label>
                <select
                  value={sourceBranch}
                  onChange={(e) => setSourceBranch(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none"
                >
                  {worktrees.map((wt) => (
                    <option key={wt.path} value={wt.branch}>{wt.branch}{wt.isMain ? " (主)" : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">新分支名</label>
                <input
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  placeholder="feature-xxx"
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => { setShowCreateDialog(false); setNewBranch(""); }}
                className="px-2 py-1 rounded text-xs text-gray-400 hover:bg-gray-700"
              >取消</button>
              <button
                onClick={handleCreateWorktree}
                disabled={!newBranch.trim() || creating}
                className="px-2 py-1 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
              >{creating ? "创建中..." : "创建"}</button>
            </div>
          </div>
        )}
      </div>

      <div className="relative" ref={modelRef}>
        <button
          onClick={() => { setModelOpen(!modelOpen); setThinkingOpen(false); setWorkspaceOpen(false); }}
          disabled={!activeSessionId}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-800/60 hover:text-gray-300 transition-colors disabled:opacity-40"
        >
          <Cpu className="w-3 h-3 shrink-0 text-gray-500" />
          <span className="truncate flex-1 text-left">模型: {modelDisplay}</span>
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${modelOpen ? "rotate-180" : ""}`} />
        </button>
        {modelOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-64 overflow-hidden bg-gray-800 border border-gray-600 rounded-md shadow-xl flex flex-col">
            <div className="px-2 py-1.5 border-b border-gray-700/60 shrink-0">
              <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-gray-900/60 border border-gray-700/50">
                <Search className="w-3 h-3 shrink-0 text-gray-500" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="搜索模型..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-[11px] text-gray-300 placeholder-gray-600 outline-none min-w-0"
                />
                <button
                  onClick={() => setShowFavoritesOnly((v) => !v)}
                  className={`p-0.5 rounded transition-colors shrink-0 ${
                    showFavoritesOnly ? "text-amber-400" : "text-gray-500 hover:text-gray-300"
                  }`}
                  title={showFavoritesOnly ? "显示全部" : "仅显示收藏"}
                >
                  <Star className={`w-3.5 h-3.5 ${showFavoritesOnly ? "fill-amber-400" : ""}`} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 py-1">
              {availableModels.length === 0 ? (
                <div className="text-gray-500 text-xs text-center py-3">暂无可用模型</div>
              ) : displayModels.length === 0 ? (
                <div className="text-gray-500 text-xs text-center py-3">{showFavoritesOnly ? "暂无收藏模型" : "无匹配结果"}</div>
              ) : (
                displayModels.map((m) => renderModelItem(m))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="relative" ref={thinkingRef}>
        <button
          onClick={() => { setThinkingOpen(!thinkingOpen); setModelOpen(false); setWorkspaceOpen(false); }}
          disabled={!activeSessionId}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-800/60 hover:text-gray-300 transition-colors disabled:opacity-40"
        >
          <Brain className="w-3 h-3 shrink-0 text-gray-500" />
          <span className="truncate flex-1 text-left">思考: {thinkingDisplay}</span>
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${thinkingOpen ? "rotate-180" : ""}`} />
        </button>
        {thinkingOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-gray-800 border border-gray-600 rounded-md shadow-xl py-1">
            {THINKING_LEVELS.map((l) => {
              const isActive = currentThinkingLevel === l.value;
              return (
                <button
                  key={l.value}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-indigo-500/15 text-indigo-300"
                      : "text-gray-200 hover:bg-gray-700"
                  }`}
                  onClick={() => handleSelectThinking(l.value)}
                >
                  {isActive ? <Check className="w-3 h-3 shrink-0 text-indigo-400" /> : <span className="w-3 shrink-0" />}
                  <span>{l.label}</span>
                  <span className="text-gray-500 ml-auto text-[10px] font-mono">{l.value}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
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
            ? "bg-indigo-500/15 text-indigo-300"
            : "text-gray-200 hover:bg-gray-700"
        }`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); handleSelectModel(m); }}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
        >
          {isActive ? <Check className="w-3 h-3 shrink-0 text-indigo-400" /> : <span className="w-3 shrink-0" />}
          <div className="flex flex-col min-w-0">
            <span className="truncate text-xs">{m.name || formatModelName(m.id)}</span>
            <span className="text-[10px] text-cyan-500/60 font-mono">{m.provider} · {m.id}</span>
          </div>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(key); }}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-600/50 transition-all shrink-0"
          title={isFav ? "取消收藏" : "收藏"}
        >
          <Star className={`w-3 h-3 ${isFav ? "fill-amber-400 text-amber-400 opacity-100" : "text-gray-500"}`} />
        </button>
      </div>
    );
  }
}

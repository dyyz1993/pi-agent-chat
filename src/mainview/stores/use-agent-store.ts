import { create } from "zustand";
import { createLogger } from "../../shared/lib/logger";
import { apiClient } from "../lib/api-client";
import type { SessionMeta } from "../types";
import { clearAgentStarted, markAgentStarted, useSessionStore } from "./use-session-store";

const log = createLogger("agent");

type AgentSource = "builtin" | "user" | "project";

type AgentAvatar = { type: "emoji"; value: string } | { type: "image"; src: string };

interface AgentInfo {
  name: string;
  description?: string;
  tier?: string;
  tools?: string[];
  permissionMode?: string;
  source: AgentSource;
  filePath: string;
  color?: string;
  avatar?: AgentAvatar;
}

interface ToolSourceInfo {
  type?: string;
  extension?: string;
  plugin?: string;
}

interface AgentToolInfo {
  name: string;
  description?: string;
  sourceInfo?: ToolSourceInfo;
}

interface AgentHookCommand {
  type: "command";
  command: string;
  if?: string;
  async?: boolean;
}

interface AgentHookPrompt {
  type: "prompt";
  prompt: string;
  if?: string;
}

type AgentHook = AgentHookCommand | AgentHookPrompt;

interface AgentDetail {
  name: string;
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  systemPrompt: string;
  source: string;
  filePath: string;
  permissionMode?: string;
  maxTurns?: number;
  effort?: string;
  color?: string;
  background?: boolean;
  memory?: string;
  isolation?: string;
  initialPrompt?: string;
  skills?: string[];
  hooks?: Record<string, AgentHook[]>;
  variables?: Record<string, string>;
  tier?: string;
  thinkingLevel?: string;
  mode?: string;
  hidden?: boolean;
  avatar?: AgentAvatar;
}

interface AgentState {
  currentAgentBySession: Record<string, string>;
  agents: AgentInfo[];
  switchingBySession: Record<string, boolean>;
  loaded: boolean;
  agentDetailBySession: Record<string, AgentDetail>;
  allToolsBySession: Record<string, AgentToolInfo[]>;
  liveSystemPromptBySession: Record<string, string>;
  loadingDetail: boolean;
  loadingSystemPrompt: Set<string>;
  setAgentForSession: (sessionId: string, name: string) => void;
  setAgents: (agents: AgentInfo[]) => void;
  setCurrentAgent: (sessionId: string, agentName: string) => void;
  fetchAgents: (sessionId: string) => Promise<void>;
  switchAgent: (agentName: string, sessionId: string) => Promise<void>;
  getCurrentAgentForSession: (sessionId: string) => string;
  fetchAgentDetail: (sessionId: string) => Promise<void>;
  fetchAllTools: (sessionId: string) => Promise<void>;
  fetchSystemPrompt: (sessionId: string) => Promise<void>;
  clearAgentDetail: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
}

export type { AgentInfo, AgentSource, AgentAvatar, AgentDetail, AgentToolInfo, AgentHook };

const SOURCE_LABELS: Record<AgentSource, string> = {
  builtin: "内置",
  user: "全局",
  project: "项目",
};

export const getSourceLabel = (source: AgentSource): string => SOURCE_LABELS[source] ?? source;

export const isGlobalAgent = (source: AgentSource): boolean =>
  source === "builtin" || source === "user";

const runtimeRecoveryBySession = new Map<string, Promise<boolean>>();

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isMissingRuntimeClientError(error: unknown): boolean {
  const message = errorMessage(error);
  return /(?:Client not found|No client for session)/i.test(message);
}

function findSessionInStore(sessionId: string): SessionMeta | null {
  const state = useSessionStore.getState();
  for (const sessions of Object.values(state.sessionsByProject)) {
    const session = sessions.find((item) => item.id === sessionId || item.sessionId === sessionId);
    if (session) return session;
  }
  return null;
}

async function findSessionForRecovery(sessionId: string): Promise<SessionMeta | null> {
  const cached = findSessionInStore(sessionId);
  if (cached) return cached;

  const state = useSessionStore.getState();
  const activeProject = state.projectTabs.find((tab) => tab.id === state.activeProjectId);
  if (!activeProject) return null;

  try {
    const sessions = await state.loadSessionsForProject(activeProject.path);
    return sessions.find((item) => item.id === sessionId || item.sessionId === sessionId) ?? null;
  } catch (error) {
    log.warn("failed to load sessions while recovering runtime client", {
      sessionId,
      error: errorMessage(error),
    });
    return null;
  }
}

async function recoverRuntimeClient(sessionId: string): Promise<boolean> {
  const existing = runtimeRecoveryBySession.get(sessionId);
  if (existing) return existing;

  const recovery = (async () => {
    clearAgentStarted(sessionId);
    useSessionStore.setState((state) => ({
      agentReady: { ...state.agentReady, [sessionId]: false },
    }));

    const session = await findSessionForRecovery(sessionId);
    if (!session) {
      log.warn("cannot recover runtime client without session metadata", { sessionId });
      return false;
    }

    try {
      const result = (await apiClient.call("agent.start", {
        sessionId,
        projectPath: session.projectPath,
        sessionPath: session.sessionPath,
      })) as { status?: string };
      const recovered = result.status === "started" || result.status === "already_running";
      if (!recovered) {
        log.warn("runtime client recovery returned unexpected status", {
          sessionId,
          status: result.status,
        });
        return false;
      }

      markAgentStarted(sessionId);
      useSessionStore.setState((state) => ({
        sessionReady: { ...state.sessionReady, [sessionId]: true },
        agentReady: { ...state.agentReady, [sessionId]: true },
      }));
      useSessionStore.getState().fetchInitialState(sessionId);
      log.info("runtime client recovered", { sessionId, status: result.status });
      return true;
    } catch (error) {
      log.warn("failed to recover runtime client", {
        sessionId,
        error: errorMessage(error),
      });
      return false;
    }
  })();

  runtimeRecoveryBySession.set(sessionId, recovery);
  try {
    return await recovery;
  } finally {
    runtimeRecoveryBySession.delete(sessionId);
  }
}

export const useAgentStore = create<AgentState>()((set, get) => ({
  currentAgentBySession: {},
  agents: [],
  switchingBySession: {},
  agentDetailBySession: {},
  allToolsBySession: {},
  liveSystemPromptBySession: {},
  loadingDetail: false,
  loadingSystemPrompt: new Set<string>(),
  loaded: false,

  setAgentForSession: (sessionId, name) =>
    set((state) => ({
      currentAgentBySession: { ...state.currentAgentBySession, [sessionId]: name },
    })),
  setAgents: (agents) => set({ agents, loaded: true }),
  setCurrentAgent: (sessionId, agentName) =>
    set((state) => ({
      currentAgentBySession: { ...state.currentAgentBySession, [sessionId]: agentName },
    })),

  fetchAgents: async (sessionId) => {
    try {
      const result = (await apiClient.call("agent.getAgents", { sessionId })) as {
        agents: Array<{
          name: string;
          description?: string;
          tier?: string;
          tools?: string[];
          permissionMode?: string;
          source: string;
          filePath: string;
          color?: string;
          avatar?: AgentAvatar;
        }>;
      };
      const agents: AgentInfo[] = (result.agents ?? []).map((a) => ({
        name: a.name,
        description: a.description,
        tier: a.tier,
        tools: a.tools,
        permissionMode: a.permissionMode,
        source: (a.source ?? "builtin") as AgentSource,
        filePath: a.filePath ?? "",
        color: a.color,
        avatar: a.avatar,
      }));
      set({ agents, loaded: true });

      const currentResult = (await apiClient.call("agent.getCurrentAgent", { sessionId })) as {
        agentName: string | null;
      };
      const agentName = currentResult.agentName ?? "build";
      set((state) => ({
        currentAgentBySession: { ...state.currentAgentBySession, [sessionId]: agentName },
      }));
      get().fetchAgentDetail(sessionId);
      get().fetchAllTools(sessionId);
      log.info("fetched agents", {
        count: agents.length,
        session: sessionId,
        current: currentResult.agentName,
      });
    } catch (err) {
      log.warn("failed to fetch agents", {
        error: err instanceof Error ? err.message : String(err),
      });
      const defaultAgents: AgentInfo[] = [
        {
          name: "build",
          description: "Full-stack development",
          tier: "pro",
          source: "builtin",
          filePath: "",
        },
        {
          name: "explore",
          description: "Read-only exploration",
          tier: "fast",
          source: "builtin",
          filePath: "",
        },
        {
          name: "plan",
          description: "Planning mode",
          tier: "pro",
          permissionMode: "plan",
          source: "builtin",
          filePath: "",
        },
      ];
      set((state) => ({
        agents: defaultAgents,
        loaded: true,
        currentAgentBySession: { ...state.currentAgentBySession, [sessionId]: "build" },
      }));
    }
  },

  switchAgent: async (agentName, sessionId) => {
    const prev = get().currentAgentBySession[sessionId] ?? "build";
    set((state) => ({
      switchingBySession: { ...state.switchingBySession, [sessionId]: true },
      currentAgentBySession: { ...state.currentAgentBySession, [sessionId]: agentName },
    }));
    try {
      const result = (await apiClient.call("agent.switchAgent", {
        sessionId,
        agentName,
      })) as {
        agentName: string;
        tools: string[];
        tier?: string;
        thinkingLevel?: string;
      };
      log.info("switched agent", {
        from: prev,
        to: result.agentName,
        session: sessionId,
        tools: result.tools?.length,
      });

      if (result.tier) {
        const { useTierStore } = await import("./use-tier-store");
        useTierStore
          .getState()
          .setSessionCurrentTier(sessionId, result.tier as "fast" | "pro" | "max");
      }
      if (result.thinkingLevel) {
        useSessionStore.getState().setThinkingLevel(result.thinkingLevel);
      }
      get().fetchAgentDetail(sessionId);
      get().fetchAllTools(sessionId);
    } catch (err) {
      log.warn("agent switch failed, reverting", {
        agentName,
        session: sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      set((state) => ({
        currentAgentBySession: { ...state.currentAgentBySession, [sessionId]: prev },
      }));
    } finally {
      set((state) => ({
        switchingBySession: { ...state.switchingBySession, [sessionId]: false },
      }));
    }
  },

  fetchAgentDetail: async (sessionId) => {
    set({ loadingDetail: true });
    try {
      const agentName = get().getCurrentAgentForSession(sessionId);
      if (!agentName) return;
      const result = await apiClient.call("agent.getAgentDetail", { sessionId, agentName });
      set((state) => ({
        agentDetailBySession: {
          ...state.agentDetailBySession,
          [sessionId]: result.agent as AgentDetail,
        },
      }));
    } catch (e) {
      if (isMissingRuntimeClientError(e) && (await recoverRuntimeClient(sessionId))) {
        try {
          const agentName = get().getCurrentAgentForSession(sessionId);
          if (!agentName) return;
          const result = await apiClient.call("agent.getAgentDetail", { sessionId, agentName });
          set((state) => ({
            agentDetailBySession: {
              ...state.agentDetailBySession,
              [sessionId]: result.agent as AgentDetail,
            },
          }));
          return;
        } catch (retryError) {
          log.warn("Failed to fetch agent detail after runtime recovery", {
            sessionId,
            error: errorMessage(retryError),
          });
          return;
        }
      }
      log.warn("Failed to fetch agent detail", { sessionId, error: errorMessage(e) });
    } finally {
      set({ loadingDetail: false });
    }
  },

  fetchAllTools: async (sessionId) => {
    try {
      const result = await apiClient.call("agent.getAllTools", { sessionId });
      set((state) => ({
        allToolsBySession: {
          ...state.allToolsBySession,
          [sessionId]: result.tools as AgentToolInfo[],
        },
      }));
    } catch (e) {
      if (isMissingRuntimeClientError(e) && (await recoverRuntimeClient(sessionId))) {
        try {
          const result = await apiClient.call("agent.getAllTools", { sessionId });
          set((state) => ({
            allToolsBySession: {
              ...state.allToolsBySession,
              [sessionId]: result.tools as AgentToolInfo[],
            },
          }));
          return;
        } catch (retryError) {
          log.warn("Failed to fetch all tools after runtime recovery", {
            sessionId,
            error: errorMessage(retryError),
          });
          return;
        }
      }
      log.warn("Failed to fetch all tools", { sessionId, error: errorMessage(e) });
    }
  },

  fetchSystemPrompt: async (sessionId) => {
    // Deduplicate: skip if already loading for this session
    if (get().loadingSystemPrompt.has(sessionId)) return;
    set((state) => ({ loadingSystemPrompt: new Set(state.loadingSystemPrompt).add(sessionId) }));
    try {
      const result = await apiClient.call("agent.getSystemPrompt", { sessionId });
      set((state) => ({
        liveSystemPromptBySession: {
          ...state.liveSystemPromptBySession,
          [sessionId]: (result as { systemPrompt: string }).systemPrompt,
        },
      }));
    } catch (e) {
      if (isMissingRuntimeClientError(e) && (await recoverRuntimeClient(sessionId))) {
        try {
          const result = await apiClient.call("agent.getSystemPrompt", { sessionId });
          set((state) => ({
            liveSystemPromptBySession: {
              ...state.liveSystemPromptBySession,
              [sessionId]: (result as { systemPrompt: string }).systemPrompt,
            },
          }));
          return;
        } catch (retryError) {
          log.warn("Failed to fetch system prompt after runtime recovery", {
            sessionId,
            error: errorMessage(retryError),
          });
          return;
        }
      }
      log.warn("Failed to fetch system prompt", { sessionId, error: errorMessage(e) });
    } finally {
      set((state) => {
        const next = new Set(state.loadingSystemPrompt);
        next.delete(sessionId);
        return { loadingSystemPrompt: next };
      });
    }
  },

  clearAgentDetail: (sessionId) => {
    set((state) => {
      const { [sessionId]: _, ...rest } = state.agentDetailBySession;
      return { agentDetailBySession: rest };
    });
  },

  clearSession: (sessionId) => {
    set((state) => {
      const { [sessionId]: _ad, ...restAgentDetail } = state.agentDetailBySession;
      const { [sessionId]: _ca, ...restCurrentAgent } = state.currentAgentBySession;
      const { [sessionId]: _sw, ...restSwitching } = state.switchingBySession;
      const { [sessionId]: _at, ...restAllTools } = state.allToolsBySession;
      const { [sessionId]: _sp, ...restSystemPrompt } = state.liveSystemPromptBySession;
      return {
        agentDetailBySession: restAgentDetail,
        currentAgentBySession: restCurrentAgent,
        switchingBySession: restSwitching,
        allToolsBySession: restAllTools,
        liveSystemPromptBySession: restSystemPrompt,
      };
    });
  },

  getCurrentAgentForSession: (sessionId) => get().currentAgentBySession[sessionId] ?? "build",
}));

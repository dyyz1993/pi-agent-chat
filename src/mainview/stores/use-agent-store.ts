import { create } from "zustand";
import { createLogger } from "../../shared/lib/logger";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";

const log = createLogger("agent");

type AgentSource = "builtin" | "user" | "project";

interface AgentInfo {
  name: string;
  description?: string;
  tier?: string;
  tools?: string[];
  permissionMode?: string;
  source: AgentSource;
  filePath: string;
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
}

export type { AgentInfo, AgentSource, AgentDetail, AgentToolInfo, AgentHook };

export const AGENT_ICONS: Record<string, string> = {
  build: "🔧",
  explore: "🔍",
  plan: "📋",
};

const SOURCE_LABELS: Record<AgentSource, string> = {
  builtin: "内置",
  user: "全局",
  project: "项目",
};

export const getSourceLabel = (source: AgentSource): string => SOURCE_LABELS[source] ?? source;

export const isGlobalAgent = (source: AgentSource): boolean =>
  source === "builtin" || source === "user";

export const useAgentStore = create<AgentState>()((set, get) => ({
  currentAgentBySession: {},
  agents: [],
  switchingBySession: {},
  agentDetailBySession: {},
  allToolsBySession: {},
  liveSystemPromptBySession: {},
  loadingDetail: false,
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
      get().fetchSystemPrompt(sessionId);
    } catch {
      // silently fail - detail is optional
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
    } catch {
      // silently fail
    }
  },

  fetchSystemPrompt: async (sessionId) => {
    try {
      const result = await apiClient.call("agent.getSystemPrompt", { sessionId });
      set((state) => ({
        liveSystemPromptBySession: {
          ...state.liveSystemPromptBySession,
          [sessionId]: (result as { systemPrompt: string }).systemPrompt,
        },
      }));
    } catch {
      // silently fail
    }
  },

  clearAgentDetail: (sessionId) => {
    set((state) => {
      const { [sessionId]: _, ...rest } = state.agentDetailBySession;
      return { agentDetailBySession: rest };
    });
  },

  getCurrentAgentForSession: (sessionId) => get().currentAgentBySession[sessionId] ?? "build",
}));

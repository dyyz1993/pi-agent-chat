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

interface AgentState {
  currentAgentBySession: Record<string, string>;
  agents: AgentInfo[];
  switchingBySession: Record<string, boolean>;
  loaded: boolean;
  setAgentForSession: (sessionId: string, name: string) => void;
  setAgents: (agents: AgentInfo[]) => void;
  fetchAgents: (sessionId: string) => Promise<void>;
  switchAgent: (agentName: string, sessionId: string) => Promise<void>;
  getCurrentAgentForSession: (sessionId: string) => string;
}

export type { AgentInfo, AgentSource };

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
  loaded: false,

  setAgentForSession: (sessionId, name) =>
    set((state) => ({
      currentAgentBySession: { ...state.currentAgentBySession, [sessionId]: name },
    })),
  setAgents: (agents) => set({ agents, loaded: true }),

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
      const agentName = currentResult.agentName;
      if (agentName && typeof agentName === "string") {
        set((state) => ({
          currentAgentBySession: { ...state.currentAgentBySession, [sessionId]: agentName },
        }));
      }
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
        useTierStore.getState().setCurrentTier(result.tier as "fast" | "pro" | "max");
      }
      if (result.thinkingLevel) {
        useSessionStore.getState().setThinkingLevel(result.thinkingLevel);
      }
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

  getCurrentAgentForSession: (sessionId) => get().currentAgentBySession[sessionId] ?? "build",
}));

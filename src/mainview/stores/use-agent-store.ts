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
  currentAgent: string;
  agents: AgentInfo[];
  switching: boolean;
  loaded: boolean;
  setCurrentAgent: (name: string) => void;
  setAgents: (agents: AgentInfo[]) => void;
  fetchAgents: (sessionId: string) => Promise<void>;
  switchAgent: (agentName: string, sessionId: string) => Promise<void>;
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
  currentAgent: "build",
  agents: [],
  switching: false,
  loaded: false,

  setCurrentAgent: (name) => set({ currentAgent: name }),
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
      if (currentResult.agentName) {
        set({ currentAgent: currentResult.agentName });
      }
      log.info("fetched agents", { count: agents.length, current: currentResult.agentName });
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
      set({ agents: defaultAgents, loaded: true, currentAgent: "build" });
    }
  },

  switchAgent: async (agentName, sessionId) => {
    const prev = get().currentAgent;
    set({ switching: true, currentAgent: agentName });
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
      log.info("switched agent", { from: prev, to: result.agentName, tools: result.tools?.length });

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
        error: err instanceof Error ? err.message : String(err),
      });
      set({ currentAgent: prev });
    } finally {
      set({ switching: false });
    }
  },
}));

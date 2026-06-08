import { create } from "zustand";
import { apiClient } from "../lib/api-client";

export interface HookLogEntry {
  id: number;
  timestamp: number;
  durationMs: number;
  event: string;
  toolName: string;
  matcher: string;
  hookType: "command" | "http" | "prompt" | "agent" | "mcp_tool";
  command: string;
  decision: "allow" | "block" | "ask";
  reason: string;
  exitCode: number;
  source: "policy" | "global" | "project" | "local" | "unknown";
  snippet: string;
}

export interface HookRuleStats {
  matcher: string;
  event: string;
  hookType: string;
  command: string;
  source: string;
  allowCount: number;
  blockCount: number;
  askCount: number;
}

export interface SkippedRuleKey {
  event: string;
  matcher: string;
}

export interface HookConfigSnapshot {
  runtimeEnabled: boolean;
  skippedRules: SkippedRuleKey[];
  sources: Array<{
    path: string;
    scope: string;
    exists: boolean;
    disabled: boolean;
  }>;
  events: Array<{
    name: string;
    groups: Array<{
      matcher: string;
      source: string;
      hooks: Array<{
        type: string;
        command?: string;
        url?: string;
        prompt?: string;
        timeout?: number;
        async?: boolean;
        once?: boolean;
        if?: string;
      }>;
    }>;
  }>;
}

interface HooksSessionState {
  entries: HookLogEntry[];
  ruleStats: HookRuleStats[];
  totalExecutions: number;
  configSnapshot: HookConfigSnapshot | null;
  loading: boolean;
  expandedEntry: number | null;
}

interface HooksState {
  bySession: Record<string, HooksSessionState>;
  activeTab: "activity" | "rules";

  setActiveTab: (tab: "activity" | "rules") => void;
  fetchLog: (sessionId: string, limit?: number, event?: string) => Promise<void>;
  fetchConfig: (sessionId: string) => Promise<void>;
  clearLog: (sessionId: string) => Promise<void>;
  setEnabled: (sessionId: string, enabled: boolean) => Promise<void>;
  skipRule: (sessionId: string, event: string, matcher: string) => Promise<void>;
  unskipRule: (sessionId: string, event: string, matcher: string) => Promise<void>;
  setExpandedEntry: (id: number | null) => void;
  addEntry: (sessionId: string, entry: HookLogEntry) => void;
  clearSession: (sessionId: string) => void;
}

const EMPTY_SESSION: HooksSessionState = {
  entries: [],
  ruleStats: [],
  totalExecutions: 0,
  configSnapshot: null,
  loading: false,
  expandedEntry: null,
};

export const useHooksStore = create<HooksState>()((set, get) => ({
  bySession: {},
  activeTab: "activity",

  setActiveTab: (tab) => set({ activeTab: tab }),

  fetchLog: async (sessionId, limit, event) => {
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: { ...(s.bySession[sessionId] || { ...EMPTY_SESSION }), loading: true },
      },
    }));
    try {
      const result = await apiClient.call("hooks.getLog", {
        sessionId,
        limit,
        event,
      });
      set((s) => ({
        bySession: {
          ...s.bySession,
          [sessionId]: {
            ...(s.bySession[sessionId] || { ...EMPTY_SESSION }),
            entries: result.entries,
            ruleStats: result.ruleStats,
            totalExecutions: result.totalExecutions,
            configSnapshot: result.configSnapshot,
            loading: false,
          },
        },
      }));
    } catch (err) {
      console.warn("[hooks-store] fetchLog failed:", err);
      set((s) => ({
        bySession: {
          ...s.bySession,
          [sessionId]: { ...(s.bySession[sessionId] || { ...EMPTY_SESSION }), loading: false },
        },
      }));
    }
  },

  fetchConfig: async (sessionId) => {
    try {
      const result = await apiClient.call("hooks.getConfig", { sessionId });
      set((s) => ({
        bySession: {
          ...s.bySession,
          [sessionId]: {
            ...(s.bySession[sessionId] || { ...EMPTY_SESSION }),
            ruleStats: result.ruleStats,
            totalExecutions: result.totalExecutions,
            configSnapshot: result.configSnapshot,
          },
        },
      }));
    } catch (err) {
      console.warn("[hooks-store] fetchConfig failed:", err);
    }
  },

  clearLog: async (sessionId) => {
    try {
      await apiClient.call("hooks.clear", { sessionId });
      set((s) => ({
        bySession: {
          ...s.bySession,
          [sessionId]: {
            ...(s.bySession[sessionId] || { ...EMPTY_SESSION }),
            entries: [],
            totalExecutions: 0,
          },
        },
      }));
    } catch (err) {
      console.warn("[hooks-store] clearLog failed:", err);
    }
  },

  setEnabled: async (sessionId, enabled) => {
    const result = await apiClient.call("hooks.setEnabled", { sessionId, enabled });
    set((s) => {
      const prev = s.bySession[sessionId] || { ...EMPTY_SESSION };
      const prevSnapshot = prev.configSnapshot ?? { runtimeEnabled: true, skippedRules: [], sources: [], events: [] };
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: {
            ...prev,
            configSnapshot: { ...prevSnapshot, runtimeEnabled: result.enabled },
          },
        },
      };
    });
  },

  skipRule: async (sessionId, event, matcher) => {
    const result = await apiClient.call("hooks.skipRule", { sessionId, event, matcher });
    set((s) => {
      const prev = s.bySession[sessionId] || { ...EMPTY_SESSION };
      const prevSnapshot = prev.configSnapshot ?? { runtimeEnabled: true, skippedRules: [], sources: [], events: [] };
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: {
            ...prev,
            configSnapshot: { ...prevSnapshot, skippedRules: result.skipped },
          },
        },
      };
    });
  },

  unskipRule: async (sessionId, event, matcher) => {
    const result = await apiClient.call("hooks.unskipRule", { sessionId, event, matcher });
    set((s) => {
      const prev = s.bySession[sessionId] || { ...EMPTY_SESSION };
      const prevSnapshot = prev.configSnapshot ?? { runtimeEnabled: true, skippedRules: [], sources: [], events: [] };
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: {
            ...prev,
            configSnapshot: { ...prevSnapshot, skippedRules: result.skipped },
          },
        },
      };
    });
  },

  setExpandedEntry: (id) => {
    const sessionId = get().bySession;
    const activeKey = Object.keys(sessionId).pop();
    if (!activeKey) return;
    set((s) => ({
      bySession: {
        ...s.bySession,
        [activeKey]: {
          ...(s.bySession[activeKey] || { ...EMPTY_SESSION }),
          expandedEntry: id,
        },
      },
    }));
  },

  addEntry: (sessionId, entry) => {
    set((s) => {
      const prev = s.bySession[sessionId] || { ...EMPTY_SESSION };
      const exists = prev.entries.some((e) => e.id === entry.id);
      if (exists) return s;
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: {
            ...prev,
            entries: [entry, ...prev.entries].slice(0, 200),
            totalExecutions: prev.totalExecutions + 1,
          },
        },
      };
    });
  },

  clearSession: (sessionId) => {
    set((s) => {
      const { [sessionId]: _, ...rest } = s.bySession;
      return { bySession: rest };
    });
  },
}));

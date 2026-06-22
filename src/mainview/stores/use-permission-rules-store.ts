import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("settings");

export type PermissionRuleAction = "allow" | "deny";
export type PermissionRuleScope = "project" | "session";

export interface PermissionRule {
  id: string;
  provider: string;
  subject: string;
  pattern: string;
  action: PermissionRuleAction;
  scope: PermissionRuleScope;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface PermissionRulesSessionState {
  rules: PermissionRule[];
  loading: boolean;
  error: string | null;
  loadedAt: number | null;
}

interface PermissionRulesStore {
  bySession: Record<string, PermissionRulesSessionState>;
  activeProvider: string;
  pendingDeleteId: string | null;
  setActiveProvider: (provider: string) => void;
  setPendingDeleteId: (id: string | null) => void;
  fetchRules: (sessionId: string, force?: boolean) => Promise<void>;
  deleteRule: (sessionId: string, ruleId: string) => Promise<void>;
}

const EMPTY_SESSION: PermissionRulesSessionState = {
  rules: [],
  loading: false,
  error: null,
  loadedAt: null,
};

export const usePermissionRulesStore = create<PermissionRulesStore>((set, get) => ({
  bySession: {},
  activeProvider: "all",
  pendingDeleteId: null,

  setActiveProvider: (provider) => set({ activeProvider: provider }),
  setPendingDeleteId: (id) => set({ pendingDeleteId: id }),

  fetchRules: async (sessionId, force = false) => {
    const existing = get().bySession[sessionId] ?? EMPTY_SESSION;
    if (!force && existing.loadedAt && !existing.error) return;

    set((state) => ({
      bySession: {
        ...state.bySession,
        [sessionId]: { ...existing, loading: true, error: null },
      },
    }));

    try {
      const settings = await apiClient.call("agent.getSettings", {
        sessionId,
        scope: "project",
      });
      const rules = readPermissionRules(settings);
      set((state) => ({
        bySession: {
          ...state.bySession,
          [sessionId]: {
            rules,
            loading: false,
            error: null,
            loadedAt: Date.now(),
          },
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("permission rules fetch failed", { sessionId, error: message });
      set((state) => ({
        bySession: {
          ...state.bySession,
          [sessionId]: { ...existing, loading: false, error: message },
        },
      }));
    }
  },

  deleteRule: async (sessionId, ruleId) => {
    const current = get().bySession[sessionId] ?? EMPTY_SESSION;
    const nextRules = current.rules.filter((rule) => rule.id !== ruleId);
    const previous = current.rules;

    set((state) => ({
      pendingDeleteId: null,
      bySession: {
        ...state.bySession,
        [sessionId]: {
          ...current,
          rules: nextRules,
          error: null,
        },
      },
    }));

    try {
      await apiClient.call("agent.setSettings", {
        sessionId,
        scope: "project",
        settings: {
          permissions: {
            rules: nextRules,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("permission rule delete failed", { sessionId, ruleId, error: message });
      set((state) => ({
        bySession: {
          ...state.bySession,
          [sessionId]: {
            ...current,
            rules: previous,
            error: message,
          },
        },
      }));
    }
  },
}));

export function readPermissionRules(settings: unknown): PermissionRule[] {
  if (!settings || typeof settings !== "object") return [];
  const permissions = (settings as { permissions?: unknown }).permissions;
  if (!permissions || typeof permissions !== "object") return [];
  const rules = (permissions as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return [];
  return rules.filter(isPermissionRule).map((rule) => ({
    ...rule,
    metadata: cloneMetadata(rule.metadata),
  }));
}

function isPermissionRule(value: unknown): value is PermissionRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;
  return (
    typeof rule.id === "string" &&
    typeof rule.provider === "string" &&
    typeof rule.subject === "string" &&
    typeof rule.pattern === "string" &&
    (rule.action === "allow" || rule.action === "deny") &&
    (rule.scope === "project" || rule.scope === "session") &&
    typeof rule.createdAt === "string"
  );
}

function cloneMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return { ...(value as Record<string, unknown>) };
}

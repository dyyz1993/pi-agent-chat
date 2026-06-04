import { create } from "zustand";
import { createLogger } from "../../shared/lib/logger";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";

const log = createLogger("tier");

const TIER_KEYS = ["fast", "pro", "max"] as const;
type TierKey = (typeof TIER_KEYS)[number];

interface TierSessionData {
  tierModels: Record<string, string>;
  currentTier: TierKey | null;
}

interface TierState {
  globalDefaults: Record<string, string>;
  dataBySession: Record<string, TierSessionData>;
  switching: boolean;

  getTierModels: (sessionId: string) => Record<string, string>;
  getCurrentTier: (sessionId: string) => TierKey | null;

  setGlobalDefaults: (models: Record<string, string>) => void;
  setSessionTierModels: (sessionId: string, models: Record<string, string>) => void;
  setSessionCurrentTier: (sessionId: string, tier: TierKey | null) => void;
  syncTierFromModel: (sessionId: string, provider: string, modelId: string) => void;
  switchToTier: (tier: TierKey, sessionId: string) => Promise<void>;
  fetchTierConfig: (sessionId: string) => Promise<void>;
  loadPersistedConfig: (sessionId: string, sessionPath: string) => Promise<void>;
  savePersistedConfig: (sessionId: string, sessionPath: string) => Promise<void>;
  savePersistedConfigForSession: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
}

export { TIER_KEYS };
export type { TierKey, TierSessionData };

export const useTierStore = create<TierState>()((set, get) => ({
  globalDefaults: {},
  dataBySession: {},
  switching: false,

  getTierModels: (sessionId) => {
    const { globalDefaults, dataBySession } = get();
    return dataBySession[sessionId]?.tierModels ?? globalDefaults;
  },

  getCurrentTier: (sessionId) => {
    const { dataBySession } = get();
    return dataBySession[sessionId]?.currentTier ?? null;
  },

  setGlobalDefaults: (models) => set({ globalDefaults: models }),

  setSessionTierModels: (sessionId, models) => {
    set((s) => ({
      dataBySession: {
        ...s.dataBySession,
        [sessionId]: {
          tierModels: models,
          currentTier: s.dataBySession[sessionId]?.currentTier ?? null,
        },
      },
    }));
  },

  setSessionCurrentTier: (sessionId, tier) => {
    set((s) => ({
      dataBySession: {
        ...s.dataBySession,
        [sessionId]: {
          tierModels: s.dataBySession[sessionId]?.tierModels ?? s.globalDefaults,
          currentTier: tier,
        },
      },
    }));
  },

  syncTierFromModel: (sessionId, provider, modelId) => {
    const fullName = `${provider}/${modelId}`;
    const models = get().getTierModels(sessionId);
    for (const tier of TIER_KEYS) {
      if (models[tier] && models[tier] === fullName) {
        get().setSessionCurrentTier(sessionId, tier);
        return;
      }
    }
    get().setSessionCurrentTier(sessionId, null);
  },

  fetchTierConfig: async (sessionId) => {
    try {
      const result = (await apiClient.call("agent.getTierModels", { sessionId })) as {
        models: Record<string, string>;
      };
      set({ globalDefaults: result.models });
      log.info("fetched tier config as global defaults", { models: result.models });
    } catch (err) {
      log.warn("failed to fetch tier config", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  switchToTier: async (tier, sessionId) => {
    set({ switching: true });
    try {
      const result = await apiClient.call("agent.switchTier", {
        sessionId,
        tier,
      });
      get().setSessionCurrentTier(sessionId, tier);
      const model = result as { provider: string; id: string };
      useSessionStore.getState().setCurrentModel(model.provider ?? "", model.id ?? "");
      log.info("switched to tier", { tier, resolved: model });

      get().savePersistedConfigForSession(sessionId);
    } catch (err) {
      log.warn("tier switch failed, staying on current model", {
        tier,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      set({ switching: false });
    }
  },

  loadPersistedConfig: async (sessionId, sessionPath) => {
    try {
      const result = (await apiClient.call("session.loadTierConfig", {
        sessionPath,
      })) as {
        config: {
          tierModels: Record<string, string>;
          currentTier: string | null;
          currentModel: { provider: string; id: string } | null;
        } | null;
      };
      if (result.config) {
        get().setSessionTierModels(sessionId, result.config.tierModels);
        get().setSessionCurrentTier(sessionId, result.config.currentTier as TierKey | null);
        log.info("loaded persisted tier config", { sessionId });
        return;
      }
    } catch {
      // fallback to global defaults
    }
    log.info("no persisted tier config, using global defaults", { sessionId });
  },

  savePersistedConfig: async (sessionId, sessionPath) => {
    const data = get().dataBySession[sessionId];
    const currentModel = useSessionStore.getState().currentModel;
    try {
      await apiClient.call("session.saveTierConfig", {
        sessionPath,
        tierModels: data?.tierModels ?? get().globalDefaults,
        currentTier: data?.currentTier ?? null,
        currentModel,
      });
    } catch (err) {
      log.warn("failed to persist tier config", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  savePersistedConfigForSession: (sessionId) => {
    const sessions = useSessionStore.getState().sessionsByProject;
    for (const sessionsList of Object.values(sessions)) {
      const session = sessionsList.find((s) => s.sessionId === sessionId);
      if (session) {
        get().savePersistedConfig(sessionId, session.sessionPath);
        return;
      }
    }
  },

  clearSession: (sessionId) => {
    set((s) => {
      const { [sessionId]: _, ...rest } = s.dataBySession;
      return { dataBySession: rest };
    });
  },
}));

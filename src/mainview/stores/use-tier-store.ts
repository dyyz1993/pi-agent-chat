import { create } from "zustand";
import { createLogger } from "../../shared/lib/logger";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";

const log = createLogger("tier");

const TIER_KEYS = ["fast", "pro", "max"] as const;
type TierKey = (typeof TIER_KEYS)[number];

interface TierState {
  currentTier: TierKey | null;
  switching: boolean;
  tierModels: Record<string, string>;
  setCurrentTier: (tier: TierKey | null) => void;
  syncTierFromModel: (provider: string, modelId: string) => void;
  switchToTier: (tier: TierKey, sessionId: string) => Promise<void>;
  fetchTierConfig: (sessionId: string) => Promise<void>;
}

export { TIER_KEYS };
export type { TierKey };

export const useTierStore = create<TierState>()((set) => ({
  currentTier: null,
  switching: false,
  tierModels: {},

  setCurrentTier: (tier) => set({ currentTier: tier }),

  syncTierFromModel: (provider, modelId) => {
    const modelFullName = `${provider}/${modelId}`;
    const lower = modelFullName.toLowerCase();
    if (lower.includes("haiku") || lower.includes("flash") || lower.includes("mini")) {
      set({ currentTier: "fast" });
    } else if (
      lower.includes("opus") ||
      lower.includes("max") ||
      lower.includes("thinking") ||
      lower.includes("pro-")
    ) {
      set({ currentTier: "max" });
    } else {
      set({ currentTier: "pro" });
    }
  },

  fetchTierConfig: async (sessionId) => {
    try {
      const result = (await apiClient.call("agent.getTierModels", { sessionId })) as {
        models: Record<string, string>;
      };
      set({ tierModels: result.models });
      log.info("fetched tier config", { models: result.models });
    } catch (err) {
      log.warn("failed to fetch tier config", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  switchToTier: async (tier, sessionId) => {
    set({ switching: true });
    try {
      const result = await apiClient.call("agent.setModel", {
        sessionId,
        provider: "",
        modelId: tier,
      });
      set({ currentTier: tier });
      const model = result as { provider: string; id: string };
      useSessionStore.getState().setCurrentModel(model.provider ?? "", model.id ?? "");
      log.info("switched to tier", { tier, resolved: model });
    } catch (err) {
      log.warn("tier switch failed, staying on current model", {
        tier,
        error: err instanceof Error ? err.message : String(err),
      });
      set({ currentTier: tier });
    } finally {
      set({ switching: false });
    }
  },
}));

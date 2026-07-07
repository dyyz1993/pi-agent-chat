import { create } from "zustand";
import { createLogger } from "../../shared/lib/logger";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { useNotificationStore } from "./use-notification-store";

const log = createLogger("tier");

const TIER_KEYS = ["fast", "pro", "max"] as const;
type TierKey = (typeof TIER_KEYS)[number];

const tierConfigPromises = new Map<string, Promise<void>>();

function normalizeModelKey(value: string): string {
  return value.trim().replace(/\/+/g, "/").toLowerCase();
}

function modelKeyFromParts(provider: string, modelId: string): string | null {
  const cleanProvider = provider.trim();
  const cleanModelId = modelId.trim();
  if (!cleanModelId) return null;
  if (cleanModelId.includes("/")) {
    return normalizeModelKey(cleanModelId);
  }
  if (!cleanProvider) return null;
  return normalizeModelKey(`${cleanProvider}/${cleanModelId}`);
}

interface TierScopedData {
  tierModels: Record<string, string>;
  currentTier: TierKey | null;
}

interface TierSessionData extends TierScopedData {
  projectPath: string;
}

interface TierState {
  globalDefaults: Record<string, string>;
  hasGlobalDefaults: boolean;
  dataBySession: Record<string, TierSessionData>;
  switching: boolean;

  getGlobalTierModels: () => Record<string, string>;
  getTierModelsForSession: (sessionId: string, projectPath: string) => Record<string, string>;
  getCurrentTierForSession: (sessionId: string, projectPath: string) => TierKey | null;

  setGlobalDefaults: (models: Record<string, string>) => void;
  setSessionTierModels: (
    sessionId: string,
    projectPath: string,
    models: Record<string, string>,
  ) => void;
  setSessionCurrentTier: (sessionId: string, projectPath: string, tier: TierKey | null) => void;
  syncTierFromModelForSession: (
    sessionId: string,
    projectPath: string,
    provider: string,
    modelId: string,
    options?: { preserveOnMismatch?: boolean },
  ) => void;
  switchToTier: (tier: TierKey, sessionId: string) => Promise<void>;
  fetchTierConfig: (sessionId: string, options?: { force?: boolean }) => Promise<void>;
  loadSessionTierConfig: (sessionId: string) => Promise<boolean>;
  saveSessionTierConfig: (sessionId: string) => Promise<void>;
  saveGlobalTierModels: (sessionId: string, models: Record<string, string>) => Promise<void>;
  saveTierModelsForSession: (
    sessionId: string,
    projectPath: string,
    models: Record<string, string>,
  ) => Promise<void>;
  savePersistedConfigForSession: (sessionId: string) => void;
  clearSession: (_sessionId: string) => void;
}

/**
 * 从 sessionId 查找对应的 projectPath。
 * 遍历 sessionsByProject 找到 session 所属的项目。
 */
function findProjectPathBySessionId(sessionId: string): string | null {
  const storeState = useSessionStore.getState();
  if (!storeState?.sessionsByProject) return null;
  for (const [projectPath, sessions] of Object.entries(storeState.sessionsByProject)) {
    if (sessions.some((s) => s.sessionId === sessionId)) {
      return projectPath;
    }
  }
  return null;
}

function findSessionBySessionId(
  sessionId: string,
): { projectPath: string; sessionPath: string } | null {
  const storeState = useSessionStore.getState();
  if (!storeState?.sessionsByProject) return null;
  for (const [projectPath, sessions] of Object.entries(storeState.sessionsByProject)) {
    const found = sessions.find((s) => s.sessionId === sessionId);
    if (found?.sessionPath) {
      return { projectPath, sessionPath: found.sessionPath };
    }
  }
  return null;
}

export { TIER_KEYS };
export type { TierKey };

export const useTierStore = create<TierState>()((set, get) => ({
  globalDefaults: {},
  hasGlobalDefaults: false,
  dataBySession: {},
  switching: false,

  getGlobalTierModels: () => get().globalDefaults,

  getTierModelsForSession: (sessionId, projectPath) => {
    void projectPath;
    const { globalDefaults, dataBySession } = get();
    return dataBySession[sessionId]?.tierModels ?? globalDefaults;
  },

  getCurrentTierForSession: (sessionId, projectPath) => {
    void projectPath;
    return get().dataBySession[sessionId]?.currentTier ?? null;
  },

  setGlobalDefaults: (models) => set({ globalDefaults: models, hasGlobalDefaults: true }),

  setSessionTierModels: (sessionId, projectPath, models) => {
    set((s) => ({
      dataBySession: {
        ...s.dataBySession,
        [sessionId]: {
          projectPath,
          tierModels: models,
          currentTier: s.dataBySession[sessionId]?.currentTier ?? null,
        },
      },
    }));
  },

  setSessionCurrentTier: (sessionId, projectPath, tier) => {
    set((s) => ({
      dataBySession: {
        ...s.dataBySession,
        [sessionId]: {
          projectPath,
          tierModels: s.dataBySession[sessionId]?.tierModels ?? s.globalDefaults,
          currentTier: tier,
        },
      },
    }));
  },

  syncTierFromModelForSession: (sessionId, projectPath, provider, modelId, options) => {
    const fullName = modelKeyFromParts(provider, modelId);
    if (!fullName) return;
    const models = get().getTierModelsForSession(sessionId, projectPath);
    for (const tier of TIER_KEYS) {
      if (models[tier] && normalizeModelKey(models[tier]) === fullName) {
        get().setSessionCurrentTier(sessionId, projectPath, tier);
        return;
      }
    }
    if (options?.preserveOnMismatch) return;
    get().setSessionCurrentTier(sessionId, projectPath, null);
  },

  fetchTierConfig: async (sessionId, options) => {
    const session = findSessionBySessionId(sessionId);
    const projectPath = session?.projectPath ?? findProjectPathBySessionId(sessionId);
    if (!projectPath) {
      log.warn("fetchTierConfig: cannot resolve projectPath for session", { sessionId });
      return;
    }

    // 缓存命中时跳过 API 请求，但仍执行 syncTierFromModel
    // 防止模型切换后 tier 选中态不更新（#53）
    if (!options?.force && get().dataBySession[sessionId]?.tierModels) {
      const currentModel = useSessionStore.getState().currentModel;
      if (currentModel) {
        const models = get().getTierModelsForSession(sessionId, projectPath);
        const fullName = modelKeyFromParts(currentModel.provider, currentModel.id);
        const match = fullName
          ? TIER_KEYS.find((tier) => models[tier] && normalizeModelKey(models[tier]) === fullName)
          : null;
        if (match) {
          get().setSessionCurrentTier(sessionId, projectPath, match);
        } else {
          get().syncTierFromModelForSession(
            sessionId,
            projectPath,
            currentModel.provider,
            currentModel.id,
            { preserveOnMismatch: true },
          );
        }
      }
      return;
    }

    const existingPromise = tierConfigPromises.get(sessionId);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      try {
        // 会话级配置优先，最后回退到 runtime/global 默认。
        const hasSessionConfig = await get().loadSessionTierConfig(sessionId);

        if (!get().hasGlobalDefaults) {
          const result = (await apiClient.call("agent.getTierModels", { sessionId })) as {
            models: Record<string, string>;
          };
          set({
            globalDefaults: result.models,
            hasGlobalDefaults: Object.keys(result.models).length > 0,
          });
        }

        const effectiveModels = get().getTierModelsForSession(sessionId, projectPath);
        if (Object.keys(effectiveModels).length > 0) {
          await apiClient
            .call("agent.setTierModels", { sessionId, models: effectiveModels })
            .catch((err) => {
              log.warn("failed to hydrate session tier models", {
                sessionId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }

        const currentModel = useSessionStore.getState().currentModel;
        if (currentModel) {
          const fullName = modelKeyFromParts(currentModel.provider, currentModel.id);
          const match = fullName
            ? TIER_KEYS.find(
                (tier) =>
                  effectiveModels[tier] && normalizeModelKey(effectiveModels[tier]) === fullName,
              )
            : null;
          if (match) {
            get().setSessionCurrentTier(sessionId, projectPath, match);
          }
        }
        log.info("fetched tier config for session", { sessionId, projectPath, hasSessionConfig });
      } catch (err) {
        log.warn("failed to fetch tier config", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        tierConfigPromises.delete(sessionId);
      }
    })();

    tierConfigPromises.set(sessionId, promise);
    return promise;
  },

  switchToTier: async (tier, sessionId) => {
    const projectPath = findProjectPathBySessionId(sessionId);
    if (!projectPath) {
      log.warn("switchToTier: cannot resolve projectPath for session", { sessionId });
      return;
    }

    set({ switching: true });
    try {
      const result = await apiClient.call("agent.switchTier", {
        sessionId,
        tier,
      });
      const model = result as { provider: string; id: string; tier?: TierKey };
      get().setSessionCurrentTier(sessionId, projectPath, model.tier ?? tier);
      useSessionStore
        .getState()
        .setModelForSession(sessionId, model.provider ?? "", model.id ?? "");
      log.info("switched to tier", { tier, resolved: model });

      get().saveSessionTierConfig(sessionId);
    } catch (err) {
      log.warn("tier switch failed, staying on current model", {
        tier,
        error: err instanceof Error ? err.message : String(err),
      });
      useNotificationStore.getState().push({
        message: `模型档位切换失败：${err instanceof Error ? err.message : String(err)}`,
        level: "error",
        sessionId,
      });
    } finally {
      set({ switching: false });
    }
  },

  loadSessionTierConfig: async (sessionId) => {
    const session = findSessionBySessionId(sessionId);
    if (!session) return false;
    try {
      const result = (await apiClient.call("session.loadTierConfig", {
        sessionPath: session.sessionPath,
      })) as {
        config: {
          tierModels: Record<string, string>;
          currentTier: string | null;
          currentModel?: { provider: string; id: string } | null;
        } | null;
      };
      if (!result.config) return false;
      get().setSessionTierModels(sessionId, session.projectPath, result.config.tierModels);
      get().setSessionCurrentTier(
        sessionId,
        session.projectPath,
        result.config.currentTier as TierKey | null,
      );
      if (result.config.currentModel) {
        useSessionStore
          .getState()
          .setModelForSession(
            sessionId,
            result.config.currentModel.provider,
            result.config.currentModel.id,
          );
      }
      log.info("loaded session tier config", { sessionId });
      return true;
    } catch (err) {
      log.warn("failed to load session tier config", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  saveSessionTierConfig: async (sessionId) => {
    const session = findSessionBySessionId(sessionId);
    if (!session) return;
    const data = get().dataBySession[sessionId];
    const currentModel =
      useSessionStore.getState().modelBySession?.[sessionId] ??
      useSessionStore.getState().currentModel ??
      null;
    try {
      await apiClient.call("session.saveTierConfig", {
        sessionPath: session.sessionPath,
        tierModels: data?.tierModels ?? get().getGlobalTierModels(),
        currentTier: data?.currentTier ?? null,
        currentModel: currentModel
          ? { provider: currentModel.provider, id: currentModel.id }
          : null,
      });
    } catch (err) {
      log.warn("failed to persist session tier config", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  saveGlobalTierModels: async (sessionId, models) => {
    await apiClient.call("agent.setTierModels", {
      sessionId,
      models,
    });
    set({ globalDefaults: models, hasGlobalDefaults: true });
  },

  saveTierModelsForSession: async (sessionId, projectPath, models) => {
    await apiClient.call("agent.setTierModels", {
      sessionId,
      models,
    });

    const shouldSeedGlobalDefaults = !get().hasGlobalDefaults;
    if (shouldSeedGlobalDefaults) {
      set({ globalDefaults: models, hasGlobalDefaults: true });
    }

    get().setSessionTierModels(sessionId, projectPath, models);
    await get().saveSessionTierConfig(sessionId);

    const activeTier = get().getCurrentTierForSession(sessionId, projectPath);
    if (activeTier && models[activeTier]) {
      await get().switchToTier(activeTier, sessionId);
    }
  },

  savePersistedConfigForSession: (sessionId) => {
    get().saveSessionTierConfig(sessionId);
  },

  clearSession: (sessionId: string) => {
    set((s) => {
      const { [sessionId]: _removed, ...rest } = s.dataBySession;
      return { dataBySession: rest };
    });
  },
}));

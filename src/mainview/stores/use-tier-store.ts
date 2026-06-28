import { create } from "zustand";
import { createLogger } from "../../shared/lib/logger";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { useNotificationStore } from "./use-notification-store";

const log = createLogger("tier");

const TIER_KEYS = ["fast", "pro", "max"] as const;
type TierKey = (typeof TIER_KEYS)[number];

const tierConfigPromises = new Map<string, Promise<void>>();

interface TierProjectData {
  tierModels: Record<string, string>;
  currentTier: TierKey | null;
}

interface TierState {
  globalDefaults: Record<string, string>;
  dataByProject: Record<string, TierProjectData>;
  switching: boolean;

  getTierModels: (projectPath: string) => Record<string, string>;
  getCurrentTier: (projectPath: string) => TierKey | null;

  setGlobalDefaults: (models: Record<string, string>) => void;
  setProjectTierModels: (projectPath: string, models: Record<string, string>) => void;
  setProjectCurrentTier: (projectPath: string, tier: TierKey | null) => void;
  syncTierFromModel: (projectPath: string, provider: string, modelId: string) => void;
  switchToTier: (tier: TierKey, sessionId: string) => Promise<void>;
  fetchTierConfig: (sessionId: string, options?: { force?: boolean }) => Promise<void>;
  loadProjectTierConfig: (projectPath: string) => Promise<void>;
  saveProjectTierConfig: (projectPath: string) => Promise<void>;
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

export { TIER_KEYS };
export type { TierKey, TierProjectData };

export const useTierStore = create<TierState>()((set, get) => ({
  globalDefaults: {},
  dataByProject: {},
  switching: false,

  getTierModels: (projectPath) => {
    const { globalDefaults, dataByProject } = get();
    return dataByProject[projectPath]?.tierModels ?? globalDefaults;
  },

  getCurrentTier: (projectPath) => {
    const { dataByProject } = get();
    return dataByProject[projectPath]?.currentTier ?? null;
  },

  setGlobalDefaults: (models) => set({ globalDefaults: models }),

  setProjectTierModels: (projectPath, models) => {
    set((s) => ({
      dataByProject: {
        ...s.dataByProject,
        [projectPath]: {
          tierModels: models,
          currentTier: s.dataByProject[projectPath]?.currentTier ?? null,
        },
      },
    }));
  },

  setProjectCurrentTier: (projectPath, tier) => {
    set((s) => ({
      dataByProject: {
        ...s.dataByProject,
        [projectPath]: {
          tierModels: s.dataByProject[projectPath]?.tierModels ?? s.globalDefaults,
          currentTier: tier,
        },
      },
    }));
  },

  syncTierFromModel: (projectPath, provider, modelId) => {
    const fullName = `${provider}/${modelId}`;
    const models = get().getTierModels(projectPath);
    for (const tier of TIER_KEYS) {
      if (models[tier] && models[tier] === fullName) {
        get().setProjectCurrentTier(projectPath, tier);
        return;
      }
    }
    get().setProjectCurrentTier(projectPath, null);
  },

  fetchTierConfig: async (sessionId, options) => {
    const projectPath = findProjectPathBySessionId(sessionId);
    if (!projectPath) {
      log.warn("fetchTierConfig: cannot resolve projectPath for session", { sessionId });
      return;
    }

    // 缓存命中时跳过 API 请求，但仍执行 syncTierFromModel
    // 防止模型切换后 tier 选中态不更新（#53）
    if (!options?.force && get().dataByProject[projectPath]?.tierModels) {
      const currentModel = useSessionStore.getState().currentModel;
      if (currentModel) {
        get().syncTierFromModel(projectPath, currentModel.provider, currentModel.id);
      }
      return;
    }

    const existingPromise = tierConfigPromises.get(projectPath);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      try {
        // 先加载项目级持久化配置
        await get().loadProjectTierConfig(projectPath);

        // 如果项目级配置不存在，用全局默认
        if (!get().dataByProject[projectPath]?.tierModels) {
          const result = (await apiClient.call("agent.getTierModels", { sessionId })) as {
            models: Record<string, string>;
          };
          set({ globalDefaults: result.models });
          get().setProjectTierModels(projectPath, result.models);
        }

        const currentModel = useSessionStore.getState().currentModel;
        if (currentModel) {
          get().syncTierFromModel(projectPath, currentModel.provider, currentModel.id);
        }
        log.info("fetched tier config for project", { projectPath });
      } catch (err) {
        log.warn("failed to fetch tier config", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        tierConfigPromises.delete(projectPath);
      }
    })();

    tierConfigPromises.set(projectPath, promise);
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
      get().setProjectCurrentTier(projectPath, model.tier ?? tier);
      useSessionStore.getState().setCurrentModel(model.provider ?? "", model.id ?? "");
      log.info("switched to tier", { tier, resolved: model });

      get().saveProjectTierConfig(projectPath);
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

  loadProjectTierConfig: async (projectPath) => {
    try {
      const result = (await apiClient.call("project.loadTierConfig", {
        projectPath,
      })) as {
        config: {
          tierModels: Record<string, string>;
          currentTier: string | null;
        } | null;
      };
      if (result.config) {
        get().setProjectTierModels(projectPath, result.config.tierModels);
        get().setProjectCurrentTier(
          projectPath,
          result.config.currentTier as TierKey | null,
        );
        log.info("loaded project tier config", { projectPath });
      }
    } catch {
      // fallback to global defaults
    }
  },

  saveProjectTierConfig: async (projectPath) => {
    const data = get().dataByProject[projectPath];
    try {
      await apiClient.call("project.saveTierConfig", {
        projectPath,
        tierModels: data?.tierModels ?? get().globalDefaults,
        currentTier: data?.currentTier ?? null,
      });
    } catch (err) {
      log.warn("failed to persist project tier config", {
        projectPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  savePersistedConfigForSession: (sessionId) => {
    const projectPath = findProjectPathBySessionId(sessionId);
    if (projectPath) {
      get().saveProjectTierConfig(projectPath);
    }
  },

  clearSession: (_sessionId: string) => {
    // 项目级配置不随 session 清除，保留在 dataByProject 中
  },
}));

import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import type { UsageRangePreset, UsageScope, UsageShareStats } from "../../shared/modules/usage";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("usage-store");

interface UsageState {
  statsByKey: Record<string, UsageShareStats | null>;
  loadingByKey: Record<string, boolean>;
  errorByKey: Record<string, string | null>;
  rangeByScope: Record<string, UsageRangePreset>;
  loadShareStats: (params: {
    scope?: UsageScope;
    projectPath?: string;
    range?: UsageRangePreset;
    forceRefresh?: boolean;
  }) => Promise<void>;
  setRange: (scopeKey: string, range: UsageRangePreset) => void;
}

export function usageScopeKey(scope: UsageScope, projectPath?: string): string {
  return scope === "global" ? "global" : `project::${projectPath ?? ""}`;
}

export function usageStatsKey(
  scope: UsageScope,
  projectPath: string | undefined,
  range: UsageRangePreset,
): string {
  return `${usageScopeKey(scope, projectPath)}::${range}`;
}

export const useUsageStore = create<UsageState>()((set, get) => ({
  statsByKey: {},
  loadingByKey: {},
  errorByKey: {},
  rangeByScope: {},

  loadShareStats: async ({ scope = "global", projectPath, range: rangeParam, forceRefresh }) => {
    const scopeKey = usageScopeKey(scope, projectPath);
    const range = rangeParam ?? get().rangeByScope[scopeKey] ?? "30d";
    const key = usageStatsKey(scope, projectPath, range);
    set((s) => ({
      loadingByKey: { ...s.loadingByKey, [key]: true },
      errorByKey: { ...s.errorByKey, [key]: null },
    }));

    const refresh = async () => {
      const stats = (await apiClient.call("usage.getShareStats", {
        scope,
        projectPath,
        range,
        mode: "refresh",
      })) as UsageShareStats | null;
      if (!stats) return;
      set((s) => ({
        statsByKey: { ...s.statsByKey, [key]: stats },
        errorByKey: { ...s.errorByKey, [key]: null },
      }));
    };

    try {
      if (!forceRefresh) {
        const cached = (await apiClient.call("usage.getShareStats", {
          scope,
          projectPath,
          range,
          mode: "cache",
        })) as UsageShareStats | null;

        if (cached) {
          set((s) => ({
            statsByKey: { ...s.statsByKey, [key]: cached },
            errorByKey: { ...s.errorByKey, [key]: null },
          }));
        }
      }

      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("loadShareStats failed", { error: message });
      set((s) => ({
        errorByKey: { ...s.errorByKey, [key]: message },
      }));
    } finally {
      set((s) => ({
        loadingByKey: { ...s.loadingByKey, [key]: false },
      }));
    }
  },

  setRange: (scopeKey, range) => {
    set((s) => ({
      rangeByScope: { ...s.rangeByScope, [scopeKey]: range },
    }));
  },
}));

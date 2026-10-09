/**
 * 后端能力 store —— 壳模式的 UI 侧数据源。
 *
 * 用户定则：插件能力"有则显示、无则消失"。启动/切会话时拉一次
 * agent.getChannelCapabilities；pi 后端恒全有（UI 行为不变），
 * ion 后端按 channel-map × 实际加载扩展显隐插件面板。
 */

import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("agent");

interface ChannelCapabilityInfo {
  available: boolean;
  mappedMethods: number;
  requiresExtension: string;
  extensionLoaded: boolean;
  reason: string | null;
}

interface CapabilityState {
  backend: "pi" | "ion";
  channels: Record<string, ChannelCapabilityInfo>;
  fetchedSessionId: string | null;
  fetchCapabilities: (sessionId: string | null) => Promise<void>;
  /** 壳能力缺省可见；只有显式 available=false 才隐藏 */
  isChannelAvailable: (channel: string) => boolean;
}

const initialState = {
  backend: "pi" as const,
  channels: {} as Record<string, ChannelCapabilityInfo>,
  fetchedSessionId: null as string | null,
};

export const useCapabilityStore = create<CapabilityState>((set, get) => ({
  ...initialState,
  fetchCapabilities: async (sessionId) => {
    if (!sessionId) return;
    if (get().fetchedSessionId === sessionId && Object.keys(get().channels).length > 0) return;
    try {
      const result = await apiClient.call("agent.getChannelCapabilities", { sessionId });
      set({
        backend: result.backend,
        channels: result.channels,
        fetchedSessionId: sessionId,
      });
    } catch (err) {
      log.warn("[capabilities] fetch failed, keeping shell defaults", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },
  isChannelAvailable: (channel) => {
    const info = get().channels[channel];
    return info ? info.available : true;
  },
}));

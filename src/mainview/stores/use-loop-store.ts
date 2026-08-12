/**
 * Loop Scheduler Store — 管理 cron 定时任务的配置和运行状态。
 *
 * 数据来源:
 * - loop-scheduler.event 广播（channel data → broadcast）
 * - loop-scheduler.callChannel({ method: "list" | "getStatus" }) 初始加载
 * - CRUD 操作通过 callChannel + agent.setSettings 持久化
 */

import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import type { LoopConfig, LoopStatus } from "../../shared/modules/loop-scheduler";

interface LoopState {
  /** 按 session 隔离的配置列表 */
  configsBySession: Record<string, LoopConfig[] | undefined>;
  /** 按 session 隔离的运行状态 */
  statusBySession: Record<string, LoopStatus[] | undefined>;
  /** 加载状态 */
  loadingBySession: Record<string, boolean>;

  /** 处理 channel 事件（status 更新） */
  handleEvent: (sessionId: string, event: Record<string, unknown>) => void;

  /** 加载配置 + 状态 */
  load: (sessionId: string) => Promise<void>;

  /** 创建任务 */
  create: (sessionId: string, loop: { name: string; cron: string; prompt: string; deliverAs?: "followUp" | "steer" }) => Promise<void>;

  /** 更新任务 */
  update: (sessionId: string, id: string, updates: Partial<LoopConfig>) => Promise<void>;

  /** 开关任务 */
  toggle: (sessionId: string, id: string, enabled: boolean) => Promise<void>;

  /** 删除任务 */
  remove: (sessionId: string, id: string) => Promise<void>;

  /** 清除 session 状态 */
  clearSession: (sessionId: string) => void;
}

async function callLoop(sessionId: string, method: "list" | "create" | "update" | "toggle" | "remove" | "getStatus", args?: Record<string, unknown>) {
  const result = await apiClient.call("loop-scheduler.callChannel", { sessionId, method, args });
  if (!result.ok) throw new Error(result.error);
  return result;
}

export const useLoopStore = create<LoopState>((set, get) => ({
  configsBySession: {},
  statusBySession: {},
  loadingBySession: {},

  handleEvent: (sessionId, event) => {
    if (event.type === "status" && Array.isArray(event.loops)) {
      set((s) => ({
        statusBySession: { ...s.statusBySession, [sessionId]: event.loops as LoopStatus[] },
      }));
    }
  },

  load: async (sessionId) => {
    set((s) => ({ loadingBySession: { ...s.loadingBySession, [sessionId]: true } }));
    try {
      const [listRes, statusRes] = await Promise.all([
        callLoop(sessionId, "list"),
        callLoop(sessionId, "getStatus"),
      ]);
      set((s) => ({
        configsBySession: {
          ...s.configsBySession,
          [sessionId]: (listRes as { loops: LoopConfig[] }).loops ?? [],
        },
        statusBySession: {
          ...s.statusBySession,
          [sessionId]: (statusRes as { status: { loops: LoopStatus[] } }).status?.loops ?? [],
        },
      }));
    } catch {
      // extension not running
    } finally {
      set((s) => ({ loadingBySession: { ...s.loadingBySession, [sessionId]: false } }));
    }
  },

  create: async (sessionId, loop) => {
    await callLoop(sessionId, "create", loop);
    // 持久化到 settings.json
    await persistLoops(sessionId, get().configsBySession[sessionId]);
    await get().load(sessionId);
  },

  update: async (sessionId, id, updates) => {
    // 乐观更新
    const current = get().configsBySession[sessionId] ?? [];
    set((s) => ({
      configsBySession: {
        ...s.configsBySession,
        [sessionId]: current.map((l) => (l.id === id ? { ...l, ...updates } : l)),
      },
    }));
    await callLoop(sessionId, "update", { id, ...updates });
    await persistLoops(sessionId, get().configsBySession[sessionId]);
  },

  toggle: async (sessionId, id, enabled) => {
    // 乐观更新
    const current = get().configsBySession[sessionId] ?? [];
    set((s) => ({
      configsBySession: {
        ...s.configsBySession,
        [sessionId]: current.map((l) => (l.id === id ? { ...l, enabled } : l)),
      },
    }));
    await callLoop(sessionId, "toggle", { id, enabled });
    await persistLoops(sessionId, get().configsBySession[sessionId]);
  },

  remove: async (sessionId, id) => {
    // 乐观更新
    const current = get().configsBySession[sessionId] ?? [];
    set((s) => ({
      configsBySession: {
        ...s.configsBySession,
        [sessionId]: current.filter((l) => l.id !== id),
      },
    }));
    await callLoop(sessionId, "remove", { id });
    await persistLoops(sessionId, get().configsBySession[sessionId]);
  },

  clearSession: (sessionId) =>
    set((s) => {
      const { [sessionId]: _c, ...restConfigs } = s.configsBySession;
      const { [sessionId]: _st, ...restStatus } = s.statusBySession;
      const { [sessionId]: _l, ...restLoading } = s.loadingBySession;
      return {
        configsBySession: restConfigs,
        statusBySession: restStatus,
        loadingBySession: restLoading,
      };
    }),
}));

/** 将最新 loops 列表持久化到 settings.json + reload agent */
async function persistLoops(sessionId: string, loops?: LoopConfig[]): Promise<void> {
  if (!loops) return;
  try {
    const settings = await apiClient.call("agent.getSettings", { sessionId, scope: "global" });
    const merged = {
      ...(settings as Record<string, unknown>),
      loopScheduler: { loops },
    };
    await apiClient.call("agent.setSettings", { sessionId, scope: "global", settings: merged });
    await apiClient.call("agent.reload", { sessionId });
  } catch {
    // persist failure — optimistic update already in store
  }
}

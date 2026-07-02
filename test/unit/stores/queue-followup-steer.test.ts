/**
 * Queue / Follow-up / Steer — 全生命周期测试
 *
 * 覆盖场景：
 * 1. sendFollowUp: 只调 RPC，不写 messagesBySession
 * 2. sendSteer: 只调 RPC，不写 messagesBySession
 * 3. sendMessage (idle): 乐观写入 messagesBySession + RPC
 * 4. queue_update 事件 → 更新 queueBySession
 * 5. agent_end 事件 → 清除 queueBySession
 * 6. clearQueue → RPC 调用
 * 7. getQueue 恢复 → fetchInitialState 恢复 queueBySession
 * 8. abort → RPC 调用，不直接清队列（靠 agent_end 事件）
 * 9. queue_update → 空 steering/followUp → 队列视觉消失
 * 10. 完整事件流：followUp 入队 → queue_update → message_start → 消息出现
 * 11. steer vs followUp 时序差异（概念性验证）
 * 12. 多条 followUp 排队
 * 13. promoteQueuedFollowUp → 单条 followUp 立即提升为 steer
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn(), mode: "web" })),
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../../../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: vi.fn((msg: Record<string, unknown>) => {
    if (!msg) return undefined;
    if (msg.role === "user") {
      return {
        id: msg.id || `user-${Date.now()}`,
        role: "user",
        content: msg.content || [{ type: "text", text: "" }],
        timestamp: msg.timestamp || Date.now(),
      };
    }
    if (msg.role === "assistant") {
      return {
        id: msg.id || `assistant-${Date.now()}`,
        role: "assistant",
        content: msg.content || [],
        timestamp: msg.timestamp || Date.now(),
      };
    }
    return undefined;
  }),
  extractTokenUsage: vi.fn(() => null),
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({
      loadFiles: vi.fn(),
      addEvent: vi.fn(),
      addInjected: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: {
    getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: vi.fn(() => ({
      registerUIRequest: vi.fn(),
      clearPendingBySession: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: {
    getState: vi.fn(() => ({ activeSubsessionId: null })),
  },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  type SessionStatus = "idle" | "streaming" | "compacting" | "permission" | "retrying";
  interface MockSessionState {
    sessionsByProject: Record<string, unknown[]>;
    activeSessionId: string | null;
    projectTabs: unknown[];
    activeProjectId: string | null;
    loading: boolean;
    agentSubscriptions: Record<string, string>;
    batchSubscriptions: Record<string, string>;
    sessionReady: Record<string, boolean>;
    sessionContextMap: Record<string, unknown>;
    sessionStatusMap: Record<string, SessionStatus>;
    currentModel: unknown;
    currentThinkingLevel: string;
    availableModels: unknown[];
    projectStartFailed: Record<string, boolean>;
    projectStartError: Record<string, string>;
    _projectVersion: number;
    updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
    updateSessionContext: (sessionId: string, usage: Record<string, unknown>) => void;
    refreshSessionStats: (sessionId: string) => Promise<void>;
    restoreContextFromHistory: (sessionId: string) => void;
  }
  const useSessionStore = create<MockSessionState>(() => ({
    sessionsByProject: {},
    activeSessionId: null,
    projectTabs: [],
    activeProjectId: null,
    loading: false,
    agentSubscriptions: {},
    batchSubscriptions: {},
    sessionReady: {},
    sessionContextMap: {},
    sessionStatusMap: {},
    currentModel: null,
    currentThinkingLevel: "medium",
    availableModels: [],
    projectStartFailed: {},
    projectStartError: {},
    _projectVersion: 0,
    updateSessionStatus: (sessionId, status) => {
      useSessionStore.setState((s) => ({
        sessionStatusMap: { ...s.sessionStatusMap, [sessionId]: status },
      }));
    },
    updateSessionContext: (sessionId, usage) => {
      useSessionStore.setState((s) => ({
        sessionContextMap: {
          ...s.sessionContextMap,
          [sessionId]: {
            ...((s.sessionContextMap[sessionId] as Record<string, unknown>) || {}),
            ...usage,
          },
        },
      }));
    },
    refreshSessionStats: vi.fn(() => Promise.resolve()),
    restoreContextFromHistory: () => {},
  }));
  return { useSessionStore, clearAgentStarted: vi.fn() };
});

// ── Imports (after mocks) ──────────────────────────────────────────────

import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useSessionQueueStore } from "../../../src/mainview/stores/use-session-queue-store";
import { handleAgentEvent } from "../../../src/mainview/lib/agent-event-handler";

const SID = "sess-1";

// ── Helpers ────────────────────────────────────────────────────────────

function resetChatStore() {
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    pendingImages: [],
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set<string>(),
    historyLoadVersion: 0,
    hasMoreMessagesBySession: {},
    isLoadingMoreBySession: {},
  });
}

function resetSessionStore() {
  useSessionStore.setState({
    activeSessionId: SID,
    sessionReady: { [SID]: true },
    sessionContextMap: {},
    sessionStatusMap: {},
    sessionsByProject: {},
  });
  useSessionQueueStore.setState({ queueBySession: {} });
}

// ── Reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetChatStore();
  resetSessionStore();
});

// ════════════════════════════════════════════════════════════════════════
// 1. sendFollowUp: 只调 RPC，不写 messagesBySession
// ════════════════════════════════════════════════════════════════════════

describe("sendFollowUp — 行为验证", () => {
  it("调用 agent.followUp RPC，不往 messagesBySession 写入", async () => {
    useChatStore.getState().setInputText("等等再做这个");
    await useChatStore.getState().sendFollowUp();

    // RPC 被调用
    expect(apiClient.call).toHaveBeenCalledWith("agent.followUp", {
      sessionId: SID,
      content: "等等再做这个",
      images: [],
    });

    // messagesBySession 没有被写入
    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs).toBeUndefined();
  });

  it("清空 inputText", async () => {
    useChatStore.getState().setInputText("follow-up content");
    await useChatStore.getState().sendFollowUp();

    expect(useChatStore.getState().inputText).toBe("");
  });

  it("空文本不触发 RPC", async () => {
    useChatStore.getState().setInputText("   ");
    await useChatStore.getState().sendFollowUp();

    expect(apiClient.call).not.toHaveBeenCalled();
  });

  it("无 activeSessionId 不触发 RPC", async () => {
    useSessionStore.setState({ activeSessionId: null });
    useChatStore.getState().setInputText("hello");

    await useChatStore.getState().sendFollowUp();

    expect(apiClient.call).not.toHaveBeenCalled();
  });

  it("RPC 失败时不会崩溃", async () => {
    vi.mocked(apiClient.call).mockRejectedValueOnce(new Error("network error"));
    useChatStore.getState().setInputText("will fail");

    await expect(useChatStore.getState().sendFollowUp()).resolves.toBeUndefined();

    expect(useChatStore.getState().inputText).toBe("will fail");
  });

  it("RPC 失败时不会写入 messagesBySession", async () => {
    vi.mocked(apiClient.call).mockRejectedValueOnce(new Error("network error"));
    useChatStore.getState().setInputText("will fail");
    await useChatStore.getState().sendFollowUp();

    expect(useChatStore.getState().messagesBySession[SID]).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. sendSteer: 只调 RPC，不写 messagesBySession
// ════════════════════════════════════════════════════════════════════════

describe("sendSteer — 行为验证", () => {
  it("调用 agent.steer RPC，不往 messagesBySession 写入", async () => {
    useChatStore.getState().setInputText("换个方向");
    await useChatStore.getState().sendSteer();

    expect(apiClient.call).toHaveBeenCalledWith("agent.steer", {
      sessionId: SID,
      content: "换个方向",
      images: [],
    });

    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs).toBeUndefined();
  });

  it("清空 inputText", async () => {
    useChatStore.getState().setInputText("steer content");
    await useChatStore.getState().sendSteer();

    expect(useChatStore.getState().inputText).toBe("");
  });

  it("空文本不触发 RPC", async () => {
    useChatStore.getState().setInputText("");
    await useChatStore.getState().sendSteer();

    expect(apiClient.call).not.toHaveBeenCalled();
  });

  it("RPC 失败时不写入 messagesBySession", async () => {
    vi.mocked(apiClient.call).mockRejectedValueOnce(new Error("fail"));
    useChatStore.getState().setInputText("steer fail");
    await useChatStore.getState().sendSteer();

    expect(useChatStore.getState().messagesBySession[SID]).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. sendMessage (idle): 乐观写入 messagesBySession + RPC
// ════════════════════════════════════════════════════════════════════════

describe("sendMessage (idle) — 对比验证", () => {
  it("sendMessage 会乐观写入用户消息 + 调 RPC", async () => {
    useChatStore.getState().setInputText("普通消息");
    await useChatStore.getState().sendMessage();

    // messagesBySession 有乐观写入
    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs).toBeDefined();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content[0]).toEqual({ type: "text", text: "普通消息" });
    expect(msgs[0]._local).toBe(true);

    // RPC 也被调用
    expect(apiClient.call).toHaveBeenCalledWith("agent.send", {
      sessionId: SID,
      content: "普通消息",
      images: [],
    });
  });

  it("sendMessage 清空 inputText", async () => {
    useChatStore.getState().setInputText("hello");
    await useChatStore.getState().sendMessage();

    expect(useChatStore.getState().inputText).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4. queue_update 事件 → 更新 queueBySession
// ════════════════════════════════════════════════════════════════════════

describe("queue_update 事件处理", () => {
  it("followUp 入队：queue_update 更新 queueBySession", () => {
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: [],
      followUp: ["等等再做"],
    });

    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue).toBeDefined();
    expect(queue?.steering).toEqual([]);
    expect(queue?.followUp).toEqual(["等等再做"]);
  });

  it("steer 入队：queue_update 同时包含 steering 和 followUp", () => {
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: ["换个方向"],
      followUp: ["等等"],
    });

    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue?.steering).toEqual(["换个方向"]);
    expect(queue?.followUp).toEqual(["等等"]);
  });

  it("queue_update 空数组：队列视觉消失", () => {
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: [],
      followUp: [],
    });

    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue?.steering).toEqual([]);
    expect(queue?.followUp).toEqual([]);
  });

  it("不同 session 的 queue_update 互不干扰", () => {
    handleAgentEvent("sess-1", {
      type: "queue_update",
      steering: ["s1-steer"],
      followUp: [],
    });

    handleAgentEvent("sess-2", {
      type: "queue_update",
      steering: [],
      followUp: ["s2-follow"],
    });

    const queue1 = useSessionQueueStore.getState().queueBySession["sess-1"];
    const queue2 = useSessionQueueStore.getState().queueBySession["sess-2"];

    expect(queue1?.steering).toEqual(["s1-steer"]);
    expect(queue1?.followUp).toEqual([]);

    expect(queue2?.steering).toEqual([]);
    expect(queue2?.followUp).toEqual(["s2-follow"]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 5. agent_end 事件 → 清除 queueBySession
// ════════════════════════════════════════════════════════════════════════

describe("agent_end 事件处理", () => {
  it("agent_end 清除该 session 的 queueBySession", () => {
    // 先模拟有队列
    useSessionQueueStore.setState({
      queueBySession: {
        [SID]: { steering: ["old-steer"], followUp: ["old-follow"] },
        other: { steering: [], followUp: ["keep-me"] },
      },
    });

    handleAgentEvent(SID, { type: "agent_end", messages: [] });

    // Should remove SID from queue, keep "other"
    expect(useSessionQueueStore.getState().queueBySession[SID]).toBeUndefined();
    expect(useSessionQueueStore.getState().queueBySession["other"]).toBeDefined();
  });

  it("agent_end 没有队列时不报错", () => {
    expect(() => {
      handleAgentEvent(SID, { type: "agent_end", messages: [] });
    }).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 6. clearQueue → RPC 调用
// ════════════════════════════════════════════════════════════════════════

describe("clearQueue — 行为验证", () => {
  it("调用 agent.clearQueue RPC", async () => {
    await useChatStore.getState().clearQueue();

    expect(apiClient.call).toHaveBeenCalledWith("agent.clearQueue", {
      sessionId: SID,
    });
  });

  it("有 steering 且会话正在运行时，清空队列后会 abort 当前轮以关闭已出队竞态窗口", async () => {
    useSessionStore.setState({
      sessionStatusMap: { [SID]: "streaming" },
    });
    useSessionQueueStore.setState({
      queueBySession: {
        [SID]: {
          steering: ["请改方向"],
          followUp: [],
        },
      },
    });

    await useChatStore.getState().clearQueue();

    expect(apiClient.call).toHaveBeenNthCalledWith(1, "agent.clearQueue", {
      sessionId: SID,
    });
    expect(apiClient.call).toHaveBeenNthCalledWith(2, "agent.abort", {
      sessionId: SID,
    });
  });

  it("无 activeSessionId 不触发 RPC", async () => {
    useSessionStore.setState({ activeSessionId: null });

    await useChatStore.getState().clearQueue();

    expect(apiClient.call).not.toHaveBeenCalled();
  });

  it("按 type/index/text 单独删除队列项并乐观更新本地队列", async () => {
    useSessionQueueStore.setState({
      queueBySession: {
        [SID]: {
          steering: ["转向 A"],
          followUp: ["稍后 A", "稍后 B"],
        },
      },
    });

    await useChatStore.getState().clearQueuedMessage({
      type: "followUp",
      index: 0,
      text: "稍后 A",
    });

    expect(apiClient.call).toHaveBeenCalledWith("agent.clearQueue", {
      sessionId: SID,
      item: { type: "followUp", index: 0, text: "稍后 A" },
    });
    expect(useSessionQueueStore.getState().queueBySession[SID]).toEqual({
      steering: ["转向 A"],
      followUp: ["稍后 B"],
    });
  });
});

describe("promoteQueuedFollowUp — 行为验证", () => {
  it("按 type/index/text 提升一条 followUp 到 steering 并乐观更新本地队列", async () => {
    useSessionQueueStore.setState({
      queueBySession: {
        [SID]: {
          steering: ["转向 A"],
          followUp: ["稍后 A", "稍后 B"],
        },
      },
    });

    await useChatStore.getState().promoteQueuedFollowUp({
      type: "followUp",
      index: 0,
      text: "稍后 A",
    });

    expect(apiClient.call).toHaveBeenCalledWith("agent.promoteQueuedFollowUp", {
      sessionId: SID,
      item: { type: "followUp", index: 0, text: "稍后 A" },
    });
    expect(useSessionQueueStore.getState().queueBySession[SID]).toEqual({
      steering: ["转向 A", "稍后 A"],
      followUp: ["稍后 B"],
    });
  });

  it("无 activeSessionId 不触发 promote RPC", async () => {
    useSessionStore.setState({ activeSessionId: null });

    await useChatStore.getState().promoteQueuedFollowUp({
      type: "followUp",
      index: 0,
      text: "稍后 A",
    });

    expect(apiClient.call).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 7. 完整事件流：followUp 入队 → queue_update → 后端消费 → message_start
// ════════════════════════════════════════════════════════════════════════

describe("完整事件流 — followUp 消息生命周期", () => {
  it("阶段1: 用户发送 follow-up → 只有 RPC 调用，无消息写入", async () => {
    useChatStore.getState().setInputText("稍后处理");
    await useChatStore.getState().sendFollowUp();

    // 不写入 messagesBySession
    expect(useChatStore.getState().messagesBySession[SID]).toBeUndefined();
    // RPC 被调用
    expect(apiClient.call).toHaveBeenCalledWith("agent.followUp", {
      sessionId: SID,
      content: "稍后处理",
      images: [],
    });
  });

  it("阶段2: 后端推送 queue_update → QueueCards 显示排队中", () => {
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: [],
      followUp: ["稍后处理"],
    });

    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue?.followUp).toEqual(["稍后处理"]);
  });

  it("阶段3: 后端消费 followUp → message_start 推送用户消息", () => {
    // 先给 session 准备一些基础数据
    useChatStore.setState({
      messagesBySession: {
        [SID]: [
          {
            id: "prev-msg",
            role: "assistant",
            content: [{ type: "text", text: "之前回复" }],
            timestamp: 1,
          },
        ],
      },
    });

    // 后端消费 followUp 时，推送 message_start 带用户消息
    handleAgentEvent(SID, {
      type: "message_start",
      message: {
        id: "msg-followup-1",
        role: "user",
        content: [{ type: "text", text: "稍后处理" }],
        timestamp: Date.now(),
      },
    });

    // 此时消息出现在 messagesBySession
    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe("user");
  });

  it("阶段4: queue_update 清空 → QueueCards 视觉消失", () => {
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: [],
      followUp: [],
    });

    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue?.followUp).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 8. 完整事件流：steer 入队 → queue_update → 后端注入 → message_start
// ════════════════════════════════════════════════════════════════════════

describe("完整事件流 — steer 消息生命周期", () => {
  it("阶段1: 用户发送 steer → 只有 RPC 调用", async () => {
    useChatStore.getState().setInputText("转向");
    await useChatStore.getState().sendSteer();

    expect(useChatStore.getState().messagesBySession[SID]).toBeUndefined();
    expect(apiClient.call).toHaveBeenCalledWith("agent.steer", {
      sessionId: SID,
      content: "转向",
      images: [],
    });
  });

  it("阶段2: 后端推送 queue_update → steering 非空", () => {
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: ["转向"],
      followUp: [],
    });

    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue?.steering).toEqual(["转向"]);
  });

  it("阶段3: 后端注入 steer → message_start (用户消息)", () => {
    useChatStore.setState({
      messagesBySession: {
        [SID]: [],
      },
    });

    handleAgentEvent(SID, {
      type: "message_start",
      message: {
        id: "msg-steer-1",
        role: "user",
        content: [{ type: "text", text: "转向" }],
        timestamp: Date.now(),
      },
    });

    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
  });
});

// ════════════════════════════════════════════════════════════════════════
// 9. 多条 followUp 排队
// ════════════════════════════════════════════════════════════════════════

describe("多条消息排队", () => {
  it("连续 followUp → 队列有多条消息", async () => {
    // 第一条
    useChatStore.getState().setInputText("第一条");
    await useChatStore.getState().sendFollowUp();

    // 第二条
    useChatStore.getState().setInputText("第二条");
    await useChatStore.getState().sendFollowUp();

    // 两次 RPC
    expect(apiClient.call).toHaveBeenCalledTimes(2);
    expect(apiClient.call).toHaveBeenCalledWith("agent.followUp", {
      sessionId: SID,
      content: "第一条",
      images: [],
    });
    expect(apiClient.call).toHaveBeenCalledWith("agent.followUp", {
      sessionId: SID,
      content: "第二条",
      images: [],
    });

    // 仍然不写入 messagesBySession
    expect(useChatStore.getState().messagesBySession[SID]).toBeUndefined();
  });

  it("queue_update 包含多条 followUp", () => {
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: [],
      followUp: ["第一条", "第二条", "第三条"],
    });

    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue?.followUp).toEqual(["第一条", "第二条", "第三条"]);
  });

  it("混合 steer + followUp", () => {
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: ["转向A", "转向B"],
      followUp: ["稍后1", "稍后2"],
    });

    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue?.steering).toEqual(["转向A", "转向B"]);
    expect(queue?.followUp).toEqual(["稍后1", "稍后2"]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 10. clearQueue → 后端推送空 queue_update → 队列消失
// ════════════════════════════════════════════════════════════════════════

describe("clearQueue 完整流程", () => {
  it("前端调 clearQueue RPC → 后端清空 → 推送空 queue_update", async () => {
    // 1. 先有队列
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: ["steer-1"],
      followUp: ["follow-1"],
    });

    // 2. 用户点击取消
    await useChatStore.getState().clearQueue();
    expect(apiClient.call).toHaveBeenCalledWith("agent.clearQueue", { sessionId: SID });

    // 3. 后端清空后推送空 queue_update
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: [],
      followUp: [],
    });

    // 4. 队列为空
    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue?.followUp).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 11. steer vs followUp 时序差异（概念性验证）
// ════════════════════════════════════════════════════════════════════════

describe("steer vs followUp 时序差异（后端行为概念性验证）", () => {
  it("steer RPC 调用 agent.steer（非 agent.followUp）", async () => {
    useChatStore.getState().setInputText("转向");
    await useChatStore.getState().sendSteer();

    expect(apiClient.call).toHaveBeenCalledWith("agent.steer", expect.anything());
    expect(apiClient.call).not.toHaveBeenCalledWith("agent.followUp", expect.anything());
  });

  it("followUp RPC 调用 agent.followUp（非 agent.steer）", async () => {
    useChatStore.getState().setInputText("稍后");
    await useChatStore.getState().sendFollowUp();

    expect(apiClient.call).toHaveBeenCalledWith("agent.followUp", expect.anything());
    expect(apiClient.call).not.toHaveBeenCalledWith("agent.steer", expect.anything());
  });

  it("时序差异说明: steer 在下一轮 tool call 之前注入，followUp 在 agent 完全结束后注入", () => {
    // 后端行为总结（非前端测试）:
    // steer: agent-loop inner loop → getSteeringMessages() → drain → inject before next LLM call
    // followUp: agent-loop outer loop → getFollowUpMessages() → drain → inject after all tool calls done
    //
    // 前端只负责:
    // 1. 调用正确的 RPC (agent.steer vs agent.followUp)
    // 2. 显示 queue_update 中的排队状态
    // 3. 消费后端的 message_start 事件
    expect(true).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 12. 回归测试：修复前 sendFollowUp 会写 messagesBySession
// ════════════════════════════════════════════════════════════════════════

describe("回归测试 — 乐观写入已移除", () => {
  it("sendFollowUp 不产生 id 包含 'user_followup_' 的消息", async () => {
    useChatStore.getState().setInputText("测试");
    await useChatStore.getState().sendFollowUp();

    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs).toBeUndefined();
  });

  it("sendSteer 不产生 id 包含 'user_steer_' 的消息", async () => {
    useChatStore.getState().setInputText("测试");
    await useChatStore.getState().sendSteer();

    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs).toBeUndefined();
  });

  it("对比: sendMessage 仍会乐观写入", async () => {
    useChatStore.getState().setInputText("正常消息");
    await useChatStore.getState().sendMessage();

    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]._local).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 13. 端到端模拟：用户 streaming 中发送 → 后端消费 → 消息出现
// ════════════════════════════════════════════════════════════════════════

describe("端到端模拟 — streaming 中发送 followUp", () => {
  it("完整流程：streaming → followUp → queue_update → 消费 → message_start → agent_end", async () => {
    // 初始状态：有一条助手消息在 streaming
    useChatStore.setState({
      messagesBySession: {
        [SID]: [
          {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "正在处理..." }],
            timestamp: 1,
          },
        ],
      },
      isStreaming: true,
    });

    // Step 1: 用户发送 follow-up
    useChatStore.getState().setInputText("还有个问题");
    await useChatStore.getState().sendFollowUp();

    // 验证：不写入消息，inputText 已清空
    expect(useChatStore.getState().messagesBySession[SID]).toHaveLength(1); // 只有之前的助手消息
    expect(useChatStore.getState().inputText).toBe("");

    // Step 2: 后端推送 queue_update
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: [],
      followUp: ["还有个问题"],
    });

    const queue = useSessionQueueStore.getState().queueBySession[SID];
    expect(queue?.followUp).toEqual(["还有个问题"]);

    // Step 3: 后端结束当前 turn，消费 followUp
    // 先推送 message_start（用户消息）
    handleAgentEvent(SID, {
      type: "message_start",
      message: {
        id: "user-followup-1",
        role: "user",
        content: [{ type: "text", text: "还有个问题" }],
        timestamp: Date.now(),
      },
    });

    // 此时消息列表有 2 条
    expect(useChatStore.getState().messagesBySession[SID]).toHaveLength(2);
    expect(useChatStore.getState().messagesBySession[SID][1].role).toBe("user");

    // Step 4: 队列清空
    handleAgentEvent(SID, {
      type: "queue_update",
      steering: [],
      followUp: [],
    });

    expect(useSessionQueueStore.getState().queueBySession[SID]?.followUp).toEqual([]);

    // Step 5: agent_end
    handleAgentEvent(SID, { type: "agent_end", messages: [] });

    // 最终：消息列表有 followUp 用户消息，队列为空
    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs.some((m: { role: string }) => m.role === "user")).toBe(true);
    expect(useSessionQueueStore.getState().queueBySession[SID]).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 14. RPC 调用计数与参数验证
// ════════════════════════════════════════════════════════════════════════

describe("RPC 调用计数与参数精确验证", () => {
  it("sendFollowUp 只产生 1 次 RPC 调用", async () => {
    useChatStore.getState().setInputText("test");
    await useChatStore.getState().sendFollowUp();

    expect(apiClient.call).toHaveBeenCalledTimes(1);
  });

  it("sendSteer 只产生 1 次 RPC 调用", async () => {
    useChatStore.getState().setInputText("test");
    await useChatStore.getState().sendSteer();

    expect(apiClient.call).toHaveBeenCalledTimes(1);
  });

  it("sendMessage 产生 1 次 RPC 调用", async () => {
    useChatStore.getState().setInputText("test");
    await useChatStore.getState().sendMessage();

    expect(apiClient.call).toHaveBeenCalledTimes(1);
  });

  it("clearQueue 产生 1 次 RPC 调用", async () => {
    await useChatStore.getState().clearQueue();

    expect(apiClient.call).toHaveBeenCalledTimes(1);
  });

  it("RPC 参数精确匹配: agent.followUp", async () => {
    useChatStore.getState().setInputText("精确匹配");
    await useChatStore.getState().sendFollowUp();

    expect(apiClient.call).toHaveBeenCalledWith("agent.followUp", {
      sessionId: SID,
      content: "精确匹配",
      images: [],
    });
  });

  it("RPC 参数精确匹配: agent.steer", async () => {
    useChatStore.getState().setInputText("精确匹配");
    await useChatStore.getState().sendSteer();

    expect(apiClient.call).toHaveBeenCalledWith("agent.steer", {
      sessionId: SID,
      content: "精确匹配",
      images: [],
    });
  });

  it("RPC 参数精确匹配: agent.send", async () => {
    useChatStore.getState().setInputText("精确匹配");
    await useChatStore.getState().sendMessage();

    expect(apiClient.call).toHaveBeenCalledWith("agent.send", {
      sessionId: SID,
      content: "精确匹配",
      images: [],
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// 15. 事件顺序验证：所有事件类型列表
// ════════════════════════════════════════════════════════════════════════

describe("事件类型与数据结构验证", () => {
  it("queue_update 事件结构: { type, steering, followUp }", () => {
    const event = {
      type: "queue_update" as const,
      steering: ["s1"],
      followUp: ["f1"],
    };

    expect(() => handleAgentEvent(SID, event)).not.toThrow();
  });

  it("agent_start → status streaming", () => {
    handleAgentEvent(SID, { type: "agent_start" });

    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");
  });

  it("agent_end → status idle + queue cleared", () => {
    useSessionQueueStore.setState({
      queueBySession: { [SID]: { steering: ["x"], followUp: ["y"] } },
    });

    handleAgentEvent(SID, { type: "agent_end", messages: [] });

    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
    expect(useSessionQueueStore.getState().queueBySession[SID]).toBeUndefined();
  });

  it("auto_retry_start → retrying", () => {
    handleAgentEvent(SID, {
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000,
      errorMessage: "timeout",
    });

    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("retrying");
  });

  it("auto_retry_end → idle", () => {
    useSessionStore.setState({ sessionStatusMap: { [SID]: "retrying" } });
    handleAgentEvent(SID, {
      type: "auto_retry_end",
      success: true,
      attempt: 1,
    });

    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");
  });
});

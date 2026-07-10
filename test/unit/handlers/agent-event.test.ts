import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ContentBlock } from "../../../src/mainview/types";
import { create } from "zustand";

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

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch", "memory_prefetch_result", "memory_inject"]),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: vi.fn(() => ({
      registerUIRequest: vi.fn(),
      clearPendingBySession: vi.fn(),
    })),
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
    scheduleWorkspaceResourceRefresh: (sessionId: string) => void;
  }
  const scheduleWorkspaceResourceRefresh = vi.fn();
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
    scheduleWorkspaceResourceRefresh,
  }));
  return { useSessionStore, clearAgentStarted: () => {} };
});

vi.mock("../../../src/mainview/stores/use-chat-store", () => {
  const loadSessionMessages = vi.fn(() => Promise.resolve());

  interface ChatMessage {
    id: string;
    role: string;
    content: ContentBlock[];
    timestamp: number;
    isStreaming?: boolean;
    stopReason?: string | null;
  }
  interface ChatState {
    messagesBySession: Record<string, ChatMessage[]>;
    activeToolCallIdsBySession: Record<string, string[] | undefined>;
    inputText: string;
    isStreaming: boolean;
    streamContentVersion: number;
    loadingSessions: Set<string>;
    historyLoadVersion: number;
    setMessagesForSession: (
      sessionId: string,
      msgs: ChatMessage[],
      options?: { bumpStreamVersion?: boolean; streamingFastPath?: boolean },
    ) => void;
    setActiveToolCallIds: (sessionId: string, toolCallIds: string[] | undefined) => void;
    loadSessionMessages: (
      sessionId: string,
      options?: { force?: boolean; preserveStreaming?: boolean },
    ) => Promise<void>;
    incrementStreamVersion: () => void;
    setIsStreaming: (value: boolean) => void;
  }
  const useChatStore = create<ChatState>((set) => ({
    messagesBySession: {},
    activeToolCallIdsBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
    setMessagesForSession: (sessionId, msgs, options) =>
      set((s) => {
        const next: Record<string, unknown> = {
          messagesBySession: { ...s.messagesBySession, [sessionId]: msgs },
        };
        if (options?.bumpStreamVersion) {
          next.streamContentVersion = s.streamContentVersion + 1;
        }
        return next;
      }),
    setActiveToolCallIds: (sessionId, toolCallIds) =>
      set((s) => ({
        activeToolCallIdsBySession: {
          ...s.activeToolCallIdsBySession,
          [sessionId]: toolCallIds,
        },
      })),
    loadSessionMessages,
    incrementStreamVersion: () =>
      set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),
    setIsStreaming: (value) => set({ isStreaming: value }),
  }));
  function getMemorySemanticTimestamp(data: unknown, fallback: number): number {
    const record = data as Record<string, unknown> | undefined;
    const prefetchOccurredAt = record?._prefetchOccurredAt;
    const occurredAt = record?.occurredAt;
    if (typeof prefetchOccurredAt === "number" && Number.isFinite(prefetchOccurredAt)) {
      return prefetchOccurredAt;
    }
    if (typeof occurredAt === "number" && Number.isFinite(occurredAt)) return occurredAt;
    return fallback;
  }
  function getMemoryQueryFromData(data: unknown): string | undefined {
    const record = data as Record<string, unknown> | undefined;
    const query =
      typeof record?._prefetchQuery === "string"
        ? record._prefetchQuery
        : typeof record?.query === "string"
          ? record.query
          : undefined;
    const normalized = query?.trim().replace(/\s+/g, " ");
    return normalized || undefined;
  }
  function getMemoryOperationIdFromData(data: unknown): string | undefined {
    const record = data as Record<string, unknown> | undefined;
    return typeof record?.operationId === "string" ? record.operationId : undefined;
  }
  function getMemoryCustomDedupeKey(customType: string, data: unknown): string | undefined {
    if (customType === "memory_prefetch_result") {
      const query = getMemoryQueryFromData(data);
      if (query) return `prefetch-query:${query}`;
      const operationId = getMemoryOperationIdFromData(data);
      return operationId ? `prefetch:${operationId}` : undefined;
    }
    if (customType === "memory_inject") {
      const query = getMemoryQueryFromData(data);
      if (query) return `inject-query:${query}`;
      const operationId = getMemoryOperationIdFromData(data);
      return operationId ? `inject-op:${operationId}` : undefined;
    }
    return undefined;
  }
  function getMemoryEntryScore(customType: string, data: unknown): number {
    const record = data as Record<string, unknown> | undefined;
    const injectedBytes = typeof record?.injectedBytes === "number" ? record.injectedBytes : 0;
    const originalBytes = typeof record?.originalBytes === "number" ? record.originalBytes : 0;
    const selectedFileScore = Array.isArray(record?.selectedFiles)
      ? record.selectedFiles.length * 500
      : 0;
    if (customType === "memory_inject") {
      const isSkipped = record?.alreadyInjected === true || record?.skipped === true;
      return (isSkipped ? -10_000 : 10_000) + injectedBytes + originalBytes + selectedFileScore;
    }
    if (customType === "memory_prefetch_result") {
      const layer = typeof record?.layer === "string" ? record.layer : "";
      const layerScore =
        layer === "llm" ? 300 : layer === "auto" ? 200 : layer === "skip" ? 100 : 0;
      return injectedBytes + selectedFileScore + layerScore;
    }
    return 0;
  }
  function insertChatMessageByDisplayOrder(
    messages: ChatMessage[],
    message: ChatMessage,
  ): ChatMessage[] {
    return [...messages, message].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      const rank = (msg: ChatMessage) =>
        msg.role === "user" ? 0 : msg.role === "custom" ? 10 : msg.role === "assistant" ? 60 : 80;
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.id.localeCompare(b.id);
    });
  }
  return {
    getMemoryCustomDedupeKey,
    getMemoryEntryScore,
    getMemorySemanticTimestamp,
    insertChatMessageByDisplayOrder,
    useChatStore,
  };
});

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() })),
  },
}));

import { handleAgentEvent, toolCallNameMap } from "../../../src/mainview/lib/agent-event-handler";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useSessionQueueStore } from "../../../src/mainview/stores/use-session-queue-store";
import { useUIDialogStore } from "../../../src/mainview/stores/use-ui-dialog-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { flushNow } from "../../../src/mainview/lib/message-batcher";
import { notificationGateway } from "../../../src/mainview/lib/notification-gateway";

const SID = "test-session-1";
const TCID = "tc-bash-1";

function getMessages() {
  return useChatStore.getState().messagesBySession[SID] || [];
}

function getLastAssistant() {
  const msgs = getMessages();
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant") return msgs[i];
  }
  return null;
}

function getToolExecBlock(
  toolCallId: string = TCID,
): Extract<ContentBlock, { type: "toolExecution" }> | undefined {
  const msg = getLastAssistant();
  if (!msg) return undefined;
  return msg.content.find(
    (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
      b.type === "toolExecution" && b.toolCallId === toolCallId,
  );
}

function setMessages(msgs: unknown[]) {
  useChatStore.setState({ messagesBySession: { [SID]: msgs } });
}

beforeEach(() => {
  (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
    tokens: null,
    contextWindow: 0,
  });
  useChatStore.setState({
    messagesBySession: {},
    activeToolCallIdsBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
  });
  useChatStore.getState().loadSessionMessages = vi.fn(() => Promise.resolve());
  useSessionStore.setState({
    sessionStatusMap: {},
    sessionsByProject: {},
  });
  useSessionStore.getState().scheduleWorkspaceResourceRefresh = vi.fn();
  Object.keys(toolCallNameMap).forEach((k) => delete toolCallNameMap[k]);
  (useUIDialogStore.getState as ReturnType<typeof vi.fn>).mockClear();
  (notificationGateway.emit as ReturnType<typeof vi.fn>).mockClear();
});

describe("assistant message_end status recovery", () => {
  it("releases streaming session when a plain assistant response ends", () => {
    setMessages([
      {
        id: "assistant-live",
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useChatStore.setState({ isStreaming: true });
    useSessionStore.setState({ sessionStatusMap: { [SID]: "streaming" } });

    handleAgentEvent(SID, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        stopReason: "stop",
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    expect(getLastAssistant()?.isStreaming).toBe(false);
    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("keeps session streaming when assistant ends on a tool-use boundary", () => {
    setMessages([
      {
        id: "assistant-tool",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "pwd",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useChatStore.setState({
      isStreaming: true,
      activeToolCallIdsBySession: { [SID]: [TCID] },
    });
    useSessionStore.setState({ sessionStatusMap: { [SID]: "streaming" } });

    handleAgentEvent(SID, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: TCID, name: "bash", input: { command: "pwd" } }],
        stopReason: "toolUse",
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    expect(getLastAssistant()?.isStreaming).toBe(false);
    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");
    expect(useChatStore.getState().isStreaming).toBe(true);
  });
});

describe("agent_start / agent_end", () => {
  it("agent_start sets sessionStatus to streaming", () => {
    handleAgentEvent(SID, { type: "agent_start" } as Parameters<typeof handleAgentEvent>[1]);
    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");
  });

  it("agent_end sets sessionStatus to idle", () => {
    useSessionStore.setState({ sessionStatusMap: { [SID]: "streaming" } });
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });
    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);
    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
  });

  it("agent_start bumps SessionMeta.updatedAt so session bubbles to top of list", () => {
    const oldTime = 1000;
    const otherTime = 2000;
    useSessionStore.setState({
      sessionsByProject: {
        "/proj": [
          { sessionId: "other-session", updatedAt: otherTime, sessionPath: "/s/other" },
          { sessionId: SID, updatedAt: oldTime, sessionPath: "/s/test" },
        ],
      },
    });

    const beforeEvent = Date.now();
    handleAgentEvent(SID, { type: "agent_start" } as Parameters<typeof handleAgentEvent>[1]);

    const sessions = useSessionStore.getState().sessionsByProject["/proj"];
    const updated = sessions.find((s) => s.sessionId === SID);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(beforeEvent);

    // The previously-older session should now have a newer updatedAt than the other
    const other = sessions.find((s) => s.sessionId === "other-session");
    expect((updated as { updatedAt: number }).updatedAt).toBeGreaterThan(
      (other as { updatedAt: number }).updatedAt,
    );
  });

  it("agent_start does not crash when session is not in sessionsByProject", () => {
    useSessionStore.setState({ sessionsByProject: {} });
    expect(() =>
      handleAgentEvent(SID, { type: "agent_start" } as Parameters<typeof handleAgentEvent>[1]),
    ).not.toThrow();
  });
});

describe("memory custom entry ordering", () => {
  it("uses semantic occurrence time so late memory results render after the triggering user", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "读取一下上面的文件" }],
        timestamp: 1_000,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "text", text: "我来检查。" }],
        timestamp: 3_000,
      },
    ]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-start-1",
      customType: "memory_prefetch",
      data: {
        operationId: "op-1",
        query: "读取一下上面的文件",
        availableFiles: 2,
        occurredAt: 1_100,
        phaseOrder: 1,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-result-1",
      customType: "memory_prefetch_result",
      data: {
        operationId: "op-1",
        summary: "Matched memory",
        snippet: "memory text",
        selectedFiles: ["MEMORY.md"],
        occurredAt: 1_200,
        phaseOrder: 2,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const messages = getMessages();
    expect(messages.map((message) => message.id)).toEqual([
      "user-1",
      "prefetch-result-1",
      "assistant-1",
    ]);
    expect(messages[1]).toMatchObject({
      role: "custom",
      timestamp: 1_100,
      content: [
        {
          type: "custom",
          customType: "memory_prefetch_result",
          data: {
            operationId: "op-1",
            _prefetchOccurredAt: 1_100,
          },
        },
      ],
    });
  });

  it("replaces older memory prefetch results for the same operation in live event flow", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "读取一下上面的文件" }],
        timestamp: 1_000,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "text", text: "我来检查。" }],
        timestamp: 3_000,
      },
    ]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-start-1",
      customType: "memory_prefetch",
      data: {
        operationId: "op-1",
        query: "读取一下上面的文件",
        availableFiles: 2,
        occurredAt: 1_100,
        phaseOrder: 1,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-result-1",
      customType: "memory_prefetch_result",
      data: {
        operationId: "op-1",
        summary: "规则命中",
        snippet: "rules text",
        layer: "skip",
        selectedFiles: ["rules.md"],
        occurredAt: 1_200,
        phaseOrder: 2,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-result-2",
      customType: "memory_prefetch_result",
      data: {
        operationId: "op-1",
        summary: "Matched memory",
        snippet: "memory text",
        layer: "auto",
        selectedFiles: ["MEMORY.md"],
        occurredAt: 1_250,
        phaseOrder: 2,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const messages = getMessages();
    expect(messages.map((message) => message.id)).toEqual([
      "user-1",
      "prefetch-result-2",
      "assistant-1",
    ]);
  });

  it("keeps the actual memory injection over a later reuse entry in live event flow", () => {
    setMessages([]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "inject-1",
      customType: "memory_inject",
      data: {
        operationId: "op-1",
        fingerprint: "rules.md|12288",
        summary: "已注入 Memory 到模型上下文 · 16个文件",
        snippet: "rules snippet",
        selectedFiles: ["rules.md"],
        injectedBytes: 12288,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "inject-2",
      customType: "memory_inject",
      data: {
        operationId: "op-1",
        fingerprint: "memory.md|0",
        summary: "已识别 Memory，本会话已注入过 · 1个文件",
        snippet: "memory snippet",
        selectedFiles: ["memory.md"],
        alreadyInjected: true,
        skipped: true,
        originalBytes: 435,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const messages = getMessages();
    expect(messages.map((message) => message.id)).toEqual(["inject-1"]);
  });

  it("deduplicates same-query memory prefetch results across different operations in live event flow", () => {
    setMessages([]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-start-rules",
      customType: "memory_prefetch",
      data: {
        operationId: "op-rules",
        query: "请连续输出 18 段内容",
        availableFiles: 16,
        occurredAt: 100,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-result-rules",
      customType: "memory_prefetch_result",
      data: {
        operationId: "op-rules",
        summary: "已匹配记忆 · 规则 · 13KB · 16个文件",
        layer: "skip",
        injectedBytes: 13_000,
        selectedFiles: Array.from({ length: 16 }, (_, i) => `rules-${i}.md`),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-start-auto",
      customType: "memory_prefetch",
      data: {
        operationId: "op-auto",
        query: "请连续输出 18 段内容",
        availableFiles: 1,
        occurredAt: 120,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-result-auto",
      customType: "memory_prefetch_result",
      data: {
        operationId: "op-auto",
        summary: "已匹配记忆 · 全量注入 · 0KB · 1个文件",
        layer: "auto",
        injectedBytes: 0,
        selectedFiles: ["user_preferences.md"],
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const messages = getMessages();
    expect(messages.map((message) => message.id)).toEqual(["prefetch-result-rules"]);
  });

  it("deduplicates same-query memory inject/reuse entries across different operations in live event flow", () => {
    setMessages([]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-start-rules",
      customType: "memory_prefetch",
      data: {
        operationId: "op-rules",
        query: "请连续输出 18 段内容",
        occurredAt: 100,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "inject-rules",
      customType: "memory_inject",
      data: {
        operationId: "op-rules",
        fingerprint: "rules|13000",
        summary: "已注入 Memory 到模型上下文 · 16个文件",
        selectedFiles: Array.from({ length: 16 }, (_, i) => `rules-${i}.md`),
        injectedBytes: 13_000,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "prefetch-start-auto",
      customType: "memory_prefetch",
      data: {
        operationId: "op-auto",
        query: "请连续输出 18 段内容",
        occurredAt: 120,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    handleAgentEvent(SID, {
      type: "custom_entry",
      id: "inject-auto-reuse",
      customType: "memory_inject",
      data: {
        operationId: "op-auto",
        fingerprint: "prefs|70",
        summary: "已识别 Memory，本会话已注入过 · 1个文件",
        selectedFiles: ["user_preferences.md"],
        alreadyInjected: true,
        skipped: true,
        originalBytes: 70,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const messages = getMessages();
    expect(messages.map((message) => message.id)).toEqual(["inject-rules"]);
  });
});

describe("tool_execution_start", () => {
  it("adds toolExecution block with status=running to existing streaming message", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "echo hello" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block).toBeDefined();
    expect(block!.status).toBe("running");
    expect(block!.toolName).toBe("bash");
    expect(block!.args).toBe("echo hello");
    expect(toolCallNameMap[TCID]).toBe("bash");
    expect(useChatStore.getState().activeToolCallIdsBySession[SID]).toEqual([TCID]);
  });

  it("updates existing block if toolCallId matches", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "unknown",
            args: "",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "ls" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.toolName).toBe("bash");
    expect(block!.args).toBe("ls");
  });

  it("ignores replayed start when the same tool call already ended in an earlier message", () => {
    setMessages([
      {
        id: "history-msg",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "cargo build",
            status: "done",
            output: "finished\n",
          },
        ],
        timestamp: Date.now() - 10,
        isStreaming: false,
      },
      {
        id: "live-placeholder",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "cargo build", description: "build" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const messages = getMessages();
    const blocks = messages.flatMap((msg) =>
      msg.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
          b.type === "toolExecution" && b.toolCallId === TCID,
      ),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("done");
    expect(messages[1].content).toHaveLength(0);
  });
});

describe("tool_execution_update", () => {
  it("updates output on running block and keeps status=running", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo hello",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "hel" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.output).toBe("hel");
    expect(block!.status).toBe("running");
  });

  it("does not reopen a completed block when a delayed update arrives", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo hello",
            status: "done",
            output: "",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "hello\n" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.status).toBe("done");
    expect(block!.output).toBe("hello\n");
  });

  it("handles multiple sequential updates", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "seq",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "1\n" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "1\n2\n" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.output).toBe("1\n2\n");
    expect(block!.status).toBe("running");
  });

  it("does not reopen a completed block when a delayed start arrives", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo hello",
            status: "done",
            output: "hello\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: false,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "echo hello" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.status).toBe("done");
    expect(block!.output).toBe("hello\n");
  });

  it("does not append a replayed start when a terminal block with a different id has the same command", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-history",
            toolName: "bash",
            args: JSON.stringify({ command: "echo hello", description: "say hello" }),
            status: "done",
            output: "hello\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: false,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: "tc-replayed-stale",
      toolName: "bash",
      args: { command: "echo hello", description: "say hello" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const blocks = getLastAssistant()!.content.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCallId).toBe("tc-history");
    expect(blocks[0].status).toBe("done");
    expect(blocks[0].output).toBe("hello\n");
  });
});

describe("tool_execution_end", () => {
  it("sets status=done with output", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo hello",
            status: "running",
            output: "hel",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_end",
      toolCallId: TCID,
      result: { content: [{ type: "text", text: "hello\n" }] },
      isError: false,
    } as Parameters<typeof handleAgentEvent>[1]);

    const block = getToolExecBlock();
    expect(block!.status).toBe("done");
    expect(block!.output).toBe("hello\n");
    expect(useSessionStore.getState().scheduleWorkspaceResourceRefresh).toHaveBeenCalledWith(SID);
  });

  it("sets status=error when isError=true", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "exit 1",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_end",
      toolCallId: TCID,
      result: { content: [{ type: "text", text: "failed" }] },
      isError: true,
    } as Parameters<typeof handleAgentEvent>[1]);

    const block = getToolExecBlock();
    expect(block!.status).toBe("error");
    expect(block!.output).toBe("failed");
    expect(useChatStore.getState().activeToolCallIdsBySession[SID]).toEqual([]);
  });
});

describe("toolResult message events", () => {
  it("merges parallel toolResult messages into their matching toolExecution blocks", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-read",
            toolName: "read",
            args: "/tmp/a.txt",
            status: "running",
          },
          {
            type: "toolExecution",
            toolCallId: "tc-grep",
            toolName: "grep",
            args: "needle",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_start",
      message: {
        role: "toolResult",
        toolCallId: "tc-read",
        toolName: "read",
        content: [{ type: "text", text: "read output\n" }],
        isError: false,
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    handleAgentEvent(SID, {
      type: "message_start",
      message: {
        role: "toolResult",
        toolCallId: "tc-grep",
        toolName: "grep",
        content: [{ type: "text", text: "grep output\n" }],
        isError: false,
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const readBlock = getToolExecBlock("tc-read");
    const grepBlock = getToolExecBlock("tc-grep");

    expect(readBlock?.status).toBe("done");
    expect(readBlock?.output).toBe("read output\n");
    expect(grepBlock?.status).toBe("done");
    expect(grepBlock?.output).toBe("grep output\n");
  });
});

describe("full streaming lifecycle", () => {
  it("start → update → end", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "echo ok" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const step1 = getToolExecBlock();
    expect(step1!.status).toBe("running");
    expect(step1!.args).toBe("echo ok");

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "ok\n" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const step2 = getToolExecBlock();
    expect(step2!.output).toBe("ok\n");
    expect(step2!.status).toBe("running");

    handleAgentEvent(SID, {
      type: "tool_execution_end",
      toolCallId: TCID,
      result: { content: [{ type: "text", text: "ok\n" }] },
      isError: false,
    } as Parameters<typeof handleAgentEvent>[1]);

    const step3 = getToolExecBlock();
    expect(step3!.status).toBe("done");
    expect(step3!.output).toBe("ok\n");
  });
});

describe("tool id reconciliation", () => {
  it("reuses a pending message_update tool block when execution start uses a different id", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "message-tool-id",
            name: "bash",
            arguments: { command: "ls now-mock", description: "查看 now-mock 项目" },
          },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: "execution-tool-id",
      toolName: "bash",
      args: { command: "ls now-mock", description: "查看 now-mock 项目" },
      timestamp: Date.now(),
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    handleAgentEvent(SID, {
      type: "tool_execution_end",
      toolCallId: "execution-tool-id",
      toolName: "bash",
      result: { content: [{ type: "text", text: "now-mock\n" }] },
      isError: false,
      timestamp: Date.now(),
      durationMs: 1000,
    } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    const execBlocks =
      msg?.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ) ?? [];
    expect(execBlocks).toHaveLength(1);
    expect(execBlocks[0].toolCallId).toBe("execution-tool-id");
    expect(execBlocks[0].status).toBe("done");
    expect(execBlocks[0].output).toBe("now-mock\n");
  });
});

describe("message_end tool card closure", () => {
  it("closes running tool blocks when assistant message ends without a tool end event", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo ok",
            status: "running",
            output: "ok\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "streaming" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-1",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    const block = getToolExecBlock();
    expect(msg!.isStreaming).toBe(false);
    expect(block!.status).toBe("done");
  });

  it("does not turn an empty toolUse assistant boundary into an error card", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "run tests" }],
        timestamp: Date.now() - 2,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "text", text: "I will run the tests." }],
        timestamp: Date.now() - 1,
      },
      {
        id: "assistant-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: false,
        stopReason: "toolUse",
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-tool-use",
      message: {
        role: "assistant",
        content: [],
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs.map((m) => m.id)).toEqual(["user-1", "assistant-1"]);
    expect(msgs.some((m) => m.role === "error")).toBe(false);
    expect(useChatStore.getState().loadSessionMessages).toHaveBeenCalledWith(SID, {
      force: true,
      preserveStreaming: false,
    });
  });

  it("does not reuse prior assistant text as an error when a later empty boundary arrives", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "continue" }],
        timestamp: Date.now() - 2,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "text", text: "Already answered." }],
        timestamp: Date.now() - 1,
      },
      {
        id: "assistant-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: false,
        stopReason: "stop",
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-stop",
      message: {
        role: "assistant",
        content: [],
        stopReason: "stop",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toEqual([{ type: "text", text: "Already answered." }]);
    expect(useChatStore.getState().loadSessionMessages).toHaveBeenCalledWith(SID, {
      force: true,
      preserveStreaming: false,
    });
  });

  it("does not turn a normal stop boundary into an empty-response error", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "continue" }],
        timestamp: Date.now() - 1,
      },
      {
        id: "assistant-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: false,
        stopReason: "stop",
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-stop-empty",
      message: {
        role: "assistant",
        content: [],
        stopReason: "stop",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs.map((m) => m.id)).toEqual(["user-1"]);
    expect(msgs.some((m) => m.role === "error")).toBe(false);
    expect(useChatStore.getState().loadSessionMessages).toHaveBeenCalledWith(SID, {
      force: true,
      preserveStreaming: false,
    });
  });

  it("keeps the empty-response error only when the current turn has no assistant content", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.now() - 1,
      },
      {
        id: "assistant-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: false,
        stopReason: "error",
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-error",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe("error");
    expect(msgs[1].content).toEqual([{ type: "text", text: "LLM 响应失败\nLLM 返回了错误响应" }]);
    expect(useChatStore.getState().loadSessionMessages).not.toHaveBeenCalled();
  });

  it("adds a visible error card when LLM fails after partial assistant content", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "write a long answer" }],
        timestamp: Date.now() - 2,
      },
      {
        id: "assistant-partial",
        role: "assistant",
        content: [{ type: "text", text: "partial response before provider failed" }],
        timestamp: Date.now() - 1,
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-quota-error",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial response before provider failed" }],
        stopReason: "error",
        errorMessage: "HTTP 402 insufficient_quota: quota exceeded",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toMatchObject({
      id: "assistant-partial",
      role: "assistant",
      isStreaming: false,
      stopReason: "error",
      entryId: "entry-quota-error",
    });
    expect(msgs[2]).toMatchObject({
      id: "error_llm_entry-quota-error",
      role: "error",
      stopReason: "error",
    });
    expect(msgs[2].content).toEqual([
      {
        type: "text",
        text: "模型额度或账单异常\nHTTP 402 insufficient_quota: quota exceeded",
      },
    ]);
    expect(notificationGateway.emit).toHaveBeenCalledWith({
      type: "session_error",
      sessionId: SID,
      title: "模型额度或账单异常",
      body: "HTTP 402 insufficient_quota: quota exceeded",
      level: "error",
    });
  });

  it("attaches latest provider request diagnostics to live LLM error cards", () => {
    const providerRequest = {
      version: 1,
      provider: "opencode-go",
      modelId: "deepseek-v4-flash",
      api: "openai-completions",
      timestamp: new Date().toISOString(),
      payloadChars: 423283,
      payloadTokens: 105821,
      topLevelKeys: ["messages", "model", "tools", "thinking"],
      sections: [
        { id: "messages", label: "Messages", chars: 389425, tokens: 97357, count: 386 },
        { id: "tools", label: "Tools", chars: 33695, tokens: 8424, count: 47 },
      ],
    };
    useSessionStore.setState({
      sessionContextMap: {
        [SID]: {
          tokens: 105821,
          contextWindow: 1_000_000,
          providerRequest,
        },
      },
    });
    setMessages([
      {
        id: "assistant-partial",
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        timestamp: Date.now() - 1,
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-provider-400",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        stopReason: "error",
        errorMessage: "400 Error from provider (Console Go): Upstream request failed",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs[1]).toMatchObject({
      id: "error_llm_entry-provider-400",
      role: "error",
      providerRequest,
    });
  });

  it("dedupes repeated LLM error message_end replays by entryId", () => {
    setMessages([
      {
        id: "assistant-partial",
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        timestamp: Date.now() - 1,
        isStreaming: true,
      },
    ]);
    const event = {
      type: "message_end",
      entryId: "entry-provider-error",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        stopReason: "error",
        errorMessage: "provider returned HTTP 500",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1];

    handleAgentEvent(SID, event);
    handleAgentEvent(SID, event);

    const errors = getMessages().filter((msg) => msg.role === "error");
    expect(errors).toHaveLength(1);
    expect(notificationGateway.emit).toHaveBeenCalledTimes(1);
  });
});

describe("agent_end cleanup", () => {
  it("calls clearPendingBySession on agent_end", () => {
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });
    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    const mockGetState = useUIDialogStore.getState as ReturnType<typeof vi.fn>;
    expect(mockGetState).toHaveBeenCalled();
    const returned = mockGetState.mock.results[mockGetState.mock.results.length - 1].value;
    expect(returned.clearPendingBySession).toHaveBeenCalledWith(SID);
  });

  it("clears queueBySession for the ended session", () => {
    useSessionQueueStore.setState({
      queueBySession: {
        [SID]: { steering: ["msg1"], followUp: ["msg2"] },
        "other-session": { steering: [], followUp: [] },
      },
    });
    useSessionStore.setState({
      sessionsByProject: { "/tmp": [] },
    });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    expect(useSessionQueueStore.getState().queueBySession[SID]).toBeUndefined();
    expect(useSessionQueueStore.getState().queueBySession["other-session"]).toBeDefined();
  });

  it("does not modify queueBySession when session has no queue entry", () => {
    useSessionQueueStore.setState({
      queueBySession: { "other-session": { steering: [], followUp: [] } },
    });
    useSessionStore.setState({
      sessionsByProject: { "/tmp": [] },
    });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    expect(Object.keys(useSessionQueueStore.getState().queueBySession)).toHaveLength(1);
  });

  it("appends an inline error card when the agent ends without assistant content", () => {
    setMessages([
      {
        id: "user-empty-turn",
        role: "user",
        content: [{ type: "text", text: "hello?" }],
        timestamp: Date.now() - 1,
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe("error");
    expect(msgs[1].stopReason).toBe("empty_response");
    expect(msgs[1].content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Agent 未返回有效响应"),
      },
    ]);
  });

  it("appends an inline provider error card when agent_end carries a prompt failure reason", () => {
    setMessages([
      {
        id: "user-provider-error",
        role: "user",
        content: [{ type: "text", text: "use the selected model" }],
        timestamp: Date.now() - 1,
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, {
      type: "agent_end",
      reason: "HTTP 429 rate_limit_exceeded: model unavailable",
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe("error");
    expect(msgs[1].stopReason).toBe("error");
    expect(msgs[1].content).toEqual([
      {
        type: "text",
        text: "LLM 响应失败\nHTTP 429 rate_limit_exceeded: model unavailable",
      },
    ]);
    expect(notificationGateway.emit).toHaveBeenCalledWith({
      type: "session_error",
      sessionId: SID,
      title: "响应失败",
      body: "HTTP 429 rate_limit_exceeded: model unavailable",
      level: "error",
    });
  });

  it("closes running tool blocks when the agent ends without a tool end event", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo ok",
            status: "running",
            output: "ok\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    const block = getToolExecBlock();
    expect(msg!.isStreaming).toBe(false);
    expect(block!.status).toBe("done");
  });

  it("clears isStreaming on text-only assistant message when agent ends", () => {
    setMessages([
      {
        id: "msg-text",
        role: "assistant",
        content: [{ type: "text", text: "Hello!" }],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    expect(msg!.isStreaming).toBe(false);
  });

  it("does not emit session_complete when the final assistant message failed", () => {
    setMessages([
      {
        id: "assistant-error",
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        timestamp: Date.now(),
        isStreaming: true,
        stopReason: "error",
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    expect(notificationGateway.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session_complete" }),
    );
    expect(notificationGateway.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session_error",
        sessionId: SID,
        title: "响应失败",
      }),
    );
  });

  it("does not duplicate the LLM error notification after message_end already surfaced it", () => {
    setMessages([
      {
        id: "assistant-partial",
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        timestamp: Date.now() - 1,
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-error-before-end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
        stopReason: "error",
        errorMessage: "provider returned HTTP 500",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    expect(notificationGateway.emit).toHaveBeenCalledTimes(1);
    expect(notificationGateway.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session_error",
        sessionId: SID,
        title: "响应失败",
      }),
    );
    expect(notificationGateway.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session_complete" }),
    );
  });

  it("merges duplicate LLM error cards in the same turn and keeps provider diagnostics", () => {
    setMessages([
      {
        id: "user-provider-error",
        role: "user",
        content: [{ type: "text", text: "继续继续" }],
        timestamp: Date.now() - 3,
      },
      {
        id: "assistant-partial",
        role: "assistant",
        content: [{ type: "text", text: "partial response" }],
        timestamp: Date.now() - 2,
        isStreaming: true,
      },
      {
        id: "error-existing",
        role: "error",
        content: [
          {
            type: "text",
            text: "LLM 响应失败\n400 Error from provider (Console Go): Upstream request failed",
          },
        ],
        timestamp: Date.now() - 1,
        stopReason: "error",
      },
    ]);
    useSessionStore.setState({
      sessionsByProject: { "/tmp": [] },
      sessionContextMap: {
        [SID]: {
          tokens: 552000,
          contextWindow: 1000000,
          providerRequest: {
            version: 1,
            provider: "opencode-go",
            modelId: "deepseek-v4-flash",
            api: "openai-completions",
            timestamp: new Date().toISOString(),
            payloadChars: 2_000_000,
            payloadTokens: 552_000,
            topLevelKeys: ["messages", "tools"],
            sections: [
              {
                id: "messages",
                label: "Messages",
                chars: 1_800_000,
                tokens: 500_000,
                count: 2003,
              },
            ],
          },
        },
      },
    });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-provider-error",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial response" }],
        stopReason: "error",
        errorMessage: "400 Error from provider (Console Go): Upstream request failed",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const errors = getMessages().filter((msg) => msg.role === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe("error-existing");
    expect((errors[0] as { providerRequest?: { payloadTokens?: number } }).providerRequest).toEqual(
      expect.objectContaining({ payloadTokens: 552000 }),
    );
  });

  it("replaces an empty-response fallback with the real provider error", () => {
    setMessages([
      {
        id: "user-provider-error",
        role: "user",
        content: [{ type: "text", text: "继续继续" }],
        timestamp: Date.now() - 3,
      },
      {
        id: "assistant-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now() - 2,
        isStreaming: true,
      },
      {
        id: "error-empty-fallback",
        role: "error",
        content: [{ type: "text", text: "Agent 未返回有效响应\n本轮 Agent 已结束" }],
        timestamp: Date.now() - 1,
        stopReason: "empty_response",
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-provider-error",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage:
          "400 Error from provider (DeepSeek): Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const errors = getMessages().filter((msg) => msg.role === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].stopReason).toBe("error");
    expect(errors[0].content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Messages with role 'tool'"),
      },
    ]);
    expect(getMessages().some((msg) => msg.stopReason === "empty_response")).toBe(false);
  });

  it("clears isStreaming on empty assistant message when agent ends", () => {
    setMessages([
      {
        id: "msg-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    expect(msg!.isStreaming).toBe(false);
  });
});

describe("message_update content block ordering", () => {
  it("preserves incoming order: text before toolCall", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check the file." },
          { type: "toolCall", id: TCID, name: "bash", arguments: { command: "cat foo" } },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const types = msg!.content.map((b) => b.type);
    expect(types).toEqual(["text", "toolExecution"]);
  });

  it("preserves incoming order: toolCall before text", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: TCID, name: "bash", arguments: { command: "ls" } },
          { type: "text", text: "Here are the files." },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const types = msg!.content.map((b) => b.type);
    expect(types).toEqual(["toolExecution", "text"]);
  });

  it("preserves interleaved order: text-tool-text", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "First, let me read the file." },
          { type: "toolCall", id: "tc-1", name: "read", arguments: { path: "/a" } },
          { type: "text", text: "Now I see the contents." },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const types = msg!.content.map((b) => b.type);
    expect(types).toEqual(["text", "toolExecution", "text"]);
  });

  it("places preserved toolExecs before incoming blocks", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-prev",
            toolName: "bash",
            args: "echo done",
            status: "done",
            output: "done\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Based on the result..." },
          { type: "toolCall", id: "tc-new", name: "read", arguments: { path: "/b" } },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const blocks = msg!.content;
    expect(blocks[0].type).toBe("toolExecution");
    expect((blocks[0] as Extract<ContentBlock, { type: "toolExecution" }>).toolCallId).toBe(
      "tc-prev",
    );
    expect(blocks[1].type).toBe("text");
    expect(blocks[2].type).toBe("toolExecution");
    expect((blocks[2] as Extract<ContentBlock, { type: "toolExecution" }>).toolCallId).toBe(
      "tc-new",
    );
  });

  it("merges incoming toolCall with existing toolExecution preserving position", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Running command..." },
          { type: "toolCall", id: TCID, name: "bash", arguments: { command: "ls" } },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const types = msg!.content.map((b) => b.type);
    expect(types).toEqual(["text", "toolExecution"]);
    const exec = msg!.content.find(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolCallId === TCID,
    );
    expect(exec!.args).toBe("ls");
  });

  it("merges incoming toolCall by semantic command when the realtime execution id differs", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-execution-start",
            toolName: "bash",
            args: "git commit -m M6.3",
            status: "running",
            output: "waiting...",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "183 tests, 0 clippy warnings. M6.3 commit:" },
          {
            type: "toolCall",
            id: "tc-message-update",
            name: "bash",
            arguments: { command: "git commit -m M6.3", description: "commit M6.3" },
          },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const execs = msg!.content.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
    );
    expect(msg!.content.map((b) => b.type)).toEqual(["text", "toolExecution"]);
    expect(execs).toHaveLength(1);
    expect(execs[0].toolCallId).toBe("tc-execution-start");
    expect(execs[0].status).toBe("running");
    expect(execs[0].output).toBe("waiting...");
    expect(execs[0].description).toBe("commit M6.3");
  });

  it("ignores delayed message_update for a tool call that is already terminal", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "ls",
            status: "done",
            output: "file.txt\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: false,
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: TCID, name: "bash", arguments: { command: "ls" } }],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const messages = useChatStore.getState().messagesBySession[SID] || [];
    expect(messages).toHaveLength(1);
    const exec = messages[0].content.find(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolCallId === TCID,
    );
    expect(exec?.status).toBe("done");
    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
  });

  it("ignores delayed message_update when terminal tool is not the last assistant message", () => {
    setMessages([
      {
        id: "history-msg",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "cargo build",
            status: "done",
            output: "finished\n",
          },
        ],
        timestamp: Date.now() - 10,
        isStreaming: false,
      },
      {
        id: "live-placeholder",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "streaming" } });

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "stale replay" },
          {
            type: "toolCall",
            id: TCID,
            name: "bash",
            arguments: { command: "cargo build", description: "build" },
          },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const messages = getMessages();
    const blocks = messages.flatMap((msg) =>
      msg.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
          b.type === "toolExecution" && b.toolCallId === TCID,
      ),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("done");
    expect(messages[1].content).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

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
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: vi.fn(),
  extractTokenUsage: vi.fn(() => null),
}));

vi.mock("../../../src/mainview/lib/message-batcher", () => ({
  batchMessageUpdate: (_sessionId: string, apply: () => void) => apply(),
  flushNow: vi.fn(),
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
    getState: vi.fn(() => ({ registerUIRequest: vi.fn(), clearPendingBySession: vi.fn() })),
  },
}));

const { mockSessionStore } = vi.hoisted(() => {
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
    sessionContextMap: Record<string, { tokens: number | null; contextWindow: number }>;
    sessionStatusMap: Record<string, SessionStatus>;
    currentModel: unknown;
    currentThinkingLevel: string;
    availableModels: unknown[];
    projectStartFailed: Record<string, boolean>;
    projectStartError: Record<string, string>;
    _projectVersion: number;
    updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
    updateSessionContext: (sessionId: string, usage: Record<string, unknown>) => void;
    restoreContextFromHistory: (sessionId: string) => void;
  }

  let state: MockSessionState = {
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
    updateSessionStatus: () => {},
    updateSessionContext: () => {},
    restoreContextFromHistory: () => {},
  };

  const listeners = new Set<() => void>();

  const store = {
    getState: () => state,
    setState: (
      partial: Partial<MockSessionState> | ((prev: MockSessionState) => Partial<MockSessionState>),
    ) => {
      const update = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...update };
      listeners.forEach((l) => l());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getInitialState: () => state,
  };

  state.updateSessionStatus = (sessionId: string, status: SessionStatus) => {
    store.setState((s) => ({
      sessionStatusMap: { ...s.sessionStatusMap, [sessionId]: status },
    }));
  };
  state.updateSessionContext = (sessionId: string, usage: Record<string, unknown>) => {
    store.setState((s) => ({
      sessionContextMap: {
        ...s.sessionContextMap,
        [sessionId]: {
          ...(s.sessionContextMap[sessionId] || { tokens: null, contextWindow: 0 }),
          ...usage,
        },
      },
    }));
  };

  return { mockSessionStore: store };
});

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: mockSessionStore,
}));

import { handleAgentEvent } from "../../../src/mainview/lib/agent-event-handler";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { apiClient } from "../../../src/mainview/lib/api-client";

const SID = "test-session-ctx";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

async function flushPromises() {
  await new Promise((r) => setTimeout(r, 0));
}

function setupStreamingAssistant() {
  useChatStore.setState({
    messagesBySession: {
      [SID]: [
        {
          id: "msg-1",
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          timestamp: Date.now(),
          isStreaming: true,
        },
      ],
    },
  });
}

function getContextMap() {
  return useSessionStore.getState().sessionContextMap[SID];
}

function fireMessageEnd(usage?: { input: number; output: number }) {
  handleAgentEvent(SID, {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      usage: usage ?? { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
      stopReason: "end_turn",
      model: "test-model",
    },
    entryId: "entry-1",
  } as Parameters<typeof handleAgentEvent>[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
  });
  useSessionStore.setState({
    sessionStatusMap: {},
    sessionContextMap: {},
    sessionsByProject: {},
  });
  (mockedCall as ReturnType<typeof vi.fn>).mockReset();
  (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue({
    tokens: 12345,
    contextWindow: 200000,
    percent: 6.17,
  });
});

describe("context usage tracking", () => {
  describe("1. Initial load — authoritative context usage", () => {
    it("message_end refreshes tokens from agent.getContextUsage", async () => {
      setupStreamingAssistant();
      fireMessageEnd();
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx).toBeDefined();
      expect(ctx!.tokens).toBe(12345);
      expect(ctx!.contextWindow).toBe(200000);
      expect(mockedCall).toHaveBeenCalledWith("agent.getContextUsage", { sessionId: SID });
    });

    it("message_end without usage still uses authoritative context usage", async () => {
      setupStreamingAssistant();
      handleAgentEvent(SID, {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          usage: undefined as unknown as Parameters<typeof handleAgentEvent>[1]["message"]["usage"],
          stopReason: "end_turn",
          model: "test-model",
        },
        entryId: "entry-no-usage",
      } as Parameters<typeof handleAgentEvent>[1]);
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(12345);
    });
  });

  describe("2. After message_end — tokens come from one source", () => {
    it("does not derive tokens from message usage", async () => {
      mockedCall.mockResolvedValueOnce({ tokens: 70000, contextWindow: 200000, percent: 35 });
      setupStreamingAssistant();
      fireMessageEnd({ input: 5000, output: 2000 });
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx).toBeDefined();
      expect(ctx!.tokens).toBe(70000);
    });

    it("refreshes authoritative value across multiple message_end events", async () => {
      mockedCall
        .mockResolvedValueOnce({ tokens: 40000, contextWindow: 200000, percent: 20 })
        .mockResolvedValueOnce({ tokens: 25000, contextWindow: 200000, percent: 12.5 });
      setupStreamingAssistant();
      fireMessageEnd({ input: 3000, output: 1000 });
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(40000);

      setupStreamingAssistant();
      fireMessageEnd({ input: 2000, output: 500 });
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(25000);
    });
  });

  describe("3. After compaction_end", () => {
    it("refreshes tokens from authoritative context usage, not result.tokensAfter", async () => {
      mockedCall.mockResolvedValueOnce({ tokens: 9000, contextWindow: 200000, percent: 4.5 });
      handleAgentEvent(SID, {
        type: "compaction_end",
        result: { tokensAfter: 3000, tokensBefore: 15000 },
      } as Parameters<typeof handleAgentEvent>[1]);
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx).toBeDefined();
      expect(ctx!.tokens).toBe(9000);
    });

    it("sets tokens to null only when authoritative usage returns null", async () => {
      mockedCall.mockResolvedValueOnce({ tokens: null, contextWindow: 200000, percent: null });
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 8000, contextWindow: 200000 } },
      });

      handleAgentEvent(SID, {
        type: "compaction_end",
        result: {},
      } as Parameters<typeof handleAgentEvent>[1]);
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx!.tokens).toBeNull();
    });

    it("clears compacting status when compaction_end arrives without active streaming", () => {
      useSessionStore.setState({ sessionStatusMap: { [SID]: "compacting" } });

      handleAgentEvent(SID, {
        type: "compaction_end",
        result: { tokensAfter: 3000 },
      } as Parameters<typeof handleAgentEvent>[1]);

      // Without an active streaming assistant message, the running compaction card can disappear
      // immediately; streaming compactions still defer status cleanup to agent_end.
      expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
    });
  });

  describe("4. Existing value not overwritten by missing usage", () => {
    it("pre-existing tokens are replaced by authoritative usage even when message usage is undefined", async () => {
      mockedCall.mockResolvedValueOnce({ tokens: 12000, contextWindow: 200000, percent: 6 });
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 8000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      handleAgentEvent(SID, {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          usage: undefined as unknown as Parameters<typeof handleAgentEvent>[1]["message"]["usage"],
          stopReason: "end_turn",
          model: "test-model",
        },
        entryId: "entry-1",
      } as Parameters<typeof handleAgentEvent>[1]);
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(12000);
    });

    it("pre-existing tokens replaced by authoritative context usage", async () => {
      mockedCall.mockResolvedValueOnce({ tokens: 25000, contextWindow: 200000, percent: 12.5 });
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 8000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      fireMessageEnd({ input: 2000, output: 500 });
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(25000);
    });
  });

  describe("5. Full lifecycle", () => {
    it("agent_start → message_end → compaction_end → message_end", async () => {
      handleAgentEvent(SID, { type: "agent_start" } as Parameters<typeof handleAgentEvent>[1]);
      expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");
      expect(getContextMap()).toBeUndefined();

      mockedCall.mockResolvedValueOnce({ tokens: 20000, contextWindow: 200000, percent: 10 });
      setupStreamingAssistant();
      fireMessageEnd({ input: 15000, output: 5000 });
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(20000);

      mockedCall.mockResolvedValueOnce({ tokens: 5000, contextWindow: 200000, percent: 2.5 });
      handleAgentEvent(SID, {
        type: "compaction_end",
        result: { tokensAfter: 5000 },
      } as Parameters<typeof handleAgentEvent>[1]);
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(5000);

      mockedCall.mockResolvedValueOnce({ tokens: 4000, contextWindow: 200000, percent: 2 });
      setupStreamingAssistant();
      fireMessageEnd({ input: 3000, output: 1000 });
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(4000);
    });
  });

  describe("6. contextWindow preserved during token update", () => {
    it("message_end applies authoritative tokens and contextWindow", async () => {
      mockedCall.mockResolvedValueOnce({ tokens: 15000, contextWindow: 180000, percent: 8.3 });
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 5000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      fireMessageEnd({ input: 1000, output: 500 });
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx!.tokens).toBe(15000);
      expect(ctx!.contextWindow).toBe(180000);
    });

    it("contextWindow is preserved when authoritative response omits it", async () => {
      mockedCall.mockResolvedValueOnce({ tokens: 1500, contextWindow: 0, percent: null });
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 5000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      fireMessageEnd({ input: 0, output: 500 });
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx!.tokens).toBe(1500);
      expect(ctx!.contextWindow).toBe(200000);
    });
  });

  describe("7. Error handling", () => {
    it("message still finalized even without usage", async () => {
      setupStreamingAssistant();
      handleAgentEvent(SID, {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          stopReason: "end_turn",
          model: "test-model",
        },
        entryId: "entry-1",
      } as Parameters<typeof handleAgentEvent>[1]);
      await flushPromises();

      const msgs = useChatStore.getState().messagesBySession[SID];
      expect(msgs).toBeDefined();
      expect(msgs![0].isStreaming).toBe(false);
    });

    it("tokens stay unchanged when authoritative usage has no token value", async () => {
      mockedCall.mockResolvedValueOnce({ tokens: undefined, contextWindow: 0, percent: null });
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 8000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      fireMessageEnd({ input: 0, output: 0 });
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(8000);
      expect(getContextMap()!.contextWindow).toBe(200000);
    });

    it("no prior value and no authoritative token value → contextMap stays undefined", async () => {
      mockedCall.mockResolvedValueOnce({ tokens: undefined, contextWindow: 0, percent: null });
      setupStreamingAssistant();
      handleAgentEvent(SID, {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          stopReason: "end_turn",
          model: "test-model",
        },
        entryId: "entry-1",
      } as Parameters<typeof handleAgentEvent>[1]);
      await flushPromises();

      expect(getContextMap()).toBeUndefined();
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: vi.fn(),
  extractTokenUsage: vi.fn(() => null),
}));

vi.mock("../src/mainview/stores/message-batcher", () => ({
  batchMessageUpdate: (_sessionId: string, apply: () => void) => apply(),
  flushNow: vi.fn(),
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })) },
}));

vi.mock("../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: { getState: vi.fn(() => ({ registerUIRequest: vi.fn() })) },
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
    sessionReady: Record<string, boolean>;
    sessionContextMap: Record<string, { tokens: number | null; contextWindow: number }>;
    sessionStatusMap: Record<string, SessionStatus>;
    queueBySession: Record<string, { steering: string[]; followUp: string[] }>;
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
    sessionReady: {},
    sessionContextMap: {},
    sessionStatusMap: {},
    queueBySession: {},
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

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: mockSessionStore,
}));

import { handleAgentEvent } from "../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { apiClient } from "../src/mainview/lib/api-client";

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
});

describe("context usage tracking", () => {
  describe("1. Initial load — empty context", () => {
    it("sessionContextMap starts empty — tokens undefined", () => {
      expect(getContextMap()).toBeUndefined();
    });

    it("message_end with null tokens from RPC keeps tokens null", async () => {
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens: null,
        contextWindow: 0,
      });
      fireMessageEnd();
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx).toBeUndefined();
    });

    it("message_end with null response keeps context empty", async () => {
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      fireMessageEnd();
      await flushPromises();

      expect(getContextMap()).toBeUndefined();
    });
  });

  describe("2. After message_end — tokens update from RPC", () => {
    it("sets tokens from agent.getContextUsage RPC response", async () => {
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens: 5000,
        contextWindow: 200000,
      });
      fireMessageEnd();
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx).toBeDefined();
      expect(ctx!.tokens).toBe(5000);
      expect(ctx!.contextWindow).toBe(200000);
    });

    it("sets tokens even when contextWindow is 0", async () => {
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens: 5000,
        contextWindow: 0,
      });
      fireMessageEnd();
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx).toBeDefined();
      expect(ctx!.tokens).toBe(5000);
    });
  });

  describe("3. After compaction_end", () => {
    it("sets tokens from result.tokensAfter", () => {
      handleAgentEvent(SID, {
        type: "compaction_end",
        result: { tokensAfter: 3000, tokensBefore: 15000 },
      } as Parameters<typeof handleAgentEvent>[1]);

      const ctx = getContextMap();
      expect(ctx).toBeDefined();
      expect(ctx!.tokens).toBe(3000);
    });

    it("sets tokens to null when tokensAfter is undefined", () => {
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 8000, contextWindow: 200000 } },
      });

      handleAgentEvent(SID, {
        type: "compaction_end",
        result: {},
      } as Parameters<typeof handleAgentEvent>[1]);

      const ctx = getContextMap();
      expect(ctx!.tokens).toBeNull();
    });

    it("sets status back to idle after compaction", () => {
      useSessionStore.setState({ sessionStatusMap: { [SID]: "compacting" } });

      handleAgentEvent(SID, {
        type: "compaction_end",
        result: { tokensAfter: 3000 },
      } as Parameters<typeof handleAgentEvent>[1]);

      expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
    });
  });

  describe("4. Existing value not overwritten by null", () => {
    it("pre-existing tokens=8000 stays when RPC returns tokens=null", async () => {
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 8000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens: null,
        contextWindow: 200000,
      });
      fireMessageEnd();
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(8000);
    });

    it("pre-existing tokens=8000 stays when RPC returns null response", async () => {
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 8000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      fireMessageEnd();
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(8000);
    });
  });

  describe("5. Full lifecycle", () => {
    it("agent_start → message_end → compaction_end → message_end", async () => {
      handleAgentEvent(SID, { type: "agent_start" } as Parameters<typeof handleAgentEvent>[1]);
      expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");
      expect(getContextMap()).toBeUndefined();

      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens: 15000,
        contextWindow: 200000,
      });
      fireMessageEnd();
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(15000);
      expect(getContextMap()!.contextWindow).toBe(200000);

      handleAgentEvent(SID, {
        type: "compaction_end",
        result: { tokensAfter: 5000 },
      } as Parameters<typeof handleAgentEvent>[1]);

      expect(getContextMap()!.tokens).toBe(5000);

      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens: 8000,
        contextWindow: 200000,
      });
      fireMessageEnd();
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(8000);
      expect(getContextMap()!.contextWindow).toBe(200000);
    });
  });

  describe("6. contextWindow also updates", () => {
    it("message_end updates both tokens and contextWindow", async () => {
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 5000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens: 5000,
        contextWindow: 128000,
      });
      fireMessageEnd();
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx!.tokens).toBe(5000);
      expect(ctx!.contextWindow).toBe(128000);
    });

    it("contextWindow not overwritten when RPC returns contextWindow=0", async () => {
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 5000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens: 6000,
        contextWindow: 0,
      });
      fireMessageEnd();
      await flushPromises();

      const ctx = getContextMap();
      expect(ctx!.tokens).toBe(6000);
      expect(ctx!.contextWindow).toBe(200000);
    });
  });

  describe("7. RPC error does not break the flow", () => {
    it("message still finalized when RPC rejects", async () => {
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("RPC failed"));
      fireMessageEnd();
      await flushPromises();

      const msgs = useChatStore.getState().messagesBySession[SID];
      expect(msgs).toBeDefined();
      expect(msgs![0].isStreaming).toBe(false);
    });

    it("tokens stay unchanged when RPC rejects", async () => {
      useSessionStore.setState({
        sessionContextMap: { [SID]: { tokens: 8000, contextWindow: 200000 } },
      });
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("RPC failed"));
      fireMessageEnd();
      await flushPromises();

      expect(getContextMap()!.tokens).toBe(8000);
      expect(getContextMap()!.contextWindow).toBe(200000);
    });

    it("tokens stay null on RPC reject with no prior value", async () => {
      setupStreamingAssistant();
      (mockedCall as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("RPC failed"));
      fireMessageEnd();
      await flushPromises();

      expect(getContextMap()).toBeUndefined();
    });
  });
});

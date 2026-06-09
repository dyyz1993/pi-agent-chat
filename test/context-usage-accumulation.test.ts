import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

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

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })) },
}));

vi.mock("../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: vi.fn(() => ({
      registerUIRequest: vi.fn(),
      clearPendingBySession: vi.fn(),
    })),
  },
}));

type ContextUsage = { tokens: number | null; contextWindow: number };
type SessionStatus = "idle" | "streaming" | "compacting" | "permission" | "retrying";

vi.mock("../src/mainview/stores/use-session-store", () => {
  interface MockSessionState {
    sessionsByProject: Record<string, unknown[]>;
    activeSessionId: string | null;
    projectTabs: unknown[];
    activeProjectId: string | null;
    loading: boolean;
    agentSubscriptions: Record<string, string>;
    batchSubscriptions: Record<string, string>;
    sessionReady: Record<string, boolean>;
    sessionContextMap: Record<string, ContextUsage>;
    sessionStatusMap: Record<string, SessionStatus>;
    queueBySession: Record<string, { steering: string[]; followUp: string[] }>;
    currentModel: unknown;
    currentThinkingLevel: string;
    availableModels: unknown[];
    projectStartFailed: Record<string, boolean>;
    projectStartError: Record<string, string>;
    _projectVersion: number;
    updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
    updateSessionContext: (sessionId: string, usage: Partial<ContextUsage>) => void;
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
    queueBySession: {},
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
      useSessionStore.setState((s) => {
        const prev = s.sessionContextMap[sessionId] || { tokens: null, contextWindow: 0 };
        return {
          sessionContextMap: {
            ...s.sessionContextMap,
            [sessionId]: { ...prev, ...usage },
          },
        };
      });
    },
    restoreContextFromHistory: () => {},
  }));
  return { useSessionStore, clearAgentStarted: () => {} };
});

vi.mock("../src/mainview/stores/use-chat-store", () => {
  const loadSessionMessages = vi.fn(() => Promise.resolve());

  interface ChatMessage {
    id: string;
    role: string;
    content: unknown[];
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
  }));
  return { useChatStore };
});

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() })),
  },
}));

import { handleAgentEvent, toolCallNameMap } from "../src/mainview/stores/agent-event-handler";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { apiClient } from "../src/mainview/lib/api-client";

const SID = "test-session-ctx";

function setStreamingAssistant() {
  useChatStore.setState({
    messagesBySession: {
      [SID]: [
        {
          id: "msg-streaming",
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
          timestamp: Date.now(),
          isStreaming: true,
        },
      ],
    },
  });
}

function emitMessageEnd(usage?: Record<string, number>) {
  handleAgentEvent(SID, {
    type: "message_end",
    entryId: "entry-end-1",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      timestamp: Date.now(),
      ...(usage ? { usage } : {}),
    },
  } as Parameters<typeof handleAgentEvent>[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
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
    sessionContextMap: {},
  });
  Object.keys(toolCallNameMap).forEach((k) => delete toolCallNameMap[k]);
});

describe("message_end context usage accumulation", () => {
  it("sets tokens to absolute context size from usage (input + output)", () => {
    useSessionStore.setState({
      sessionContextMap: { [SID]: { tokens: 0, contextWindow: 200000 } },
    });
    setStreamingAssistant();

    emitMessageEnd({ input: 1000, output: 500 });

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx.tokens).toBe(1500);
  });

  it("replaces tokens with latest usage (not cumulative)", () => {
    useSessionStore.setState({
      sessionContextMap: { [SID]: { tokens: 0, contextWindow: 200000 } },
    });

    setStreamingAssistant();
    emitMessageEnd({ input: 1000, output: 500 });

    setStreamingAssistant();
    emitMessageEnd({ input: 2000, output: 800 });

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx.tokens).toBe(2800);
  });

  it("replaces tokens with absolute value from usage", () => {
    useSessionStore.setState({
      sessionContextMap: { [SID]: { tokens: 5000, contextWindow: 200000 } },
    });
    setStreamingAssistant();

    emitMessageEnd({ input: 1000, output: 500 });

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx.tokens).toBe(1500);
    expect(ctx.contextWindow).toBe(200000);
  });

  it("does not crash when usage is missing and leaves tokens unchanged", () => {
    useSessionStore.setState({
      sessionContextMap: { [SID]: { tokens: 5000, contextWindow: 200000 } },
    });
    setStreamingAssistant();

    emitMessageEnd();

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx.tokens).toBe(5000);
    expect(ctx.contextWindow).toBe(200000);
  });

  it("does not crash when usage is undefined and leaves tokens unchanged", () => {
    useSessionStore.setState({
      sessionContextMap: { [SID]: { tokens: 3000, contextWindow: 128000 } },
    });
    setStreamingAssistant();

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-end-undef",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        timestamp: Date.now(),
        usage: undefined,
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx.tokens).toBe(3000);
    expect(ctx.contextWindow).toBe(128000);
  });

  it("sets tokens from usage when no prior entry", () => {
    useSessionStore.setState({ sessionContextMap: {} });
    setStreamingAssistant();

    emitMessageEnd({ input: 500, output: 200 });

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(700);
  });
});

describe("message_end does NOT call agent.getContextUsage RPC", () => {
  it("never calls apiClient.call with agent.getContextUsage", () => {
    useSessionStore.setState({
      sessionContextMap: { [SID]: { tokens: 0, contextWindow: 200000 } },
    });
    setStreamingAssistant();

    emitMessageEnd({ input: 1000, output: 500 });

    const calls = (apiClient.call as ReturnType<typeof vi.fn>).mock.calls;
    const getContextCalls = calls.filter(
      (call: unknown[]) => (call as [string, unknown])[0] === "agent.getContextUsage",
    );
    expect(getContextCalls).toHaveLength(0);
  });

  it("never calls apiClient.call with agent.getContextUsage even without prior context", () => {
    useSessionStore.setState({ sessionContextMap: {} });
    setStreamingAssistant();

    emitMessageEnd({ input: 2000, output: 100 });

    const calls = (apiClient.call as ReturnType<typeof vi.fn>).mock.calls;
    const getContextCalls = calls.filter(
      (call: unknown[]) => (call as [string, unknown])[0] === "agent.getContextUsage",
    );
    expect(getContextCalls).toHaveLength(0);
  });
});

describe("token replacement with contextWindow preservation", () => {
  it("preserves contextWindow across multiple replacements", () => {
    useSessionStore.setState({
      sessionContextMap: { [SID]: { tokens: 0, contextWindow: 128000 } },
    });

    for (let i = 0; i < 5; i++) {
      setStreamingAssistant();
      emitMessageEnd({ input: 1000, output: 500 });
    }

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx.tokens).toBe(1500);
    expect(ctx.contextWindow).toBe(128000);
  });

  it("works correctly when contextWindow was set by fetchInitialState", () => {
    useSessionStore.setState({
      sessionContextMap: { [SID]: { tokens: null, contextWindow: 200000 } },
    });
    setStreamingAssistant();

    emitMessageEnd({ input: 5000, output: 2000 });

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx.tokens).toBe(7000);
    expect(ctx.contextWindow).toBe(200000);
  });
});

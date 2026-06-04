import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockMemoryStore, mockChatStore } = vi.hoisted(() => {
  type StorePatch<T extends object> = Partial<T> | ((state: T) => Partial<T>);

  function createHoistedMockStore<T extends object>(initialState: T) {
    let state = initialState;
    return {
      getState: () => state,
      setState: (patch: StorePatch<T>) => {
        const nextPatch = typeof patch === "function" ? patch(state) : patch;
        state = { ...state, ...nextPatch };
      },
    };
  }

  interface HoistedMemoryEvent {
    id: string;
    customType: string;
    data: unknown;
    timestamp: number;
  }

  interface HoistedInjectedMemory {
    summary: string;
    snippet: string;
  }

  interface HoistedMemoryStoreState {
    eventsBySession: Record<string, HoistedMemoryEvent[]>;
    filesBySession: Record<string, unknown[]>;
    entrypointBySession: Record<string, unknown>;
    injectedBySession: Record<string, HoistedInjectedMemory[]>;
    expandedFile: string | null;
    collapsedSections: Set<string>;
    addEvent: (sessionId: string, event: HoistedMemoryEvent) => void;
    addInjected: (sessionId: string, injected: HoistedInjectedMemory) => void;
  }

  interface HoistedChatTestMessage {
    id: string;
    role: string;
    content: unknown[];
    timestamp: number;
  }

  interface HoistedChatStoreState {
    messagesBySession: Record<string, HoistedChatTestMessage[]>;
    inputText: string;
    isStreaming: boolean;
    streamContentVersion: number;
    loadingSessions: Set<string>;
    historyLoadVersion: number;
    setMessagesForSession: (sessionId: string, messages: HoistedChatTestMessage[]) => void;
  }

  const memoryStore = createHoistedMockStore<HoistedMemoryStoreState>({
    eventsBySession: {},
    filesBySession: {},
    entrypointBySession: {},
    injectedBySession: {},
    expandedFile: null,
    collapsedSections: new Set(["operations"]),
    addEvent: (sessionId, event) => {
      memoryStore.setState((state) => {
        const existing = state.eventsBySession[sessionId] ?? [];
        return {
          eventsBySession: {
            ...state.eventsBySession,
            [sessionId]: [...existing, event],
          },
        };
      });
    },
    addInjected: (sessionId, injected) => {
      memoryStore.setState((state) => {
        const existing = state.injectedBySession[sessionId] ?? [];
        return {
          injectedBySession: {
            ...state.injectedBySession,
            [sessionId]: [...existing, injected],
          },
        };
      });
    },
  });

  const chatStore = createHoistedMockStore<HoistedChatStoreState>({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set<string>(),
    historyLoadVersion: 0,
    setMessagesForSession: (sessionId, messages) => {
      chatStore.setState((state) => ({
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages,
        },
      }));
    },
  });

  return { mockMemoryStore: memoryStore, mockChatStore: chatStore };
});

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn(), onReconnect: vi.fn() },
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: { getState: vi.fn(() => ({ addEntry: vi.fn() })) },
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: vi.fn(() => ({ addLog: vi.fn() })) },
}));

vi.mock("../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: vi.fn(() => ({ activeSubsessionId: null })) },
  handleSubagentEvent: vi.fn(),
}));

vi.mock("../src/mainview/stores/use-bash-store", () => ({
  useBashStore: { getState: vi.fn(() => ({})) },
  handleBashEvent: vi.fn(),
  handleBackgroundExit: vi.fn(),
}));

vi.mock("../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: { getState: vi.fn(() => ({})) },
}));

vi.mock("../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: { getState: vi.fn(() => ({})) },
}));

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: { getState: vi.fn(() => ({})) },
}));

vi.mock("../src/mainview/stores/message-batcher", () => ({
  batchMessageUpdate: vi.fn((_sid: string, fn: () => void) => fn()),
  flushNow: vi.fn(),
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: mockMemoryStore,
}));

vi.mock("../src/mainview/stores/use-chat-store", () => ({
  useChatStore: mockChatStore,
}));

import { useMemoryStore } from "../src/mainview/stores/use-memory-store";
import { useChatStore } from "../src/mainview/stores/use-chat-store";

beforeEach(() => {
  vi.clearAllMocks();

  useMemoryStore.setState({
    eventsBySession: {},
    filesBySession: {},
    entrypointBySession: {},
    injectedBySession: {},
    expandedFile: null,
    collapsedSections: new Set(["operations"]),
  });

  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set<string>(),
    historyLoadVersion: 0,
  });
});

describe("custom_entry data flow via stores", () => {
  it("memory_prefetch adds event to memory store", () => {
    useMemoryStore.getState().addEvent("sess-1", {
      id: "e1",
      customType: "memory_prefetch",
      data: { query: "user preferences" },
      timestamp: Date.now(),
    });

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toHaveLength(1);
    expect(state.eventsBySession["sess-1"][0].customType).toBe("memory_prefetch");
    expect((state.eventsBySession["sess-1"][0].data as { query: string }).query).toBe(
      "user preferences",
    );
  });

  it("memory_prefetch_result adds injected memory", () => {
    useMemoryStore.getState().addInjected("sess-1", {
      summary: "user likes TypeScript",
      snippet: "prefers TS over JS",
    });

    const state = useMemoryStore.getState();
    expect(state.injectedBySession["sess-1"]).toHaveLength(1);
    expect(state.injectedBySession["sess-1"][0].summary).toBe("user likes TypeScript");
  });

  it("memory_extract adds event", () => {
    useMemoryStore.getState().addEvent("sess-1", {
      id: "e-extract",
      customType: "memory_extract",
      data: { files: ["pref.md"] },
      timestamp: Date.now(),
    });

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toHaveLength(1);
    expect(state.eventsBySession["sess-1"][0].customType).toBe("memory_extract");
  });

  it("handles null data without crash", () => {
    expect(() => {
      useMemoryStore.getState().addEvent("sess-1", {
        id: "e-null",
        customType: "memory_prefetch_result",
        data: null,
        timestamp: Date.now(),
      });
    }).not.toThrow();

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toHaveLength(1);
    expect(state.eventsBySession["sess-1"][0].data).toBeNull();
  });

  it("handles string data without crash", () => {
    expect(() => {
      useMemoryStore.getState().addEvent("sess-1", {
        id: "e-str",
        customType: "memory_dream",
        data: "some string",
        timestamp: Date.now(),
      });
    }).not.toThrow();

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toHaveLength(1);
    expect(state.eventsBySession["sess-1"][0].data).toBe("some string");
  });

  it("handles empty object data without crash", () => {
    expect(() => {
      useMemoryStore.getState().addEvent("sess-1", {
        id: "e-empty",
        customType: "memory_prefetch_result",
        data: {},
        timestamp: Date.now(),
      });
    }).not.toThrow();

    const state = useMemoryStore.getState();
    expect(state.eventsBySession["sess-1"]).toHaveLength(1);
    expect(state.eventsBySession["sess-1"][0].data).toEqual({});
  });

  it("simulates full custom_entry handler flow", () => {
    const sessionId = "sess-1";
    const event = {
      type: "custom_entry" as const,
      customType: "memory_prefetch_result",
      data: { summary: "matched 3 memories", snippet: "context..." },
      id: "custom-123",
    };

    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    chat.setMessagesForSession(sessionId, [
      ...existing,
      {
        id: event.id,
        role: "custom" as const,
        content: [{ type: "custom" as const, customType: event.customType, data: event.data }],
        timestamp: Date.now(),
      },
    ]);

    const memoryStore = useMemoryStore.getState();
    memoryStore.addEvent(sessionId, {
      id: event.id,
      customType: event.customType,
      data: event.data,
      timestamp: Date.now(),
    });

    const data = event.data as { summary?: string; snippet?: string };
    if (data) {
      memoryStore.addInjected(sessionId, {
        summary: data.summary || "",
        snippet: data.snippet || "",
      });
    }

    const chatState = useChatStore.getState();
    expect(chatState.messagesBySession[sessionId]).toHaveLength(1);
    expect(chatState.messagesBySession[sessionId][0].role).toBe("custom");

    const memState = useMemoryStore.getState();
    expect(memState.eventsBySession[sessionId]).toHaveLength(1);
    expect(memState.eventsBySession[sessionId][0].customType).toBe("memory_prefetch_result");
    expect(memState.injectedBySession[sessionId]).toHaveLength(1);
    expect(memState.injectedBySession[sessionId][0].summary).toBe("matched 3 memories");
  });

  it("simulates custom_entry without data in prefetch_result", () => {
    const sessionId = "sess-1";
    const memoryStore = useMemoryStore.getState();

    memoryStore.addEvent(sessionId, {
      id: "e-no-data",
      customType: "memory_prefetch_result",
      data: undefined as unknown,
      timestamp: Date.now(),
    });

    const state = useMemoryStore.getState();
    expect(state.eventsBySession[sessionId]).toHaveLength(1);
    expect(state.injectedBySession[sessionId]).toBeUndefined();
  });
});

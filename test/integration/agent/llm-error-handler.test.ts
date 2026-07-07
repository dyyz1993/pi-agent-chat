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
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: vi.fn(),
  extractTokenUsage: vi.fn(() => null),
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
    restoreContextFromHistory: () => {},
  }));
  return { useSessionStore, clearAgentStarted: () => {} };
});

vi.mock("../../../src/mainview/stores/use-chat-store", () => {
  interface ChatMessage {
    id: string;
    role: string;
    content: ContentBlock[];
    timestamp: number;
    isStreaming?: boolean;
  }
  interface ChatState {
    messagesBySession: Record<string, ChatMessage[]>;
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
    incrementStreamVersion: () => void;
  }
  const useChatStore = create<ChatState>((set) => ({
    messagesBySession: {},
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
    incrementStreamVersion: () =>
      set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),
  }));
  return {
    useChatStore,
    getMemorySemanticTimestamp: (_data: unknown, fallback: number) => fallback,
    insertChatMessageByDisplayOrder: (messages: ChatMessage[], message: ChatMessage) => [
      ...messages,
      message,
    ],
  };
});

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() })),
  },
}));

import { handleAgentEvent } from "../../../src/mainview/lib/agent-event-handler";
import { notificationGateway } from "../../../src/mainview/lib/notification-gateway";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";

const SID = "test-session-llm-error";

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    messagesBySession: {},
    streamContentVersion: 0,
  });
});

describe("extension_llm_error", () => {
  it("emits notification with correct type, title, and error message", () => {
    handleAgentEvent(SID, {
      type: "extension_llm_error",
      error: "Model overloaded",
    } as Parameters<typeof handleAgentEvent>[1]);

    expect(notificationGateway.emit).toHaveBeenCalledWith({
      type: "extension_llm_error",
      sessionId: SID,
      title: "LLM 服务异常",
      body: "Model overloaded",
      level: "warning",
    });
  });

  it("truncates long error messages to 100 chars", () => {
    const longError = "a".repeat(150);

    handleAgentEvent(SID, {
      type: "extension_llm_error",
      error: longError,
    } as Parameters<typeof handleAgentEvent>[1]);

    expect(notificationGateway.emit).toHaveBeenCalledWith({
      type: "extension_llm_error",
      sessionId: SID,
      title: "LLM 服务异常",
      body: `${"a".repeat(100)}...`,
      level: "warning",
    });
  });

  it("uses 'Unknown error' when error is empty", () => {
    handleAgentEvent(SID, {
      type: "extension_llm_error",
      error: "",
    } as Parameters<typeof handleAgentEvent>[1]);

    expect(notificationGateway.emit).toHaveBeenCalledWith({
      type: "extension_llm_error",
      sessionId: SID,
      title: "LLM 服务异常",
      body: "Unknown error",
      level: "warning",
    });
  });

  it("notification level is always warning", () => {
    handleAgentEvent(SID, {
      type: "extension_llm_error",
      error: "timeout",
    } as Parameters<typeof handleAgentEvent>[1]);

    const call = (notificationGateway.emit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.level).toBe("warning");
  });

  it("adds a visible chat error message with the raw provider error", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "please respond" }],
        timestamp: 1000,
      },
    ]);

    handleAgentEvent(SID, {
      type: "extension_llm_error",
      error: "401 Invalid API key",
    } as Parameters<typeof handleAgentEvent>[1]);

    const messages = useChatStore.getState().messagesBySession[SID];
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe("error");
    expect(messages[1].isStreaming).toBe(false);
    expect(messages[1].content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("401 Invalid API key"),
    });
    expect(messages[1].content[0]).toMatchObject({
      text: expect.stringContaining("LLM"),
    });
  });
});

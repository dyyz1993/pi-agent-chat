import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { ContentBlock } from "../src/mainview/types";
import { create } from "zustand";

mock.module("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: mock(),
    subscribe: mock(() => Promise.resolve("sub-id")),
    unsubscribe: mock(),
    onReconnect: mock(),
  },
}));

mock.module("../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: mock() },
}));

mock.module("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

mock.module("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}));

mock.module("../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: mock(),
  extractTokenUsage: mock(() => null),
}));

mock.module("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: mock(() => ({ loadFiles: mock(), addEvent: mock(), addInjected: mock() })),
  },
}));

mock.module("../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: mock(() => ({ startRetry: mock(), endRetry: mock() })) },
}));

mock.module("../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: { getState: mock(() => ({ registerUIRequest: mock() })) },
}));

mock.module("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: mock(() => ({ setPlugins: mock(), setSkills: mock(), setMcpServers: mock() })),
  },
}));

mock.module("../src/mainview/stores/use-session-store", () => {
  type SessionStatus = "idle" | "streaming" | "compacting" | "permission" | "retrying";
  interface MockSessionState {
    sessionsByProject: Record<string, unknown[]>;
    activeSessionId: string | null;
    projectTabs: unknown[];
    activeProjectId: string | null;
    loading: boolean;
    agentSubscriptions: Record<string, string>;
    sessionReady: Record<string, boolean>;
    sessionContextMap: Record<string, unknown>;
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
  const useSessionStore = create<MockSessionState>(() => ({
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
  return { useSessionStore };
});

mock.module("../src/mainview/stores/use-chat-store", () => {
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
  }
  const useChatStore = create<ChatState>(() => ({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
  }));
  return { useChatStore };
});

console.log("about to import");

import { handleAgentEvent, toolCallNameMap } from "../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
const SID = "test-session-1";

describe("agent_start / agent_end", () => {
  beforeEach(() => {
    mock.clearAllMocks();
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
      sessionsByProject: {},
    });
    Object.keys(toolCallNameMap).forEach((k) => delete toolCallNameMap[k]);
  });

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
});

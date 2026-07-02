import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let activeSessionId: string | null = "active-session";
  const messagesBySession: Record<string, unknown[]> = {};

  return {
    get activeSessionId() {
      return activeSessionId;
    },
    setActiveSessionId: (sessionId: string | null) => {
      activeSessionId = sessionId;
    },
    messagesBySession,
    setMessagesForSession: vi.fn((sessionId: string, msgs: unknown[]) => {
      messagesBySession[sessionId] = msgs;
    }),
    updateSessionStatus: vi.fn(),
    clearPendingBySession: vi.fn(),
    registerUIRequest: vi.fn(),
    fetchPending: vi.fn(),
    emitNotification: vi.fn(),
  };
});

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    subscribe: vi.fn().mockResolvedValue("sub-id"),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: () => ({
      messagesBySession: mocks.messagesBySession,
      setMessagesForSession: mocks.setMessagesForSession,
      activeToolCallIdsBySession: {},
      setActiveToolCallIds: vi.fn(),
      loadSessionMessages: vi.fn().mockResolvedValue(undefined),
    }),
  },
  getMemorySemanticTimestamp: (_data: unknown, fallback: number) => fallback,
  insertChatMessageByDisplayOrder: (messages: unknown[], message: unknown) => [
    ...messages,
    message,
  ],
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => ({
      activeSessionId: mocks.activeSessionId,
      sessionStatusMap: {},
      sessionsByProject: {},
      updateSessionStatus: mocks.updateSessionStatus,
      updateSessionContext: vi.fn(),
      scheduleWorkspaceResourceRefresh: vi.fn(),
    }),
    setState: vi.fn(),
  },
  clearAgentStarted: vi.fn(),
}));

vi.mock("../../../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: vi.fn((raw: { role?: string }) => ({
    id: `${raw.role ?? "message"}-1`,
    role: raw.role ?? "assistant",
    content: [{ type: "text", text: "hello" }],
    timestamp: 1,
  })),
  extractTokenUsage: vi.fn(() => null),
}));

vi.mock("../../../src/mainview/lib/message-batcher", () => ({
  batchMessageUpdate: vi.fn((_sessionId: string, fn: () => void) => fn()),
  flushNow: vi.fn(),
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: mocks.emitNotification },
}));

vi.mock("../../../src/mainview/stores/use-session-queue-store", () => ({
  useSessionQueueStore: {
    getState: () => ({ clearSessionQueue: vi.fn(), setSessionQueue: vi.fn() }),
  },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: () => ({
      loadFiles: vi.fn(),
      addEvent: vi.fn(),
      addInjected: vi.fn(),
      addIrrelevantMark: vi.fn(),
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: () => ({ setMcpServers: vi.fn() }),
  },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: {
    getState: () => ({ startRetry: vi.fn(), endRetry: vi.fn() }),
  },
}));

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: () => ({
      clearPendingBySession: mocks.clearPendingBySession,
      registerUIRequest: mocks.registerUIRequest,
      resolveFromRemote: vi.fn(),
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-change-review-store", () => ({
  useChangeReviewStore: {
    getState: () => ({ fetchPending: mocks.fetchPending }),
  },
}));

vi.mock("../../../src/mainview/stores/use-compaction-store", () => ({
  useCompactionStore: {
    getState: () => ({
      activitiesBySession: {},
      clear: vi.fn(),
      markRunning: vi.fn(),
      markFinished: vi.fn(),
    }),
  },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set<string>(),
}));

vi.mock("../../../src/mainview/components/chat/bash-background-process", () => ({
  isBashBackgroundProcessType: vi.fn(() => false),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { handleAgentEvent } from "../../../src/mainview/lib/agent-event-handler";

describe("handleAgentEvent active-session guard", () => {
  beforeEach(() => {
    mocks.setActiveSessionId("active-session");
    for (const key of Object.keys(mocks.messagesBySession)) {
      delete mocks.messagesBySession[key];
    }
    vi.clearAllMocks();
  });

  it("drops render-heavy message events for inactive sessions", () => {
    handleAgentEvent("background-session", {
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: "background" }] },
    } as never);

    expect(mocks.setMessagesForSession).not.toHaveBeenCalled();
    expect(mocks.messagesBySession["background-session"]).toBeUndefined();
  });

  it("keeps status events for inactive sessions so sidebars can update", () => {
    handleAgentEvent("background-session", { type: "agent_start" } as never);

    expect(mocks.updateSessionStatus).toHaveBeenCalledWith("background-session", "streaming");
  });
});

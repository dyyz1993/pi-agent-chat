/**
 * @vitest-environment node
 *
 * Regression: sendMessage must refuse while a session switch (createNewSession)
 * is pending. Root cause (reproduced on the deployed host 2026-09-11): until
 * setActiveSession commits, activeSessionId still points at the PREVIOUS
 * session — an Enter-send in that window delivered the prompt to the old
 * session (server log: agent.send carried the old sessionId), and the switch
 * then unsubscribed the old session's events, so the user watched an empty
 * new session while the turn ran invisibly elsewhere.
 */
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

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn(), mode: "web" })),
  },
}));

// Mutable session-store mock: the test flips isSwitchingSession.
const sessionStateMock = {
  activeSessionId: "old-session",
  isSwitchingSession: false,
  sessionStatusMap: {} as Record<string, string>,
  updateSessionStatus: vi.fn(),
};

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: vi.fn(() => sessionStateMock),
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: vi.fn(() => ({ activeSubsessionId: null })) },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

import { apiClient } from "../../../src/mainview/lib/api-client";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStateMock.activeSessionId = "old-session";
  sessionStateMock.isSwitchingSession = false;
  useChatStore.setState({
    inputText: "",
    messagesBySession: {},
    pendingImages: [],
    isStreaming: false,
    hasTrimmedTailMessagesBySession: {},
  });
});

describe("regression: send during pending session switch", () => {
  it("sendMessage is ignored while isSwitchingSession and the draft is preserved", async () => {
    sessionStateMock.isSwitchingSession = true;
    useChatStore.setState({ inputText: "hello new session" });

    await useChatStore.getState().sendMessage();

    expect(apiClient.call).not.toHaveBeenCalled();
    expect(useChatStore.getState().inputText).toBe("hello new session");
  });

  it("sendMessage proceeds after the switch commits", async () => {
    sessionStateMock.isSwitchingSession = false;
    useChatStore.setState({ inputText: "hello new session" });
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await useChatStore.getState().sendMessage();

    const sendCalls = (apiClient.call as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "agent.send",
    );
    expect(sendCalls.length).toBeGreaterThan(0);
  });
});

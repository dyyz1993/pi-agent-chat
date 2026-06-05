import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn() })),
  },
}));

const pushMock = vi.fn();
vi.mock("../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: pushMock })),
  },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: vi.fn(),
  useSessionStore: {
    getState: vi.fn(() => ({
      activeSessionId: "sess-1",
      sessionReady: { "sess-1": true },
      sessionsByProject: {},
      sessionContextMap: {},
      restoreContextFromHistory: vi.fn(),
      updateSessionStatus: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: {
    getState: vi.fn(() => ({ activeSubsessionId: null })),
  },
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({
      addEvent: vi.fn(),
      addInjected: vi.fn(),
    })),
  },
}));

vi.mock("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch_result"]),
}));

vi.mock("../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: (raw: Record<string, unknown>) => ({
    id: raw.id ?? `msg-${Date.now()}`,
    role: raw.role ?? "user",
    content: raw.content ?? [{ type: "text", text: raw.content ?? "" }],
    timestamp: raw.timestamp ?? Date.now(),
  }),
}));

import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { apiClient } from "../src/mainview/lib/api-client";
import { clearAgentStarted, useSessionStore } from "../src/mainview/stores/use-session-store";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;
const mockedSessionGetState = useSessionStore.getState as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  pushMock.mockReset();
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
  });
  mockedCall.mockReset();
  mockedCall.mockResolvedValue({ ok: true });
  mockedSessionGetState.mockReturnValue({
    activeSessionId: "sess-1",
    sessionReady: { "sess-1": true },
    sessionsByProject: {},
    sessionContextMap: {},
    restoreContextFromHistory: vi.fn(),
    updateSessionStatus: vi.fn(),
  });
});

describe("sendMessage error notification", () => {
  beforeEach(() => {
    useChatStore.getState().setInputText("hello");
  });

  it("should push error notification when agent.send RPC fails", async () => {
    mockedCall.mockRejectedValueOnce(new Error("connection lost"));

    await useChatStore.getState().sendMessage();

    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("Send failed"),
      }),
    );
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("should not retry agent.send for unrelated send errors", async () => {
    mockedCall.mockRejectedValueOnce(new Error("connection lost"));

    await useChatStore.getState().sendMessage();

    expect(mockedCall).toHaveBeenCalledTimes(1);
    expect(mockedCall).toHaveBeenCalledWith("agent.send", {
      sessionId: "sess-1",
      content: "hello",
      images: [],
    });
  });

  it("should show actionable disconnect message when backend cannot recover the session", async () => {
    mockedCall.mockRejectedValueOnce(new Error("Agent not started for session sess-1"));

    await useChatStore.getState().sendMessage();

    expect(clearAgentStarted).toHaveBeenCalledWith("sess-1");
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("刷新页面或重连"),
      }),
    );
    expect(useChatStore.getState().inputText).toBe("hello");
  });
});

describe("sendSteer error notification", () => {
  it("should push error notification when agent.steer RPC fails", async () => {
    useChatStore.getState().setInputText("steer text");
    mockedCall.mockRejectedValueOnce(new Error("timeout"));

    await useChatStore.getState().sendSteer();

    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("Steer failed"),
      }),
    );
  });
});

describe("sendFollowUp error notification", () => {
  it("should push error notification when agent.followUp RPC fails", async () => {
    useChatStore.getState().setInputText("follow up text");
    mockedCall.mockRejectedValueOnce(new Error("network error"));

    await useChatStore.getState().sendFollowUp();

    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("Follow-up failed"),
      }),
    );
  });
});

describe("sendMessage session readiness", () => {
  it("should still send when session messages are visible but readiness is not settled", async () => {
    mockedSessionGetState.mockReturnValue({
      activeSessionId: "sess-1",
      sessionReady: { "sess-1": false },
      sessionContextMap: {},
      restoreContextFromHistory: vi.fn(),
      updateSessionStatus: vi.fn(),
    });
    useChatStore.getState().setInputText("test");

    await useChatStore.getState().sendMessage();

    expect(mockedCall).toHaveBeenCalledWith("agent.send", {
      sessionId: "sess-1",
      content: "test",
      images: [],
    });
    expect(pushMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("not ready") }),
    );
  });
});

describe("sendMessage no active session", () => {
  it("should push warning notification when no active session", async () => {
    mockedSessionGetState.mockReturnValue({
      activeSessionId: null,
      sessionReady: {},
      sessionContextMap: {},
      restoreContextFromHistory: vi.fn(),
    });
    useChatStore.getState().setInputText("test");

    await useChatStore.getState().sendMessage();

    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
        message: expect.stringContaining("No active session"),
      }),
    );
  });
});

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
  markAgentStarted: vi.fn(),
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
import {
  markAgentStarted,
  clearAgentStarted,
  useSessionStore,
} from "../src/mainview/stores/use-session-store";

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

  it("should restart and retry once when backend no longer has the started session", async () => {
    const updateSessionStatus = vi.fn();
    mockedSessionGetState.mockReturnValue({
      activeSessionId: "sess-1",
      sessionReady: { "sess-1": true },
      sessionsByProject: {
        "/tmp/project": [
          {
            sessionId: "sess-1",
            name: "test",
            sessionPath: "/tmp/project/.pi/sess-1.jsonl",
            projectPath: "/tmp/project",
            parentSessionPath: null,
            delegateParentSessionId: null,
            delegateType: null,
            messageCount: 0,
            firstMessage: "",
            createdAt: 1,
            updatedAt: 1,
            status: "idle",
          },
        ],
      },
      sessionContextMap: {},
      restoreContextFromHistory: vi.fn(),
      updateSessionStatus,
    });
    mockedCall
      .mockRejectedValueOnce(new Error("Agent not started for session sess-1"))
      .mockResolvedValueOnce({ status: "started", agentId: "agent-1" })
      .mockResolvedValueOnce({ ok: true });

    await useChatStore.getState().sendMessage();

    expect(mockedCall).toHaveBeenNthCalledWith(1, "agent.send", {
      sessionId: "sess-1",
      content: "hello",
      images: [],
    });
    expect(mockedCall).toHaveBeenNthCalledWith(2, "agent.start", {
      sessionId: "sess-1",
      projectPath: "/tmp/project",
      sessionPath: "/tmp/project/.pi/sess-1.jsonl",
    });
    expect(mockedCall).toHaveBeenNthCalledWith(3, "agent.send", {
      sessionId: "sess-1",
      content: "hello",
      images: [],
    });
    expect(clearAgentStarted).toHaveBeenCalledWith("sess-1");
    expect(markAgentStarted).toHaveBeenCalledWith("sess-1");
    expect(pushMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("Send failed"),
      }),
    );
    expect(useChatStore.getState().inputText).toBe("");
    expect(useChatStore.getState().messagesBySession["sess-1"]).toHaveLength(1);
    expect(updateSessionStatus).toHaveBeenLastCalledWith("sess-1", "streaming");
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

describe("sendMessage session not ready", () => {
  it("should push warning notification when session is not ready", async () => {
    mockedSessionGetState.mockReturnValue({
      activeSessionId: "sess-1",
      sessionReady: { "sess-1": false },
      sessionContextMap: {},
      restoreContextFromHistory: vi.fn(),
    });
    useChatStore.getState().setInputText("test");

    await useChatStore.getState().sendMessage();

    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
        message: expect.stringContaining("not ready"),
      }),
    );
    expect(useChatStore.getState().inputText).toBe("test");
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

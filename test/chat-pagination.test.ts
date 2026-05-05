import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../src/mainview/stores/use-session-store", () => {
  const state: Record<string, unknown> = {
    activeSessionId: "test-session",
    sessionReady: { "test-session": true },
    sessionStatusMap: {},
    restoreContextFromHistory: vi.fn(),
  };
  return {
    useSessionStore: {
      getState: () => state,
      setState: (patch: Record<string, unknown>) => Object.assign(state, patch),
    },
  };
});

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: { getState: () => ({ addEvent: vi.fn(), addInjected: vi.fn() }) },
}));

vi.mock("../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: () => ({ activeSubsessionId: null }) },
}));

vi.mock("../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: { getState: () => ({}) },
  deriveSkillScope: vi.fn(),
  derivePluginScope: vi.fn(),
}));

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: { getState: () => ({ setNavId: vi.fn() }) },
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: { getState: () => ({ setActive: vi.fn() }) },
}));

vi.mock("../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  clearSubscriptionState: vi.fn(),
  syncTabsToBackend: vi.fn(),
}));

import { apiClient } from "../src/mainview/lib/api-client";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";

const PAGE_SIZE = 50;

function makeRawMessage(index: number, role: "user" | "assistant" = "user") {
  return {
    id: `msg-${index}`,
    role,
    content: [{ type: "text", text: `Message ${index}` }],
    timestamp: 1000 + index * 100,
  };
}

function makeRpcResult(count: number, startIndex = 0) {
  const messages = [];
  for (let i = 0; i < count; i++) {
    messages.push(
      makeRawMessage(startIndex + i, (startIndex + i) % 2 === 0 ? "user" : "assistant"),
    );
  }
  return { messages, customEntries: [] };
}

describe("chat pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      messagesBySession: {},
      inputText: "",
      isStreaming: false,
      streamContentVersion: 0,
      loadingSessions: new Set(),
      historyLoadVersion: 0,
      hasMoreMessagesBySession: {},
      isLoadingMoreBySession: {},
    });
    useSessionStore.setState({
      activeSessionId: "test-session",
      sessionReady: { "test-session": true },
      sessionStatusMap: {},
      restoreContextFromHistory: vi.fn(),
    });
  });

  it("initial load should request only recent N messages", async () => {
    const allMessages = makeRpcResult(120);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: allMessages.messages,
      customEntries: [],
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const msgs = useChatStore.getState().messagesBySession["test-session"];
    expect(msgs).toBeDefined();
    expect(msgs.length).toBeLessThanOrEqual(120);
    expect(apiClient.call).toHaveBeenCalledWith(
      "agent.getFullMessages",
      expect.objectContaining({ sessionId: "test-session" }),
    );
  });

  it("loadMoreMessages should prepend older messages", async () => {
    const allMessages = makeRpcResult(100);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: allMessages.messages,
      customEntries: [],
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const initialMsgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(initialMsgs.length).toBe(PAGE_SIZE);

    expect(useChatStore.getState().hasMoreMessagesBySession!["test-session"]).toBe(true);

    await useChatStore.getState().loadMoreMessages!("test-session");

    const afterLoadMore = useChatStore.getState().messagesBySession["test-session"]!;
    expect(afterLoadMore.length).toBe(100);
    expect(afterLoadMore[0].id).toBe("msg-0");
    expect(afterLoadMore[PAGE_SIZE].id).toBe(`msg-${PAGE_SIZE}`);
  });

  it("should not request more when hasMoreMessages is false", async () => {
    const allMessages = makeRpcResult(30);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: allMessages.messages,
      customEntries: [],
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const initialMsgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(initialMsgs.length).toBe(30);

    const callCount = (apiClient.call as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(useChatStore.getState().hasMoreMessagesBySession!["test-session"]).toBe(false);

    await useChatStore.getState().loadMoreMessages!("test-session");

    expect((apiClient.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
  });

  it("new messages should append to bottom without affecting pagination", async () => {
    const allMessages = makeRpcResult(30);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: allMessages.messages,
      customEntries: [],
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const newMsg = {
      id: "msg-new-1",
      role: "user" as const,
      content: [{ type: "text" as const, text: "New message" }],
      timestamp: Date.now(),
    };
    useChatStore.getState().addMessage(newMsg);

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(msgs.length).toBe(31);
    expect(msgs[msgs.length - 1].id).toBe("msg-new-1");
    expect(useChatStore.getState().hasMoreMessagesBySession!["test-session"]).toBe(false);
  });

  it("should track hasMoreMessages based on initial load result", async () => {
    const manyMessages = makeRpcResult(200);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: manyMessages.messages,
      customEntries: [],
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(msgs.length).toBe(PAGE_SIZE);
    expect(useChatStore.getState().hasMoreMessagesBySession!["test-session"]).toBe(true);
  });

  it("isLoadingMore should be true during loadMoreMessages and false after", async () => {
    const manyMessages = makeRpcResult(200);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: manyMessages.messages,
      customEntries: [],
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    let resolveLoadMore: () => void = () => {};
    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((r) => {
          resolveLoadMore = () => r({ messages: manyMessages.messages, customEntries: [] });
        }),
    );

    const promise = useChatStore.getState().loadMoreMessages!("test-session");

    expect(useChatStore.getState().isLoadingMoreBySession!["test-session"]).toBe(true);

    resolveLoadMore();
    await promise;

    expect(useChatStore.getState().isLoadingMoreBySession!["test-session"]).toBe(false);
  });
});

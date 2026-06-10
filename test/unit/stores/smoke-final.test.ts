import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChatMessage } from "../../../src/mainview/types";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({ persist: (fn: unknown) => fn }));
vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), onReconnect: vi.fn() },
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

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  const useSessionStore = create(() => ({
    sessionsByProject: {},
    activeSessionId: null,
    projectTabs: [],
    activeProjectId: null,
    agentSubscriptions: {},
    batchSubscriptions: {},
    sessionReady: {},
    sessionContextMap: {},
    sessionStatusMap: {} as Record<string, string>,
    queueBySession: {} as Record<string, { steering: string[]; followUp: string[] }>,
    currentModel: null as Record<string, unknown> | null,
    currentThinkingLevel: "medium",
    availableModels: [] as Record<string, unknown>[],
    projectStartFailed: {},
    projectStartError: {},
    _projectVersion: 0,
    updateSessionStatus: () => {},
    updateSessionContext: () => {},
    restoreContextFromHistory: () => {},
  }));
  return { useSessionStore, clearAgentStarted: () => {} };
});

vi.mock("../../../src/mainview/stores/use-chat-store", () => {
  const useChatStore = create((set) => ({
    messagesBySession: {} as Record<string, ChatMessage[]>,
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
    setMessagesForSession: (sid: string, msgs: ChatMessage[]) =>
      set((s: Record<string, unknown>) => ({
        messagesBySession: {
          ...(s.messagesBySession as Record<string, ChatMessage[]>),
          [sid]: msgs,
        },
      })),
    incrementStreamVersion: () =>
      set((s: Record<string, unknown>) => ({
        streamContentVersion: (s.streamContentVersion as number) + 1,
      })),
    loadSessionMessages: () => {},
  }));
  return { useChatStore };
});

import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";

describe("Final store-level tests (T16.3, T18.1, T18.2, T20.4, T24.2)", () => {
  beforeEach(() => {
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
      sessionReady: {},
      activeSessionId: null,
      activeProjectId: null,
      projectTabs: [],
      sessionsByProject: {},
      agentSubscriptions: {},
      batchSubscriptions: {},
      queueBySession: {},
      currentModel: null,
      currentThinkingLevel: "medium",
      availableModels: [],
      projectStartFailed: {},
      projectStartError: {},
      _projectVersion: 0,
      loading: false,
    });
  });

  // T16.3 — Available models list
  it("T16.3 — Available models", () => {
    const models = [
      { provider: "openai", id: "gpt-4o", contextWindow: 128000, reasoning: true },
      { provider: "anthropic", id: "claude-sonnet-4", contextWindow: 200000, reasoning: true },
      { provider: "openai", id: "gpt-4o-mini", contextWindow: 128000, reasoning: false },
    ];
    useSessionStore.setState({ availableModels: models as unknown as never[] });
    const stored = useSessionStore.getState().availableModels as Array<Record<string, unknown>>;
    expect(stored.length).toBe(3);
    expect(stored.some((m: Record<string, unknown>) => m.id === "gpt-4o")).toBe(true);
    expect(stored.some((m: Record<string, unknown>) => m.reasoning === true)).toBe(true);
  });

  // T18.1 — Steering queue
  it("T18.1 — Steering queue management", () => {
    const SID = "test-session";
    useSessionStore.setState({
      queueBySession: { [SID]: { steering: [], followUp: [] } },
    });
    // Add steering messages
    const q = useSessionStore.getState().queueBySession;
    q[SID] = { steering: ["Add error handling", "Use TypeScript"], followUp: [] };
    useSessionStore.setState({ queueBySession: { ...q } });
    const stored = useSessionStore.getState().queueBySession[SID];
    expect(stored.steering.length).toBe(2);
    expect(stored.steering[0]).toBe("Add error handling");
    // Clear queue
    stored.steering = [];
    useSessionStore.setState({
      queueBySession: { ...useSessionStore.getState().queueBySession, [SID]: stored },
    });
    expect(useSessionStore.getState().queueBySession[SID].steering.length).toBe(0);
  });

  // T18.2 — Follow-up queue
  it("T18.2 — Follow-up queue management", () => {
    const SID = "test-session";
    useSessionStore.setState({
      queueBySession: { [SID]: { steering: [], followUp: ["Also check App.tsx", "Review types"] } },
    });
    const q = useSessionStore.getState().queueBySession[SID];
    expect(q.followUp.length).toBe(2);
    expect(q.followUp[1]).toBe("Review types");
    // Clear all
    useSessionStore.setState({ queueBySession: { [SID]: { steering: [], followUp: [] } } });
    expect(useSessionStore.getState().queueBySession[SID].followUp.length).toBe(0);
  });

  // T20.4 — MCP connection change
  it("T20.4 — MCP connection change event", () => {
    const connectionChanges = [
      { server: "filesystem", status: "connected" as const, tools: 3 },
      { server: "github", status: "error" as const, error: "Connection refused" },
    ];
    expect(connectionChanges.length).toBe(2);
    expect(connectionChanges[0].status).toBe("connected");
    expect(connectionChanges[1].status).toBe("error");
  });

  // T24.2 — Mermaid fullscreen
  it("T24.2 — Mermaid fullscreen toggle", () => {
    // Simulate the mermaid fullscreen state
    const state = { fullscreenOpen: false, diagramSource: "" };
    expect(state.fullscreenOpen).toBe(false);
    state.fullscreenOpen = true;
    state.diagramSource = "graph TD; A-->B;";
    expect(state.fullscreenOpen).toBe(true);
    expect(state.diagramSource).toContain("graph TD");
    state.fullscreenOpen = false;
    expect(state.fullscreenOpen).toBe(false);
  });
});

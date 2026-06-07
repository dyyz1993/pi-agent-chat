import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockStores } = vi.hoisted(() => {
  const emptyStore = (state: Record<string, unknown> = {}) => ({
    getState: () => ({ ...state }),
    subscribe: vi.fn(),
  });
  return {
    mockStores: {
      session: emptyStore({
        activeSessionId: "test-session-id",
        activeProjectId: "test-project-id",
        projectTabs: [] as unknown[],
        sessionsByProject: {},
        agentSubscriptions: {},
        subagentSubscriptions: {},
        todoSubscriptions: {},
        bashSubscriptions: {},
        lspSubscriptions: {},
        rulesSubscriptions: {},
        notifySubscriptions: {},
        memorySubscriptions: {},
        todosBySession: {},
        sessionContextMap: {},
        sessionStatusMap: {},
      }),
      chat: emptyStore({ messagesBySession: {} }),
      turn: emptyStore({ selectedMessageIdsBySession: {} }),
      chatNav: emptyStore({
        activeIdBySession: {},
        selectedItemsBySession: {},
        collapsedTurnsBySession: {},
      }),
      memory: emptyStore({ eventsBySession: {} }),
      rules: emptyStore({ bySession: {} }),
      rpcDebug: emptyStore({ entries: [] as unknown[] }),
    },
  };
});

vi.mock("../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: mockStores.session,
}));

vi.mock("../src/mainview/stores/use-chat-store", () => ({
  useChatStore: mockStores.chat,
}));

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: mockStores.turn,
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: mockStores.chatNav,
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: mockStores.memory,
}));

vi.mock("../src/mainview/stores/use-rules-store", () => ({
  useRulesStore: mockStores.rules,
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: mockStores.rpcDebug,
}));

import { clearStartupPerfEvents, createStartupTrace } from "../src/mainview/lib/startup-monitor";
import { useDiagnosticStore } from "../src/mainview/stores/use-diagnostic-store";

describe("useDiagnosticStore", () => {
  beforeEach(() => {
    clearStartupPerfEvents();
    useDiagnosticStore.setState({
      open: false,
      snapshot: null,
      autoRefresh: true,
      refreshIntervalMs: 2000,
      history: [],
    });
  });

  it("initial state: open=false, autoRefresh=true, history=[]", () => {
    const s = useDiagnosticStore.getState();
    expect(s.open).toBe(false);
    expect(s.autoRefresh).toBe(true);
    expect(s.history).toEqual([]);
  });

  it("toggle sets open to true", () => {
    useDiagnosticStore.getState().toggle();
    expect(useDiagnosticStore.getState().open).toBe(true);
  });

  it("toggle again sets open back to false", () => {
    useDiagnosticStore.getState().toggle();
    useDiagnosticStore.getState().toggle();
    expect(useDiagnosticStore.getState().open).toBe(false);
  });

  it("setOpen(true) sets open to true", () => {
    useDiagnosticStore.getState().setOpen(true);
    expect(useDiagnosticStore.getState().open).toBe(true);
  });

  it("setAutoRefresh(false) sets autoRefresh to false", () => {
    useDiagnosticStore.getState().setAutoRefresh(false);
    expect(useDiagnosticStore.getState().autoRefresh).toBe(false);
  });

  it("setRefreshInterval sets refreshIntervalMs", () => {
    useDiagnosticStore.getState().setRefreshInterval(5000);
    expect(useDiagnosticStore.getState().refreshIntervalMs).toBe(5000);
  });

  it("clearHistory clears history array", () => {
    useDiagnosticStore.getState().takeSnapshot();
    expect(useDiagnosticStore.getState().history.length).toBeGreaterThan(0);
    useDiagnosticStore.getState().clearHistory();
    expect(useDiagnosticStore.getState().history).toEqual([]);
  });

  it("takeSnapshot creates snapshot and appends to history", () => {
    useDiagnosticStore.getState().takeSnapshot();
    const s = useDiagnosticStore.getState();
    expect(s.snapshot).not.toBeNull();
    expect(s.history.length).toBe(1);
    expect(s.history[0]).toEqual(s.snapshot);
  });

  it("takeSnapshot includes recent startup perf events", () => {
    const trace = createStartupTrace("app.restore");
    trace.done("active-session.selected", { sessionId: "sess_1" });

    useDiagnosticStore.getState().takeSnapshot();

    const snap = useDiagnosticStore.getState().snapshot;
    expect(snap?.startupPerfEvents.map((event) => event.phase)).toEqual([
      "begin",
      "active-session.selected",
    ]);
  });
});

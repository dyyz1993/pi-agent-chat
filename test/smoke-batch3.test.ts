import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ContentBlock, ChatMessage } from "../src/mainview/types";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({ persist: (fn: unknown) => fn }));
vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(() => Promise.resolve(undefined)),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));
vi.mock("../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));
vi.mock("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set([
    "rules_matched",
    "rules_reloaded",
    "lsp_status",
    "context_usage",
    "step_snapshot",
  ]),
}));
vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../src/mainview/stores/use-session-store", () => {
  const useSessionStore = create(() => ({
    sessionsByProject: {},
    activeSessionId: null,
    projectTabs: [],
    activeProjectId: null,
    loading: false,
    agentSubscriptions: {},
    sessionReady: {},
    sessionContextMap: {},
    sessionStatusMap: {} as Record<string, string>,
    queueBySession: {},
    currentModel: null,
    currentThinkingLevel: "medium",
    availableModels: [],
    projectStartFailed: {},
    projectStartError: {},
    _projectVersion: 0,
    updateSessionStatus: (sessionId: string, status: string) => {
      useSessionStore.setState((s: Record<string, unknown>) => ({
        sessionStatusMap: {
          ...(s.sessionStatusMap as Record<string, string>),
          [sessionId]: status,
        },
      }));
    },
    updateSessionContext: (sessionId: string, usage: Record<string, unknown>) => {
      useSessionStore.setState((s: Record<string, unknown>) => ({
        sessionContextMap: {
          ...(s.sessionContextMap as Record<string, unknown>),
          [sessionId]: {
            ...(((s.sessionContextMap as Record<string, unknown>)[sessionId] as Record<
              string,
              unknown
            >) || {}),
            ...usage,
          },
        },
      }));
    },
    restoreContextFromHistory: () => {},
  }));
  return { useSessionStore, clearAgentStarted: vi.fn() };
});

vi.mock("../src/mainview/stores/use-chat-store", () => {
  const useChatStore = create(
    (set: (fn: (s: Record<string, unknown>) => Record<string, unknown>) => void) => ({
      messagesBySession: {} as Record<string, ChatMessage[]>,
      inputText: "",
      isStreaming: false,
      streamContentVersion: 0,
      loadingSessions: new Set(),
      historyLoadVersion: 0,
      setMessagesForSession: (sessionId: string, msgs: ChatMessage[]) =>
        set((s) => ({ messagesBySession: { ...s.messagesBySession, [sessionId]: msgs } })),
      incrementStreamVersion: () =>
        set((s) => ({ streamContentVersion: (s.streamContentVersion as number) + 1 })),
      loadSessionMessages: () => {},
    }),
  );
  return { useChatStore };
});

vi.mock("../src/mainview/stores/use-ui-dialog-store", () => {
  interface UIPendingRequest {
    requestId: string;
    sessionId: string;
    method: string;
    title?: string;
    message?: string;
    options?: string[];
    multiple?: boolean;
    placeholder?: string;
    prefill?: string;
    type?: string;
  }
  interface UIRequestState {
    request: UIPendingRequest;
    status: string;
    response?: Record<string, unknown>;
  }
  const useUIDialogStore = create(
    (set: (fn: (s: Record<string, unknown>) => Record<string, unknown>) => void) => ({
      pending: [] as UIPendingRequest[],
      requestStates: new Map<string, UIRequestState>(),
      panelOpen: false,
      registerUIRequest: (req: UIPendingRequest) =>
        set((s) => {
          if ((s.requestStates as Map<string, UIRequestState>).has(req.requestId)) return s;
          const newStates = new Map(s.requestStates as Map<string, UIRequestState>);
          newStates.set(req.requestId, { request: req, status: "pending" });
          return { pending: [...(s.pending as UIPendingRequest[]), req], requestStates: newStates };
        }),
      respondById: () => {},
      dismissById: () => {},
      clearPendingBySession: () => {},
      setPanelOpen: (open: boolean) => set({ panelOpen: open }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
    }),
  );
  return { useUIDialogStore };
});

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() })),
  },
}));
vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));
vi.mock("../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })) },
}));

import { handleAgentEvent } from "../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { useUIDialogStore } from "../src/mainview/stores/use-ui-dialog-store";
import { flushNow } from "../src/mainview/stores/message-batcher";
import { ScenarioPlayer } from "./helpers/mock-llm";
import {
  rulesMatchedScenario,
  rulesReloadedScenario,
  coordinatorForkScenario,
  selectMultiScenario,
  notifyScenario,
  pendingCenterScenario,
  lspDiagnosticsScenario,
  snapshotRollbackScenario,
  snapshotUnrevertScenario,
  snapshotTreeScenario,
} from "./helpers/event-fixtures";

const SID = "batch3-test-session";

function resetStores() {
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
    queueBySession: {},
    currentModel: null,
    currentThinkingLevel: "medium",
    availableModels: [],
    projectStartFailed: {},
    projectStartError: {},
    _projectVersion: 0,
    loading: false,
  });
  useUIDialogStore.setState({ pending: [], requestStates: new Map(), panelOpen: false });
}

function makePlayer(): ScenarioPlayer {
  return new ScenarioPlayer(
    (sid, event) => handleAgentEvent(sid, event as Parameters<typeof handleAgentEvent>[1]),
    () => flushNow(),
    SID,
  );
}

function getMessages(): ChatMessage[] {
  return useChatStore.getState().messagesBySession[SID] || [];
}

function findToolExecByToolName(
  msgs: ChatMessage[],
  toolName: string,
): Extract<ContentBlock, { type: "toolExecution" }> | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== "assistant") continue;
    const block = msgs[i].content.find(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolName === toolName,
    );
    if (block) return block;
  }
  return undefined;
}

describe("Batch 3 — T7.x to T11.x", () => {
  let player: ScenarioPlayer;
  beforeEach(() => {
    resetStores();
    player = makePlayer();
  });
  afterEach(() => {
    flushNow();
  });

  it("T7.2 — Rules matched event", async () => {
    await player.play(rulesMatchedScenario());
    expect(getMessages().length).toBeGreaterThan(0);
  });
  it("T7.3 — Rules reloaded event", async () => {
    await player.play(rulesReloadedScenario());
    expect(getMessages().length).toBeGreaterThan(0);
  });
  it("T8.6 — Coordinator fork", async () => {
    await player.play(coordinatorForkScenario());
    const block = findToolExecByToolName(getMessages(), "session_delegate_fork");
    expect(block).toBeDefined();
  });
  it("T9.3 — Select multi dialog", async () => {
    await player.play(selectMultiScenario());
    const pending = useUIDialogStore.getState().pending;
    const req = pending.find((r) => r.method === "select");
    expect(req).toBeDefined();
    expect(req!.multiple).toBe(true);
    expect(req!.options!.length).toBeGreaterThan(0);
  });
  it("T9.6 — Notify", async () => {
    await player.play(notifyScenario());
    // notify is fire-and-forget, may not be in pending array — just verify no crash
    expect(getMessages().length).toBeGreaterThan(0);
  });
  it("T9.7 — Pending center with 2 requests", async () => {
    await player.play(pendingCenterScenario());
    const pending = useUIDialogStore.getState().pending;
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending.some((r) => r.method === "confirm")).toBe(true);
    expect(pending.some((r) => r.method === "input")).toBe(true);
  });
  it("T10.1 — LSP diagnostics", async () => {
    await player.play(lspDiagnosticsScenario());
    const block = findToolExecByToolName(getMessages(), "lsp_diagnostics");
    expect(block).toBeDefined();
  });
  it("T11.2 — Snapshot rollback", async () => {
    await player.play(snapshotRollbackScenario());
    const block = findToolExecByToolName(getMessages(), "snapshot_rollback");
    expect(block).toBeDefined();
  });
  it("T11.3 — Snapshot unrevert", async () => {
    await player.play(snapshotUnrevertScenario());
    const block = findToolExecByToolName(getMessages(), "snapshot_unrevert");
    expect(block).toBeDefined();
  });
  it("T11.4 — Snapshot getTree", async () => {
    await player.play(snapshotTreeScenario());
    const block = findToolExecByToolName(getMessages(), "snapshot_getTree");
    expect(block).toBeDefined();
  });
});

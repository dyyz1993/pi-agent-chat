import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ContentBlock, ChatMessage } from "../src/mainview/types";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

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
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

type SessionStatus = "idle" | "streaming" | "compacting" | "permission" | "retrying";

vi.mock("../src/mainview/stores/use-session-store", () => {
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
  return { useSessionStore, clearAgentStarted: () => {} };
});

vi.mock("../src/mainview/stores/use-chat-store", () => {
  interface ChatState {
    messagesBySession: Record<string, ChatMessage[]>;
    inputText: string;
    isStreaming: boolean;
    streamContentVersion: number;
    loadingSessions: Set<string>;
    historyLoadVersion: number;
    setMessagesForSession: (sessionId: string, msgs: ChatMessage[]) => void;
    incrementStreamVersion: () => void;
    loadSessionMessages: () => void;
  }
  const useChatStore = create<ChatState>((set) => ({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
    setMessagesForSession: (sessionId, msgs) =>
      set((s) => ({ messagesBySession: { ...s.messagesBySession, [sessionId]: msgs } })),
    incrementStreamVersion: () =>
      set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),
    loadSessionMessages: () => {},
  }));
  return { useChatStore };
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

vi.mock("../src/mainview/stores/use-ui-dialog-store", () => {
  interface UIPendingRequest {
    requestId: string;
    sessionId: string;
    method: "confirm" | "input" | "select" | "editor";
    title?: string;
    message?: string;
    options?: string[];
    multiple?: boolean;
    placeholder?: string;
    prefill?: string;
    timeout?: number;
  }
  interface UIRequestState {
    request: UIPendingRequest;
    status: "pending" | "responded" | "dismissed";
    response?: Record<string, unknown>;
  }
  interface UIDialogState {
    pending: UIPendingRequest[];
    requestStates: Map<string, UIRequestState>;
    panelOpen: boolean;
    registerUIRequest: (req: UIPendingRequest) => void;
    respondById: (requestId: string, response: Record<string, unknown>) => void;
    dismissById: (requestId: string) => void;
    clearPendingBySession: (sessionId: string) => void;
    setPanelOpen: (open: boolean) => void;
    togglePanel: () => void;
  }
  const useUIDialogStore = create<UIDialogState>((set) => ({
    pending: [],
    requestStates: new Map(),
    panelOpen: false,
    registerUIRequest: (req) => {
      set((s) => {
        if (s.requestStates.has(req.requestId)) return s;
        const newStates = new Map(s.requestStates);
        newStates.set(req.requestId, { request: req, status: "pending" });
        return { pending: [...s.pending, req], requestStates: newStates };
      });
    },
    respondById: () => {},
    dismissById: () => {},
    clearPendingBySession: () => {},
    setPanelOpen: (open) => set({ panelOpen: open }),
    togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  }));
  return { useUIDialogStore };
});

import { handleAgentEvent, toolCallNameMap } from "../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { useUIDialogStore } from "../src/mainview/stores/use-ui-dialog-store";
import { flushNow } from "../src/mainview/stores/message-batcher";
import { ScenarioPlayer } from "./helpers/mock-llm";
import {
  bashBackgroundScenario,
  bashFailureScenario,
  todoCreateScenario,
  todoToggleScenario,
  subagentSingleScenario,
  memorySaveScenario,
  coordinatorDelegateScenario,
  compactionScenario,
} from "./helpers/event-fixtures";

const SID = "smoke-test-session-p1";

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
  useUIDialogStore.setState({
    pending: [],
    requestStates: new Map(),
    panelOpen: false,
  });
  Object.keys(toolCallNameMap).forEach((k) => delete toolCallNameMap[k]);
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

describe("P1 Core Tests", () => {
  let player: ScenarioPlayer;

  beforeEach(() => {
    resetStores();
    player = makePlayer();
  });

  afterEach(() => {
    flushNow();
  });

  it("T2.2 — Bash long-running → background", async () => {
    await player.play(bashBackgroundScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "bash");
    expect(block).toBeDefined();
    expect(block!.output).toContain("Build complete");
    expect(block!.status).toBe("done");
  });

  it("T2.5 — Bash command failure", async () => {
    await player.play(bashFailureScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "bash");
    expect(block).toBeDefined();
    expect(block!.status).toBe("error");
  });

  it("T4.1 — Create Todo list", async () => {
    await player.play(todoCreateScenario());
    const msgs = getMessages();
    const todoBlocks = msgs
      .flatMap((m) => m.content)
      .filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
          b.type === "toolExecution" && b.toolName === "todo",
      );
    expect(todoBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it("T4.2 — Toggle Todo", async () => {
    await player.play(todoToggleScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "todo");
    expect(block).toBeDefined();
  });

  it("T5.1 — Single subagent delegation", async () => {
    await player.play(subagentSingleScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "subagent");
    expect(block).toBeDefined();
    expect(block!.output).toContain("Review complete");
  });

  it("T6.1 — Memory save (remember)", async () => {
    await player.play(memorySaveScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "remember");
    expect(block).toBeDefined();
    expect(block!.args).toContain("CSS");
  });

  it("T8.1 — Coordinator delegate session", async () => {
    await player.play(coordinatorDelegateScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "session_delegate");
    expect(block).toBeDefined();
  });

  it("T14.1 — Context compaction", async () => {
    await player.play(compactionScenario());
    const status = useSessionStore.getState().sessionStatusMap[SID];
    expect(status).toBe("idle");
  });
});

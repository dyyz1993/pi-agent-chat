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
  ALL_MEMORY_TYPE_KEYS: new Set([
    "memory_prefetch",
    "memory_prefetch_result",
    "memory_extract",
    "memory_extract_result",
    "rules_snapshot",
    "step_snapshot",
  ]),
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
  return { useSessionStore };
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
  subagentParallelScenario,
  subagentChainScenario,
  rulesSnapshotScenario,
  coordinatorSendMessageScenario,
  coordinatorStatusCheckScenario,
  coordinatorListScenario,
  coordinatorStopScenario,
  fileSnapshotScenario,
  previewUrlScenario,
} from "./helpers/event-fixtures";

const SID = "smoke-test-session-p2";

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

describe("P2 Complete Tests", () => {
  let player: ScenarioPlayer;

  beforeEach(() => {
    resetStores();
    player = makePlayer();
  });

  afterEach(() => {
    flushNow();
  });

  it("T5.2 — Parallel subagents", async () => {
    await player.play(subagentParallelScenario());
    const msgs = getMessages();
    const subBlocks = msgs
      .flatMap((m) => m.content)
      .filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
          b.type === "toolExecution" && b.toolName === "subagent",
      );
    expect(subBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it("T5.3 — Chain subagents", async () => {
    await player.play(subagentChainScenario());
    const msgs = getMessages();
    const subBlocks = msgs
      .flatMap((m) => m.content)
      .filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
          b.type === "toolExecution" && b.toolName === "subagent",
      );
    expect(subBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it("T7.1 — Rules snapshot", async () => {
    await player.play(rulesSnapshotScenario());
    const msgs = getMessages();
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("T8.2 — Coordinator send message", async () => {
    await player.play(coordinatorSendMessageScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "session_delegate_send");
    expect(block).toBeDefined();
  });

  it("T8.3 — Coordinator status check", async () => {
    await player.play(coordinatorStatusCheckScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "session_delegate_status");
    expect(block).toBeDefined();
  });

  it("T8.4 — Coordinator list", async () => {
    await player.play(coordinatorListScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "session_delegate_list");
    expect(block).toBeDefined();
  });

  it("T8.5 — Coordinator stop", async () => {
    await player.play(coordinatorStopScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "session_delegate_stop");
    expect(block).toBeDefined();
  });

  it("T11.1 — File snapshot", async () => {
    await player.play(fileSnapshotScenario());
    const msgs = getMessages();
    const editBlock = findToolExecByToolName(msgs, "edit");
    expect(editBlock).toBeDefined();
    const customMsgs = msgs.filter((m) => m.role === "custom");
    expect(customMsgs.length).toBeGreaterThan(0);
  });

  it("T12.2 — Preview URL", async () => {
    await player.play(previewUrlScenario());
    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "preview");
    expect(block).toBeDefined();
  });

  it("T16.1 — Tier/model switch", () => {
    useSessionStore.setState({ currentModel: { provider: "openai", id: "gpt-4" } });
    expect(useSessionStore.getState().currentModel).toBeDefined();
    useSessionStore.setState({ currentModel: { provider: "anthropic", id: "claude-3" } });
    const model = useSessionStore.getState().currentModel as Record<string, string>;
    expect(model.id).toBe("claude-3");
  });
});

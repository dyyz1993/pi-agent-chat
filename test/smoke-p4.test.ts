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
  return { useSessionStore, clearAgentStarted: vi.fn() };
});

vi.mock("../src/mainview/stores/use-chat-store", () => {
  interface ChatState {
    messagesBySession: Record<string, ChatMessage[]>;
    inputText: string;
    isStreaming: boolean;
    streamContentVersion: number;
    loadingSessions: Set<string>;
    historyLoadVersion: number;
    setMessagesForSession: (
      sessionId: string,
      msgs: ChatMessage[],
      options?: { bumpStreamVersion?: boolean; streamingFastPath?: boolean },
    ) => void;
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
    setMessagesForSession: (sessionId, msgs, options) =>
      set((s) => {
        const next: Record<string, unknown> = {
          messagesBySession: { ...s.messagesBySession, [sessionId]: msgs },
        };
        if (options?.bumpStreamVersion) {
          next.streamContentVersion = s.streamContentVersion + 1;
        }
        return next;
      }),
    incrementStreamVersion: () =>
      set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),
    loadSessionMessages: () => {},
  }));
  return { useChatStore };
});

interface MCPServerTool {
  name: string;
  description: string;
}

interface MCPServerInfo {
  name: string;
  status: "connecting" | "connected" | "error" | "disconnected";
  error?: string;
  toolCount: number;
  tools: MCPServerTool[];
  scope: "global" | "project";
}

vi.mock("../src/mainview/stores/use-status-store", () => {
  interface StatusState {
    plugins: unknown[];
    skills: unknown[];
    mcpServers: MCPServerInfo[];
    setPlugins: () => void;
    setSkills: () => void;
    _setMcpServers: () => void;
  }
  const useStatusStore = create<StatusState>(() => ({
    plugins: [],
    skills: [],
    mcpServers: [],
    setPlugins: () => {},
    setSkills: () => {},
    setMcpServers: () => {},
  }));
  return { useStatusStore };
});

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-retry-store", () => {
  interface RetryState {
    activeRetries: Record<
      string,
      { attempt: number; maxAttempts: number; delayMs?: number; errorMessage?: string }
    >;
    startRetry: (
      sessionId: string,
      info: { attempt: number; maxAttempts: number; delayMs?: number; errorMessage?: string },
    ) => void;
    endRetry: (sessionId: string) => void;
  }
  const useRetryStore = create<RetryState>((set) => ({
    activeRetries: {},
    startRetry: (sessionId, info) =>
      set((s) => ({ activeRetries: { ...s.activeRetries, [sessionId]: info } })),
    endRetry: (sessionId) =>
      set((s) => {
        const rest = Object.assign({}, s.activeRetries);
        delete rest[sessionId];
        return { activeRetries: rest };
      }),
  }));
  return { useRetryStore };
});

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
import { useStatusStore } from "../src/mainview/stores/use-status-store";
import { flushNow } from "../src/mainview/stores/message-batcher";
import { ScenarioPlayer } from "./helpers/mock-llm";
import { fullExtensionChainScenario, multiSessionParallelScenario } from "./helpers/event-fixtures";

const SID = "smoke-test-session-p4";

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
  useStatusStore.setState({
    plugins: [],
    skills: [],
    mcpServers: [],
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

describe("P4 Stress Tests", () => {
  let player: ScenarioPlayer;

  beforeEach(() => {
    resetStores();
    player = makePlayer();
  });

  afterEach(() => {
    flushNow();
  });

  it("T30.1 — Full extension chain (read+todo+edit+bash+memory+mermaid+confirm)", async () => {
    const scenario = fullExtensionChainScenario();
    await player.play(scenario);

    const msgs = getMessages();
    expect(msgs.length).toBeGreaterThan(0);

    const allBlocks = msgs.flatMap((m) => m.content);

    const readBlocks = allBlocks.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolName === "file_read",
    );
    expect(readBlocks.length).toBeGreaterThan(0);

    const todoBlocks = allBlocks.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolName === "todo",
    );
    expect(todoBlocks.length).toBeGreaterThan(0);

    const editBlocks = allBlocks.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolName === "file_edit",
    );
    expect(editBlocks.length).toBeGreaterThan(0);

    const bashBlocks = allBlocks.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolName === "bash",
    );
    expect(bashBlocks.length).toBeGreaterThan(0);

    const memoryBlocks = allBlocks.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolName === "remember",
    );
    expect(memoryBlocks.length).toBeGreaterThan(0);

    const textBlocks = allBlocks.filter(
      (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
    );
    const hasMermaid = textBlocks.some((b) => b.text.includes("mermaid"));
    expect(hasMermaid).toBe(true);

    const dialogState = useUIDialogStore.getState();
    const confirmReq = dialogState.pending.find(
      (r) => r.sessionId === SID && r.method === "confirm",
    );
    expect(confirmReq).toBeDefined();

    const status = useSessionStore.getState().sessionStatusMap[SID];
    expect(status).toBe("idle");
  });

  it("T30.2 — Multi-session parallel delegates", async () => {
    const scenario = multiSessionParallelScenario();
    await player.play(scenario);

    const msgs = getMessages();
    expect(msgs.length).toBeGreaterThan(0);

    const allBlocks = msgs.flatMap((m) => m.content);

    const delegateBlocks = allBlocks.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolName === "session_delegate",
    );
    expect(delegateBlocks.length).toBeGreaterThanOrEqual(2);

    const statusBlocks = allBlocks.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolName === "session_delegate_status",
    );
    expect(statusBlocks.length).toBeGreaterThan(0);

    const status = useSessionStore.getState().sessionStatusMap[SID];
    expect(status).toBe("idle");
  });
});

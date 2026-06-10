import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ContentBlock, ChatMessage } from "../../../src/mainview/types";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(() => Promise.resolve(undefined)),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
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

type SessionStatus = "idle" | "streaming" | "compacting" | "permission" | "retrying";

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  interface MockSessionState {
    sessionsByProject: Record<string, unknown[]>;
    activeSessionId: string | null;
    projectTabs: unknown[];
    activeProjectId: string | null;
    loading: boolean;
    agentSubscriptions: Record<string, string>;
    batchSubscriptions: Record<string, string>;
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
    batchSubscriptions: {},
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

vi.mock("../../../src/mainview/stores/use-chat-store", () => {
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

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => {
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

import { handleAgentEvent, toolCallNameMap } from "../../../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useUIDialogStore } from "../../../src/mainview/stores/use-ui-dialog-store";
import { flushNow } from "../../../src/mainview/stores/message-batcher";
import { ScenarioPlayer } from "../../helpers/mock-llm";
import {
  firstMessageScenario,
  streamingMessageScenario,
  basicBashScenario,
  readFileScenario,
  createFileScenario,
  confirmDialogScenario,
} from "../../helpers/event-fixtures";

const SID = "smoke-test-session";

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

describe("P0 Smoke Tests", () => {
  let player: ScenarioPlayer;

  beforeEach(() => {
    resetStores();
    player = makePlayer();
  });

  afterEach(() => {
    flushNow();
  });

  it("T1.1 — First message with assistant text", async () => {
    await player.play(firstMessageScenario());

    const msgs = getMessages();
    expect(msgs.length).toBeGreaterThan(0);

    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThan(0);

    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    const textBlock = lastAssistant.content.find(
      (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
    );
    expect(textBlock).toBeDefined();
    expect(textBlock!.text).toContain("AI coding assistant");
  });

  it("T1.2 — Streaming message with incremental text updates", async () => {
    const versions: number[] = [];
    let prevVersion = useChatStore.getState().streamContentVersion;

    const scenario = streamingMessageScenario();
    for (const step of scenario.steps) {
      const delay = step.delay ?? 50;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      handleAgentEvent(SID, step.event as Parameters<typeof handleAgentEvent>[1]);
      flushNow();
      const cur = useChatStore.getState().streamContentVersion;
      if (cur !== prevVersion) {
        versions.push(cur);
        prevVersion = cur;
      }
    }

    const msgs = getMessages();
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThan(0);

    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    const textBlock = lastAssistant.content.find(
      (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
    );
    expect(textBlock).toBeDefined();
    expect(textBlock!.text).toContain("write code");
    expect(textBlock!.text).toContain("debug issues");

    expect(versions.length).toBeGreaterThan(0);
  });

  it("T2.1 — Basic bash execution", async () => {
    await player.play(basicBashScenario());

    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "bash");
    expect(block).toBeDefined();
    expect(block!.args).toContain("echo hello world");
    expect(block!.output).toContain("hello world");
    expect(block!.status).toBe("done");
  });

  it("T3.1 — Read file", async () => {
    await player.play(readFileScenario());

    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "file_read");
    expect(block).toBeDefined();
    expect(block!.args).toContain("src/index.ts");
    expect(block!.output).toContain("file content here");
    expect(block!.status).toBe("done");
  });

  it("T3.2 — Create file", async () => {
    await player.play(createFileScenario());

    const msgs = getMessages();
    const block = findToolExecByToolName(msgs, "file_write");
    expect(block).toBeDefined();
    expect(block!.args).toContain("hello.txt");
    expect(block!.status).toBe("done");
  });

  it("T9.1 — Confirm dialog (ask-confirm)", async () => {
    await player.play(confirmDialogScenario());

    const dialogState = useUIDialogStore.getState();
    expect(dialogState.pending.length).toBeGreaterThan(0);

    const request = dialogState.pending.find((r) => r.sessionId === SID);
    expect(request).toBeDefined();
    expect(request!.method).toBe("confirm");
    expect(request!.title).toBe("Confirm Deletion");
    expect(request!.message).toContain("delete all temp files");
  });

  it("T15.2 — Session switch", () => {
    const sessionA = "session-A";
    const sessionB = "session-B";
    const projectPath = "/tmp/test-project";

    useSessionStore.setState({
      sessionsByProject: {
        [projectPath]: [
          { sessionId: sessionA, name: "Session A", projectPath },
          { sessionId: sessionB, name: "Session B", projectPath },
        ],
      },
      activeSessionId: sessionA,
      activeProjectId: projectPath,
    });

    useChatStore.getState().setMessagesForSession(sessionA, [
      {
        id: "msg-a-1",
        role: "assistant",
        content: [{ type: "text", text: "Response from A" }],
        timestamp: Date.now(),
      },
    ]);
    useChatStore.getState().setMessagesForSession(sessionB, [
      {
        id: "msg-b-1",
        role: "assistant",
        content: [{ type: "text", text: "Response from B" }],
        timestamp: Date.now(),
      },
    ]);

    expect(useSessionStore.getState().activeSessionId).toBe(sessionA);

    useSessionStore.setState({ activeSessionId: sessionB });

    expect(useSessionStore.getState().activeSessionId).toBe(sessionB);

    const msgsB = useChatStore.getState().messagesBySession[sessionB];
    expect(msgsB).toBeDefined();
    expect(msgsB!.length).toBeGreaterThan(0);
    const textBlock = msgsB![0].content.find(
      (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
    );
    expect(textBlock!.text).toBe("Response from B");
  });
});

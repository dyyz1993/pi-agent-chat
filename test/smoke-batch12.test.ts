import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ChatMessage } from "../src/mainview/types";
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
    getBaseUrl: vi.fn(() => "http://localhost:3000"),
    getAuthToken: vi.fn(() => "test-token"),
    getTransport: vi.fn(() => "http"),
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
    "memory_dream",
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
import { flushNow } from "../src/mainview/stores/message-batcher";
import { ScenarioPlayer } from "./helpers/mock-llm";
import {
  abortExecutionScenario,
  followUpModeScenario,
  bashBackgroundKillScenario,
  bashStdinScenario,
  dangerousCommandInterceptScenario,
  bashBackgroundLogScenario,
  editFileDiffScenario,
  fileSearchGrepScenario,
  globPatternScenario,
  deleteTodoScenario,
  clearTodosScenario,
  listTodosScenario,
  memoryPrefetchScenario,
  memoryDreamScenario,
} from "./helpers/event-fixtures";
import { useAttachmentStore } from "../src/mainview/stores/use-attachment-store";
import { useSubagentStore } from "../src/mainview/stores/use-subagent-store";

const SID = "smoke-batch12-session";

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

describe("Batch 12 — T1.5 through T6.3", () => {
  let player: ScenarioPlayer;

  beforeEach(() => {
    resetStores();
    player = makePlayer();
  });

  afterEach(() => {
    flushNow();
  });

  it("T1.5 — Abort execution (agent_end before toolCallEnd)", async () => {
    await player.play(abortExecutionScenario());
    const status = useSessionStore.getState().sessionStatusMap[SID];
    expect(status).toBe("idle");
    const msgs = getMessages();
    expect(msgs.length).toBeGreaterThan(0);
    const hasToolExec = msgs.some((m) =>
      m.content.some(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    expect(hasToolExec).toBe(true);
  });

  it("T1.6 — Follow-up mode (queue_update with followUp)", async () => {
    await player.play(followUpModeScenario());
    const queue = useSessionStore.getState().queueBySession[SID];
    expect(queue).toBeUndefined();
    const msgs = getMessages();
    expect(msgs.length).toBeGreaterThanOrEqual(2);
  });

  it("T2.3 — Bash background process killed", async () => {
    await player.play(bashBackgroundKillScenario());
    const msgs = getMessages();
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    const toolExecs = assistant!.content.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
    );
    expect(toolExecs.length).toBeGreaterThan(0);
    const bashExec = toolExecs.find((b) => b.toolName === "bash");
    expect(bashExec).toBeDefined();
    expect(bashExec!.output).toContain("Killed");
  });

  it("T2.4 — Bash stdin interaction", async () => {
    await player.play(bashStdinScenario());
    const msgs = getMessages();
    const toolExecs = msgs.flatMap((m) =>
      m.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    const bashExec = toolExecs.find((b) => b.toolName === "bash");
    expect(bashExec).toBeDefined();
    expect(bashExec!.output).toContain("stdin");
  });

  it("T2.6 — Dangerous command intercept", async () => {
    await player.play(dangerousCommandInterceptScenario());
    const dialogState = useUIDialogStore.getState();
    const req = dialogState.pending.find((r) => r.sessionId === SID);
    expect(req).toBeDefined();
    expect(req!.method).toBe("confirm");
    expect(req!.title).toBe("Dangerous Command");
    expect(req!.message).toContain("rm -rf");
    const status = useSessionStore.getState().sessionStatusMap[SID];
    expect(status).toBe("permission");
  });

  it("T2.7 — Bash background with log path", async () => {
    await player.play(bashBackgroundLogScenario());
    const msgs = getMessages();
    const toolExecs = msgs.flatMap((m) =>
      m.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    const bashExec = toolExecs.find((b) => b.toolName === "bash");
    expect(bashExec).toBeDefined();
    expect(bashExec!.status).toBe("done");
  });

  it("T3.3 — Edit file with oldText/newText diff", async () => {
    await player.play(editFileDiffScenario());
    const msgs = getMessages();
    const toolExecs = msgs.flatMap((m) =>
      m.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    const editExec = toolExecs.find((b) => b.toolName === "file_edit");
    expect(editExec).toBeDefined();
    expect(editExec!.status).toBe("done");
    expect(editExec!.args).toContain("index.ts");
  });

  it("T3.4 — File search (grep)", async () => {
    await player.play(fileSearchGrepScenario());
    const msgs = getMessages();
    const toolExecs = msgs.flatMap((m) =>
      m.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    const grepExec = toolExecs.find((b) => b.toolName === "grep");
    expect(grepExec).toBeDefined();
    expect(grepExec!.status).toBe("done");
    expect(grepExec!.output).toContain("TODO");
  });

  it("T3.5 — Glob pattern search", async () => {
    await player.play(globPatternScenario());
    const msgs = getMessages();
    const toolExecs = msgs.flatMap((m) =>
      m.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    const globExec = toolExecs.find((b) => b.toolName === "glob");
    expect(globExec).toBeDefined();
    expect(globExec!.status).toBe("done");
    expect(globExec!.output).toContain(".ts");
  });

  it("T3.6 — File attachment store (pure store)", () => {
    useAttachmentStore.setState({ attachments: [] });

    const mockFile = {
      id: "att_test",
      file: new File(["hello"], "test.txt", { type: "text/plain" }),
      name: "test.txt",
      size: 5,
      type: "text/plain",
      status: "pending" as const,
      progress: 0,
    };
    useAttachmentStore.setState({ attachments: [mockFile] });
    expect(useAttachmentStore.getState().attachments.length).toBe(1);
    expect(useAttachmentStore.getState().attachments[0].name).toBe("test.txt");

    useAttachmentStore.getState().removeFile("att_test");
    expect(useAttachmentStore.getState().attachments.length).toBe(0);
  });

  it("T4.3 — Delete todo", async () => {
    await player.play(deleteTodoScenario());
    const msgs = getMessages();
    const toolExecs = msgs.flatMap((m) =>
      m.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    const todoExec = toolExecs.find((b) => b.toolName === "todo");
    expect(todoExec).toBeDefined();
    expect(todoExec!.status).toBe("done");
    expect(todoExec!.output).toContain("removed");
  });

  it("T4.4 — Clear all todos", async () => {
    await player.play(clearTodosScenario());
    const msgs = getMessages();
    const toolExecs = msgs.flatMap((m) =>
      m.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    const todoExec = toolExecs.find((b) => b.toolName === "todo");
    expect(todoExec).toBeDefined();
    expect(todoExec!.status).toBe("done");
    expect(todoExec!.output).toContain("cleared");
  });

  it("T4.5 — List todos", async () => {
    await player.play(listTodosScenario());
    const msgs = getMessages();
    const toolExecs = msgs.flatMap((m) =>
      m.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    const todoExec = toolExecs.find((b) => b.toolName === "todo");
    expect(todoExec).toBeDefined();
    expect(todoExec!.status).toBe("done");
    const parsed = JSON.parse(todoExec!.output);
    expect(parsed.length).toBe(2);
  });

  it("T5.4 — Subagent management (pure store: rename + delete)", () => {
    const parentPath = "/sessions/test-project/main";
    const subId = "sub-test-1";

    useSubagentStore.setState({
      subsessionsByParent: {},
      activeSubsessionId: null,
      messagesBySubsession: {},
      loadingByParent: {},
      subagentStatusMap: {},
      subagentContextMap: {},
    });

    useSubagentStore.getState().upsertLiveSubagent(parentPath, subId, {
      description: "Original description",
      instruction: "Do something",
      sessionPath: `${parentPath}/sub1`,
    });

    const subs = useSubagentStore.getState().subsessionsByParent[parentPath];
    expect(subs).toBeDefined();
    expect(subs!.length).toBe(1);
    expect(subs![0].description).toBe("Original description");

    useSubagentStore.getState().renameSubagent(parentPath, subId, "Renamed subagent");
    const renamed = useSubagentStore.getState().subsessionsByParent[parentPath];
    expect(renamed![0].description).toBe("Renamed subagent");

    useSubagentStore.getState().deleteSubagent(parentPath, subId);
    const afterDelete = useSubagentStore.getState().subsessionsByParent[parentPath];
    expect(afterDelete!.length).toBe(0);
  });

  it("T6.2 — Memory prefetch custom entry", async () => {
    await player.play(memoryPrefetchScenario());
    const msgs = getMessages();
    expect(msgs.length).toBeGreaterThan(0);
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    const textBlock = assistant!.content.find(
      (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
    );
    expect(textBlock).toBeDefined();
    expect(textBlock!.text).toContain("memory context");
  });

  it("T6.3 — Memory dream custom entry", async () => {
    await player.play(memoryDreamScenario());
    const msgs = getMessages();
    expect(msgs.length).toBeGreaterThan(0);
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    const textBlock = assistant!.content.find(
      (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
    );
    expect(textBlock).toBeDefined();
    expect(textBlock!.text).toContain("42 memories");
  });
});

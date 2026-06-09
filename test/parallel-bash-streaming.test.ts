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

import { handleAgentEvent, toolCallNameMap, toolCallArgsMap } from "../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { flushNow } from "../src/mainview/stores/message-batcher";

const SID = "parallel-bash-test-session";

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
  Object.keys(toolCallNameMap).forEach((k) => delete toolCallNameMap[k]);
  Object.keys(toolCallArgsMap).forEach((k) => delete toolCallArgsMap[k]);
}

function getMessages(): ChatMessage[] {
  return useChatStore.getState().messagesBySession[SID] || [];
}

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

function getToolBlocks(): ToolExecBlock[] {
  const msgs = getMessages();
  const blocks: ToolExecBlock[] = [];
  for (const msg of msgs) {
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type === "toolExecution") blocks.push(block as ToolExecBlock);
    }
  }
  return blocks;
}

/**
 * Send events WITHOUT flushing between them — simulates events
 * arriving in the same animation frame via WebSocket.
 */
function sendSameFrame(...events: Parameters<typeof handleAgentEvent>[1][]): void {
  for (const evt of events) {
    handleAgentEvent(SID, evt);
  }
  flushNow();
}

/**
 * Send events WITH flush between each — simulates events arriving
 * in separate frames (well-spaced).
 */
function sendSeparateFrames(...events: Parameters<typeof handleAgentEvent>[1][]): void {
  for (const evt of events) {
    handleAgentEvent(SID, evt);
    flushNow();
  }
}

function makeStart(toolCallId: string, toolName: string, command: string) {
  return {
    type: "tool_execution_start" as const,
    toolCallId,
    toolName,
    args: { command },
    timestamp: Date.now(),
  };
}

function makeUpdate(toolCallId: string, partialText: string) {
  return {
    type: "tool_execution_update" as const,
    toolCallId,
    toolName: "bash",
    args: {},
    partialResult: { content: [{ type: "text", text: partialText }] },
  };
}

function makeEnd(toolCallId: string, output: string) {
  return {
    type: "tool_execution_end" as const,
    toolCallId,
    toolName: "bash",
    result: { content: [{ type: "text", text: output }] },
    isError: false,
    timestamp: Date.now(),
    durationMs: 10000,
  };
}

describe("Parallel Bash Streaming", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    flushNow();
  });

  it("T1 — Setup: create assistant message with agent_start + message_start", () => {
    handleAgentEvent(SID, { type: "agent_start" });
    flushNow();
    handleAgentEvent(SID, {
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    flushNow();

    const msgs = getMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("assistant");
  });

  it("T2 — Both starts in SAME frame → both blocks must exist after flush", () => {
    // Setup: create assistant message first
    handleAgentEvent(SID, { type: "agent_start" });
    flushNow();
    handleAgentEvent(SID, {
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    flushNow();

    // Two tool_execution_start in the same frame
    sendSameFrame(
      makeStart("call_a96", "bash", "for i in $(seq 1 10); do echo $i; sleep 1; done"),
      makeStart("call_9c0", "bash", "for i in $(seq 1 10); do echo $i; sleep 1; done"),
    );

    const blocks = getToolBlocks();
    console.log(`[T2] blocks after same-frame starts: ${blocks.length}`);
    for (const b of blocks) {
      console.log(`  ${b.toolCallId}: status=${b.status} toolName=${b.toolName}`);
    }

    // EXPECTED: both blocks should exist
    // ACTUAL: ??? (this is what we're testing)
    expect(blocks.length).toBe(2);
  });

  it("T3 — Both starts in SEPARATE frames → both blocks exist (baseline)", () => {
    handleAgentEvent(SID, { type: "agent_start" });
    flushNow();
    handleAgentEvent(SID, {
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    flushNow();

    sendSeparateFrames(
      makeStart("call_a96", "bash", "for i in $(seq 1 10); do echo $i; sleep 1; done"),
      makeStart("call_9c0", "bash", "for i in $(seq 1 10); do echo $i; sleep 1; done"),
    );

    const blocks = getToolBlocks();
    console.log(`[T3] blocks after separate-frame starts: ${blocks.length}`);
    expect(blocks.length).toBe(2);
  });

  it("T4 — Both updates in SAME frame → both blocks must show output", () => {
    handleAgentEvent(SID, { type: "agent_start" });
    flushNow();
    handleAgentEvent(SID, {
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    flushNow();

    // Start both tools (separate frames to ensure blocks exist)
    sendSeparateFrames(
      makeStart("call_a96", "bash", "echo a96"),
      makeStart("call_9c0", "bash", "echo 9c0"),
    );

    // Simulate: both updates arrive in the same frame
    sendSameFrame(
      makeUpdate("call_a96", "1\n"),
      makeUpdate("call_9c0", "1\n"),
    );

    const blocks = getToolBlocks();
    console.log(`[T4] blocks after same-frame updates:`);
    for (const b of blocks) {
      console.log(`  ${b.toolCallId}: output=${JSON.stringify(b.output)}`);
    }

    // EXPECTED: both blocks should have output "1\n"
    const a96 = blocks.find((b) => b.toolCallId === "call_a96");
    const c0 = blocks.find((b) => b.toolCallId === "call_9c0");
    expect(a96).toBeDefined();
    expect(c0).toBeDefined();
    expect(a96!.output).toBe("1\n");
    expect(c0!.output).toBe("1\n");
  });

  it("T5 — Full parallel bash scenario: same-frame starts + 10 rounds of same-frame updates + same-frame ends", () => {
    handleAgentEvent(SID, { type: "agent_start" });
    flushNow();
    handleAgentEvent(SID, {
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    flushNow();

    // Phase 1: Both starts in same frame (simulates real parallel bash)
    sendSameFrame(
      makeStart("call_a96", "bash", "for i in $(seq 1 10); do echo $i; sleep 1; done"),
      makeStart("call_9c0", "bash", "for i in $(seq 1 10); do echo $i; sleep 1; done"),
    );

    let blocks = getToolBlocks();
    console.log(`[T5] After starts: ${blocks.length} blocks`);

    // Phase 2: 10 rounds of updates, each round has both updates in the same frame
    for (let i = 1; i <= 10; i++) {
      const text = Array.from({ length: i }, (_, j) => String(j + 1)).join("\n") + "\n";
      sendSameFrame(
        makeUpdate("call_a96", text),
        makeUpdate("call_9c0", text),
      );
    }

    blocks = getToolBlocks();
    console.log(`[T5] After 10 update rounds:`);
    for (const b of blocks) {
      console.log(`  ${b.toolCallId}: status=${b.status} output=${JSON.stringify(b.output?.slice(0, 30))}`);
    }

    // Phase 3: Both ends in same frame
    sendSameFrame(
      makeEnd("call_a96", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"),
      makeEnd("call_9c0", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"),
    );

    blocks = getToolBlocks();
    console.log(`[T5] Final state after ends:`);
    for (const b of blocks) {
      console.log(`  ${b.toolCallId}: status=${b.status} output=${JSON.stringify(b.output?.slice(0, 30))}`);
    }

    // Assertions
    const a96 = blocks.find((b) => b.toolCallId === "call_a96");
    const c0 = blocks.find((b) => b.toolCallId === "call_9c0");

    console.log(`\n[T5] SUMMARY:`);
    console.log(`  a96 exists: ${!!a96}, status: ${a96?.status}, hasOutput: ${!!a96?.output}`);
    console.log(`  9c0 exists: ${!!c0}, status: ${c0?.status}, hasOutput: ${!!c0?.output}`);

    // Both should exist and be done
    expect(a96).toBeDefined();
    expect(c0).toBeDefined();
    expect(a96!.status).toBe("done");
    expect(c0!.status).toBe("done");
    expect(a96!.output).toContain("10");
    expect(c0!.output).toContain("10");
  });
});

// ============================================================
// Refresh Scenarios — simulates page refresh during tool execution
// getFullMessages returns partial state, then real-time events arrive
// ============================================================

function setRefreshedMessages(blocks: ToolExecBlock[]) {
  useChatStore.getState().setMessagesForSession(SID, [
    {
      id: "msg-refresh",
      role: "assistant" as const,
      content: blocks,
      timestamp: Date.now(),
    },
  ]);
}

function makeRefreshBlock(
  toolCallId: string,
  status: "running" | "done",
  output: string,
  command = "for i in $(seq 1 10); do echo $i; sleep 1; done",
): ToolExecBlock {
  return {
    type: "toolExecution",
    toolCallId,
    toolName: "bash",
    args: JSON.stringify({ command }),
    status,
    output,
    startedAt: Date.now() - 5000,
    ...(status === "done" ? { endedAt: Date.now() } : {}),
  };
}

describe("Refresh — getFullMessages + real-time events", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    flushNow();
  });

  it("T6 — Refresh during parallel bash: both running → updates + ends arrive", () => {
    // Simulate getFullMessages returning 2 running blocks with partial output
    setRefreshedMessages([
      makeRefreshBlock("call_a96", "running", "1\n2\n3\n"),
      makeRefreshBlock("call_9c0", "running", "1\n2\n3\n"),
    ]);

    console.log("[T6] After refresh: store has 2 running blocks");

    // Real-time updates arrive (both in same frame — simulates parallel)
    sendSameFrame(
      makeUpdate("call_a96", "1\n2\n3\n4\n"),
      makeUpdate("call_9c0", "1\n2\n3\n4\n"),
    );

    let blocks = getToolBlocks();
    console.log(`[T6] After same-frame updates:`);
    for (const b of blocks) {
      console.log(`  ${b.toolCallId}: status=${b.status} output=${JSON.stringify(b.output)}`);
    }

    // Both should have updated output
    const a96 = blocks.find((b) => b.toolCallId === "call_a96");
    const c0 = blocks.find((b) => b.toolCallId === "call_9c0");
    expect(a96).toBeDefined();
    expect(c0).toBeDefined();
    expect(a96!.output).toBe("1\n2\n3\n4\n");
    expect(c0!.output).toBe("1\n2\n3\n4\n");

    // Real-time ends arrive
    sendSameFrame(
      makeEnd("call_a96", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"),
      makeEnd("call_9c0", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"),
    );

    blocks = getToolBlocks();
    console.log(`[T6] After same-frame ends:`);
    for (const b of blocks) {
      console.log(`  ${b.toolCallId}: status=${b.status} output=${JSON.stringify(b.output?.slice(0, 20))}`);
    }

    // Both should be done
    expect(blocks.length).toBe(2);
    const a96Final = blocks.find((b) => b.toolCallId === "call_a96");
    const c0Final = blocks.find((b) => b.toolCallId === "call_9c0");
    expect(a96Final!.status).toBe("done");
    expect(c0Final!.status).toBe("done");
    expect(a96Final!.output).toContain("10");
    expect(c0Final!.output).toContain("10");
  });

  it("T7 — Refresh with one done + one running → only running gets updates", () => {
    setRefreshedMessages([
      makeRefreshBlock("call_a96", "done", "1\n2\n3\n4\n5\n"),
      makeRefreshBlock("call_9c0", "running", "1\n2\n3\n"),
    ]);

    console.log("[T7] After refresh: a96=done, 9c0=running");

    // Only 9c0 should receive updates
    sendSameFrame(
      makeUpdate("call_9c0", "1\n2\n3\n4\n5\n6\n7\n"),
    );

    let blocks = getToolBlocks();
    const c0 = blocks.find((b) => b.toolCallId === "call_9c0");
    console.log(`[T7] 9c0 after update: output=${JSON.stringify(c0?.output)}`);
    expect(c0!.output).toBe("1\n2\n3\n4\n5\n6\n7\n");

    // 9c0 ends
    handleAgentEvent(SID, makeEnd("call_9c0", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"));
    flushNow();

    blocks = getToolBlocks();
    console.log(`[T7] Final state:`);
    for (const b of blocks) {
      console.log(`  ${b.toolCallId}: status=${b.status}`);
    }

    // a96 should still be done with original output
    const a96 = blocks.find((b) => b.toolCallId === "call_a96");
    expect(a96!.status).toBe("done");
    expect(a96!.output).toBe("1\n2\n3\n4\n5\n");

    // 9c0 should now be done
    const c0Final = blocks.find((b) => b.toolCallId === "call_9c0");
    expect(c0Final!.status).toBe("done");
    expect(c0Final!.output).toContain("10");
  });

  it("T8 — Refresh, then tool_execution_start arrives with different ID (message_update linkage)", () => {
    // After refresh, getFullMessages returns a block from JSONL
    // The block's toolCallId is the execution ID
    setRefreshedMessages([
      makeRefreshBlock("exec-id-001", "running", ""),
    ]);

    // tool_execution_start arrives for the SAME tool but via real-time
    // with the same ID — should find the existing block
    handleAgentEvent(SID, makeStart("exec-id-001", "bash", "echo hello"));
    flushNow();

    let blocks = getToolBlocks();
    console.log(`[T8] After start with same ID: ${blocks.length} blocks`);
    expect(blocks.length).toBe(1); // should not create duplicate

    // tool_execution_end arrives
    handleAgentEvent(SID, makeEnd("exec-id-001", "hello\n"));
    flushNow();

    blocks = getToolBlocks();
    const block = blocks.find((b) => b.toolCallId === "exec-id-001");
    expect(block).toBeDefined();
    expect(block!.status).toBe("done");
    expect(block!.output).toBe("hello\n");
  });

  it("T9 — Refresh, blocks in non-last message + new user message after", () => {
    // Simulate: assistant message with tool blocks, then a new user message
    useChatStore.getState().setMessagesForSession(SID, [
      {
        id: "msg-assistant",
        role: "assistant" as const,
        content: [
          makeRefreshBlock("call_a96", "running", "1\n2\n"),
          makeRefreshBlock("call_9c0", "running", "1\n"),
        ],
        timestamp: Date.now() - 10000,
      },
      {
        id: "msg-user-new",
        role: "user" as const,
        content: [{ type: "text" as const, text: "还在跑吗？" }],
        timestamp: Date.now(),
      },
    ]);

    console.log("[T9] After refresh: tool blocks in non-last message");

    // Updates arrive for tools in the non-last (assistant) message
    sendSameFrame(
      makeUpdate("call_a96", "1\n2\n3\n4\n5\n"),
      makeUpdate("call_9c0", "1\n2\n3\n4\n5\n"),
    );

    const msgs = getMessages();
    const assistantMsg = msgs.find((m) => m.id === "msg-assistant");
    const toolBlocks = assistantMsg?.content.filter(
      (b): b is ToolExecBlock => b.type === "toolExecution",
    ) ?? [];

    console.log(`[T9] Tool blocks after updates:`);
    for (const b of toolBlocks) {
      console.log(`  ${b.toolCallId}: status=${b.status} output=${JSON.stringify(b.output)}`);
    }

    const a96 = toolBlocks.find((b) => b.toolCallId === "call_a96");
    const c0 = toolBlocks.find((b) => b.toolCallId === "call_9c0");
    expect(a96).toBeDefined();
    expect(c0).toBeDefined();
    expect(a96!.output).toBe("1\n2\n3\n4\n5\n");
    expect(c0!.output).toBe("1\n2\n3\n4\n5\n");

    // Ends arrive
    sendSameFrame(
      makeEnd("call_a96", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"),
      makeEnd("call_9c0", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"),
    );

    const msgsAfter = getMessages();
    const assistantMsgAfter = msgsAfter.find((m) => m.id === "msg-assistant");
    const toolBlocksAfter = assistantMsgAfter?.content.filter(
      (b): b is ToolExecBlock => b.type === "toolExecution",
    ) ?? [];

    console.log(`[T9] Final state:`);
    for (const b of toolBlocksAfter) {
      console.log(`  ${b.toolCallId}: status=${b.status}`);
    }

    const a96Final = toolBlocksAfter.find((b) => b.toolCallId === "call_a96");
    const c0Final = toolBlocksAfter.find((b) => b.toolCallId === "call_9c0");
    expect(a96Final!.status).toBe("done");
    expect(c0Final!.status).toBe("done");
    expect(a96Final!.output).toContain("10");
    expect(c0Final!.output).toContain("10");
  });

  it("T10 — Refresh with NO running tools, then new agent turn starts tools", () => {
    // Previous turn's tools are all done from getFullMessages
    setRefreshedMessages([
      makeRefreshBlock("prev-call-1", "done", "done output\n"),
    ]);

    // New agent turn: message_start creates new assistant message
    handleAgentEvent(SID, {
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    flushNow();

    // New parallel bash starts (same command as before)
    sendSameFrame(
      makeStart("new-call-a", "bash", "for i in $(seq 1 10); do echo $i; sleep 1; done"),
      makeStart("new-call-b", "bash", "for i in $(seq 1 10); do echo $i; sleep 1; done"),
    );

    let blocks = getToolBlocks();
    console.log(`[T10] Blocks after new starts: ${blocks.length}`);
    for (const b of blocks) {
      console.log(`  ${b.toolCallId}: status=${b.status}`);
    }

    // Should have 3 blocks: 1 done (prev) + 2 running (new)
    expect(blocks.length).toBe(3);

    const runningBlocks = blocks.filter((b) => b.status === "running");
    expect(runningBlocks.length).toBe(2);

    // Clean up
    sendSameFrame(
      makeEnd("new-call-a", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"),
      makeEnd("new-call-b", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"),
    );

    blocks = getToolBlocks();
    const allDone = blocks.every((b) => b.status === "done");
    expect(allDone).toBe(true);
  });
});

describe("Refresh — agent tool_execution_update must not wipe bash output", () => {
  // Scenario: after page refresh, the chat's tool block has bash output
  // (from syncBashStoreToChat). Then the agent's tool_execution_update
  // arrives with empty partialResult (the agent hasn't received any
  // output from the bash process yet, but the bash process is already
  // streaming). The chat's "Output" section must not be wiped to empty.

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    flushNow();
  });

  it("preserves bash-streamed output when agent update arrives with empty partialResult", () => {
    // Set up: chat has a tool block with bash-streamed output
    useChatStore.getState().setMessagesForSession(SID, [
      {
        id: "refreshed-msg",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "call_1",
            toolName: "bash",
            args: JSON.stringify({ command: "for i in $(seq 1 5); do echo $i; done" }),
            status: "running",
            output: "1\n2\n3\n",
            startedAt: 1000,
          },
        ],
        timestamp: 1,
      },
    ]);

    // Agent's tool_execution_update arrives with NO partialResult
    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: "call_1",
      toolName: "bash",
      args: {},
      // partialResult: undefined — agent hasn't relayed any output yet
      timestamp: 2000,
    });
    flushNow();

    const blocks = getToolBlocks();
    expect(blocks).toHaveLength(1);
    // The bash-streamed output must NOT be wiped
    expect(blocks[0].output).toBe("1\n2\n3\n");
    expect(blocks[0].status).toBe("running");
  });

  it("preserves bash output when agent update has empty content array", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      {
        id: "refreshed-msg",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "call_1",
            toolName: "bash",
            args: JSON.stringify({ command: "for i in $(seq 1 5); do echo $i; done" }),
            status: "running",
            output: "1\n2\n",
            startedAt: 1000,
          },
        ],
        timestamp: 1,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: "call_1",
      toolName: "bash",
      args: {},
      partialResult: { content: [] }, // empty content array
      timestamp: 2000,
    });
    flushNow();

    const blocks = getToolBlocks();
    expect(blocks[0].output).toBe("1\n2\n");
  });

  it("still uses agent's output when it is non-empty (regression check)", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      {
        id: "refreshed-msg",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "call_1",
            toolName: "bash",
            args: JSON.stringify({ command: "echo hi" }),
            status: "running",
            output: "",
            startedAt: 1000,
          },
        ],
        timestamp: 1,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: "call_1",
      toolName: "bash",
      args: {},
      partialResult: { content: [{ type: "text", text: "agent-output\n" }] },
      timestamp: 2000,
    });
    flushNow();

    const blocks = getToolBlocks();
    expect(blocks[0].output).toBe("agent-output\n");
  });
});

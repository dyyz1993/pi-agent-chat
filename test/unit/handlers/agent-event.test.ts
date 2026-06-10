import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ContentBlock } from "../../../src/mainview/types";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
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

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: vi.fn(() => ({
      registerUIRequest: vi.fn(),
      clearPendingBySession: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  type SessionStatus = "idle" | "streaming" | "compacting" | "permission" | "retrying";
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
  return { useSessionStore, clearAgentStarted: () => {} };
});

vi.mock("../../../src/mainview/stores/use-chat-store", () => {
  const loadSessionMessages = vi.fn(() => Promise.resolve());

  interface ChatMessage {
    id: string;
    role: string;
    content: ContentBlock[];
    timestamp: number;
    isStreaming?: boolean;
    stopReason?: string | null;
  }
  interface ChatState {
    messagesBySession: Record<string, ChatMessage[]>;
    activeToolCallIdsBySession: Record<string, string[] | undefined>;
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
    setActiveToolCallIds: (sessionId: string, toolCallIds: string[] | undefined) => void;
    loadSessionMessages: (
      sessionId: string,
      options?: { force?: boolean; preserveStreaming?: boolean },
    ) => Promise<void>;
    incrementStreamVersion: () => void;
  }
  const useChatStore = create<ChatState>((set) => ({
    messagesBySession: {},
    activeToolCallIdsBySession: {},
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
    setActiveToolCallIds: (sessionId, toolCallIds) =>
      set((s) => ({
        activeToolCallIdsBySession: {
          ...s.activeToolCallIdsBySession,
          [sessionId]: toolCallIds,
        },
      })),
    loadSessionMessages,
    incrementStreamVersion: () =>
      set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),
  }));
  return { useChatStore };
});

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() })),
  },
}));

import { handleAgentEvent, toolCallNameMap } from "../../../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useUIDialogStore } from "../../../src/mainview/stores/use-ui-dialog-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { flushNow } from "../../../src/mainview/stores/message-batcher";

const SID = "test-session-1";
const TCID = "tc-bash-1";

function getMessages() {
  return useChatStore.getState().messagesBySession[SID] || [];
}

function getLastAssistant() {
  const msgs = getMessages();
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant") return msgs[i];
  }
  return null;
}

function getToolExecBlock(
  toolCallId: string = TCID,
): Extract<ContentBlock, { type: "toolExecution" }> | undefined {
  const msg = getLastAssistant();
  if (!msg) return undefined;
  return msg.content.find(
    (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
      b.type === "toolExecution" && b.toolCallId === toolCallId,
  );
}

function setMessages(msgs: unknown[]) {
  useChatStore.setState({ messagesBySession: { [SID]: msgs } });
}

beforeEach(() => {
  (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
    tokens: null,
    contextWindow: 0,
  });
  useChatStore.setState({
    messagesBySession: {},
    activeToolCallIdsBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
  });
  useChatStore.getState().loadSessionMessages = vi.fn(() => Promise.resolve());
  useSessionStore.setState({
    sessionStatusMap: {},
    sessionsByProject: {},
  });
  Object.keys(toolCallNameMap).forEach((k) => delete toolCallNameMap[k]);
  (useUIDialogStore.getState as ReturnType<typeof vi.fn>).mockClear();
});

describe("agent_start / agent_end", () => {
  it("agent_start sets sessionStatus to streaming", () => {
    handleAgentEvent(SID, { type: "agent_start" } as Parameters<typeof handleAgentEvent>[1]);
    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");
  });

  it("agent_end sets sessionStatus to idle", () => {
    useSessionStore.setState({ sessionStatusMap: { [SID]: "streaming" } });
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });
    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);
    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
  });

  it("agent_start bumps SessionMeta.updatedAt so session bubbles to top of list", () => {
    const oldTime = 1000;
    const otherTime = 2000;
    useSessionStore.setState({
      sessionsByProject: {
        "/proj": [
          { sessionId: "other-session", updatedAt: otherTime, sessionPath: "/s/other" },
          { sessionId: SID, updatedAt: oldTime, sessionPath: "/s/test" },
        ],
      },
    });

    const beforeEvent = Date.now();
    handleAgentEvent(SID, { type: "agent_start" } as Parameters<typeof handleAgentEvent>[1]);

    const sessions = useSessionStore.getState().sessionsByProject["/proj"];
    const updated = sessions.find((s) => s.sessionId === SID);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(beforeEvent);

    // The previously-older session should now have a newer updatedAt than the other
    const other = sessions.find((s) => s.sessionId === "other-session");
    expect((updated as { updatedAt: number }).updatedAt).toBeGreaterThan(
      (other as { updatedAt: number }).updatedAt,
    );
  });

  it("agent_start does not crash when session is not in sessionsByProject", () => {
    useSessionStore.setState({ sessionsByProject: {} });
    expect(() =>
      handleAgentEvent(SID, { type: "agent_start" } as Parameters<typeof handleAgentEvent>[1]),
    ).not.toThrow();
  });
});

describe("tool_execution_start", () => {
  it("adds toolExecution block with status=running to existing streaming message", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "echo hello" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block).toBeDefined();
    expect(block!.status).toBe("running");
    expect(block!.toolName).toBe("bash");
    expect(block!.args).toBe("echo hello");
    expect(toolCallNameMap[TCID]).toBe("bash");
    expect(useChatStore.getState().activeToolCallIdsBySession[SID]).toEqual([TCID]);
  });

  it("updates existing block if toolCallId matches", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "unknown",
            args: "",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "ls" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.toolName).toBe("bash");
    expect(block!.args).toBe("ls");
  });

  it("ignores replayed start when the same tool call already ended in an earlier message", () => {
    setMessages([
      {
        id: "history-msg",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "cargo build",
            status: "done",
            output: "finished\n",
          },
        ],
        timestamp: Date.now() - 10,
        isStreaming: false,
      },
      {
        id: "live-placeholder",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "cargo build", description: "build" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const messages = getMessages();
    const blocks = messages.flatMap((msg) =>
      msg.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
          b.type === "toolExecution" && b.toolCallId === TCID,
      ),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("done");
    expect(messages[1].content).toHaveLength(0);
  });
});

describe("tool_execution_update", () => {
  it("updates output on running block and keeps status=running", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo hello",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "hel" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.output).toBe("hel");
    expect(block!.status).toBe("running");
  });

  it("does not reopen a completed block when a delayed update arrives", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo hello",
            status: "done",
            output: "",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "hello\n" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.status).toBe("done");
    expect(block!.output).toBe("hello\n");
  });

  it("handles multiple sequential updates", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "seq",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "1\n" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "1\n2\n" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.output).toBe("1\n2\n");
    expect(block!.status).toBe("running");
  });

  it("does not reopen a completed block when a delayed start arrives", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo hello",
            status: "done",
            output: "hello\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: false,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "echo hello" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const block = getToolExecBlock();
    expect(block!.status).toBe("done");
    expect(block!.output).toBe("hello\n");
  });

  it("does not append a replayed start when a terminal block with a different id has the same command", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-history",
            toolName: "bash",
            args: JSON.stringify({ command: "echo hello", description: "say hello" }),
            status: "done",
            output: "hello\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: false,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: "tc-replayed-stale",
      toolName: "bash",
      args: { command: "echo hello", description: "say hello" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const blocks = getLastAssistant()!.content.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCallId).toBe("tc-history");
    expect(blocks[0].status).toBe("done");
    expect(blocks[0].output).toBe("hello\n");
  });
});

describe("tool_execution_end", () => {
  it("sets status=done with output", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo hello",
            status: "running",
            output: "hel",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_end",
      toolCallId: TCID,
      result: { content: [{ type: "text", text: "hello\n" }] },
      isError: false,
    } as Parameters<typeof handleAgentEvent>[1]);

    const block = getToolExecBlock();
    expect(block!.status).toBe("done");
    expect(block!.output).toBe("hello\n");
  });

  it("sets status=error when isError=true", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "exit 1",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_end",
      toolCallId: TCID,
      result: { content: [{ type: "text", text: "failed" }] },
      isError: true,
    } as Parameters<typeof handleAgentEvent>[1]);

    const block = getToolExecBlock();
    expect(block!.status).toBe("error");
    expect(block!.output).toBe("failed");
    expect(useChatStore.getState().activeToolCallIdsBySession[SID]).toEqual([]);
  });
});

describe("full streaming lifecycle", () => {
  it("start → update → end", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: TCID,
      toolName: "bash",
      args: { command: "echo ok" },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const step1 = getToolExecBlock();
    expect(step1!.status).toBe("running");
    expect(step1!.args).toBe("echo ok");

    handleAgentEvent(SID, {
      type: "tool_execution_update",
      toolCallId: TCID,
      partialResult: { content: [{ type: "text", text: "ok\n" }] },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const step2 = getToolExecBlock();
    expect(step2!.output).toBe("ok\n");
    expect(step2!.status).toBe("running");

    handleAgentEvent(SID, {
      type: "tool_execution_end",
      toolCallId: TCID,
      result: { content: [{ type: "text", text: "ok\n" }] },
      isError: false,
    } as Parameters<typeof handleAgentEvent>[1]);

    const step3 = getToolExecBlock();
    expect(step3!.status).toBe("done");
    expect(step3!.output).toBe("ok\n");
  });
});

describe("tool id reconciliation", () => {
  it("reuses a pending message_update tool block when execution start uses a different id", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "message-tool-id",
            name: "bash",
            arguments: { command: "ls now-mock", description: "查看 now-mock 项目" },
          },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    handleAgentEvent(SID, {
      type: "tool_execution_start",
      toolCallId: "execution-tool-id",
      toolName: "bash",
      args: { command: "ls now-mock", description: "查看 now-mock 项目" },
      timestamp: Date.now(),
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    handleAgentEvent(SID, {
      type: "tool_execution_end",
      toolCallId: "execution-tool-id",
      toolName: "bash",
      result: { content: [{ type: "text", text: "now-mock\n" }] },
      isError: false,
      timestamp: Date.now(),
      durationMs: 1000,
    } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    const execBlocks =
      msg?.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ) ?? [];
    expect(execBlocks).toHaveLength(1);
    expect(execBlocks[0].toolCallId).toBe("execution-tool-id");
    expect(execBlocks[0].status).toBe("done");
    expect(execBlocks[0].output).toBe("now-mock\n");
  });
});

describe("message_end tool card closure", () => {
  it("closes running tool blocks when assistant message ends without a tool end event", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo ok",
            status: "running",
            output: "ok\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "streaming" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-1",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    const block = getToolExecBlock();
    expect(msg!.isStreaming).toBe(false);
    expect(block!.status).toBe("done");
  });

  it("does not turn an empty toolUse assistant boundary into an error card", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "run tests" }],
        timestamp: Date.now() - 2,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "text", text: "I will run the tests." }],
        timestamp: Date.now() - 1,
      },
      {
        id: "assistant-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: false,
        stopReason: "toolUse",
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-tool-use",
      message: {
        role: "assistant",
        content: [],
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs.map((m) => m.id)).toEqual(["user-1", "assistant-1"]);
    expect(msgs.some((m) => m.role === "error")).toBe(false);
    expect(useChatStore.getState().loadSessionMessages).toHaveBeenCalledWith(SID, {
      force: true,
      preserveStreaming: false,
    });
  });

  it("does not reuse prior assistant text as an error when a later empty boundary arrives", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "continue" }],
        timestamp: Date.now() - 2,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "text", text: "Already answered." }],
        timestamp: Date.now() - 1,
      },
      {
        id: "assistant-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: false,
        stopReason: "stop",
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-stop",
      message: {
        role: "assistant",
        content: [],
        stopReason: "stop",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toEqual([{ type: "text", text: "Already answered." }]);
    expect(useChatStore.getState().loadSessionMessages).toHaveBeenCalledWith(SID, {
      force: true,
      preserveStreaming: false,
    });
  });

  it("does not turn a normal stop boundary into an empty-response error", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "continue" }],
        timestamp: Date.now() - 1,
      },
      {
        id: "assistant-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: false,
        stopReason: "stop",
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-stop-empty",
      message: {
        role: "assistant",
        content: [],
        stopReason: "stop",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs.map((m) => m.id)).toEqual(["user-1"]);
    expect(msgs.some((m) => m.role === "error")).toBe(false);
    expect(useChatStore.getState().loadSessionMessages).toHaveBeenCalledWith(SID, {
      force: true,
      preserveStreaming: false,
    });
  });

  it("keeps the empty-response error only when the current turn has no assistant content", () => {
    setMessages([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.now() - 1,
      },
      {
        id: "assistant-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: false,
        stopReason: "error",
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_end",
      entryId: "entry-error",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        timestamp: Date.now(),
      },
    } as Parameters<typeof handleAgentEvent>[1]);

    const msgs = getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe("error");
    expect(msgs[1].content).toEqual([
      { type: "text", text: "LLM 未返回有效响应\nLLM 返回了错误响应" },
    ]);
    expect(useChatStore.getState().loadSessionMessages).not.toHaveBeenCalled();
  });
});

describe("agent_end cleanup", () => {
  it("calls clearPendingBySession on agent_end", () => {
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });
    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    const mockGetState = useUIDialogStore.getState as ReturnType<typeof vi.fn>;
    expect(mockGetState).toHaveBeenCalled();
    const returned = mockGetState.mock.results[mockGetState.mock.results.length - 1].value;
    expect(returned.clearPendingBySession).toHaveBeenCalledWith(SID);
  });

  it("clears queueBySession for the ended session", () => {
    useSessionStore.setState({
      sessionsByProject: { "/tmp": [] },
      queueBySession: {
        [SID]: { steering: ["msg1"], followUp: ["msg2"] },
        "other-session": { steering: [], followUp: [] },
      },
    });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    expect(useSessionStore.getState().queueBySession[SID]).toBeUndefined();
    expect(useSessionStore.getState().queueBySession["other-session"]).toBeDefined();
  });

  it("does not modify queueBySession when session has no queue entry", () => {
    useSessionStore.setState({
      sessionsByProject: { "/tmp": [] },
      queueBySession: { "other-session": { steering: [], followUp: [] } },
    });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    expect(Object.keys(useSessionStore.getState().queueBySession)).toHaveLength(1);
  });

  it("closes running tool blocks when the agent ends without a tool end event", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "echo ok",
            status: "running",
            output: "ok\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    const block = getToolExecBlock();
    expect(msg!.isStreaming).toBe(false);
    expect(block!.status).toBe("done");
  });

  it("clears isStreaming on text-only assistant message when agent ends", () => {
    setMessages([
      {
        id: "msg-text",
        role: "assistant",
        content: [{ type: "text", text: "Hello!" }],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    expect(msg!.isStreaming).toBe(false);
  });

  it("clears isStreaming on empty assistant message when agent ends", () => {
    setMessages([
      {
        id: "msg-empty",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionsByProject: { "/tmp": [] } });

    handleAgentEvent(SID, { type: "agent_end" } as Parameters<typeof handleAgentEvent>[1]);

    const msg = getLastAssistant();
    expect(msg!.isStreaming).toBe(false);
  });
});

describe("message_update content block ordering", () => {
  it("preserves incoming order: text before toolCall", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check the file." },
          { type: "toolCall", id: TCID, name: "bash", arguments: { command: "cat foo" } },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const types = msg!.content.map((b) => b.type);
    expect(types).toEqual(["text", "toolExecution"]);
  });

  it("preserves incoming order: toolCall before text", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: TCID, name: "bash", arguments: { command: "ls" } },
          { type: "text", text: "Here are the files." },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const types = msg!.content.map((b) => b.type);
    expect(types).toEqual(["toolExecution", "text"]);
  });

  it("preserves interleaved order: text-tool-text", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "First, let me read the file." },
          { type: "toolCall", id: "tc-1", name: "read", arguments: { path: "/a" } },
          { type: "text", text: "Now I see the contents." },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const types = msg!.content.map((b) => b.type);
    expect(types).toEqual(["text", "toolExecution", "text"]);
  });

  it("places preserved toolExecs before incoming blocks", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-prev",
            toolName: "bash",
            args: "echo done",
            status: "done",
            output: "done\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Based on the result..." },
          { type: "toolCall", id: "tc-new", name: "read", arguments: { path: "/b" } },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const blocks = msg!.content;
    expect(blocks[0].type).toBe("toolExecution");
    expect((blocks[0] as Extract<ContentBlock, { type: "toolExecution" }>).toolCallId).toBe(
      "tc-prev",
    );
    expect(blocks[1].type).toBe("text");
    expect(blocks[2].type).toBe("toolExecution");
    expect((blocks[2] as Extract<ContentBlock, { type: "toolExecution" }>).toolCallId).toBe(
      "tc-new",
    );
  });

  it("merges incoming toolCall with existing toolExecution preserving position", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "",
            status: "running",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Running command..." },
          { type: "toolCall", id: TCID, name: "bash", arguments: { command: "ls" } },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const types = msg!.content.map((b) => b.type);
    expect(types).toEqual(["text", "toolExecution"]);
    const exec = msg!.content.find(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolCallId === TCID,
    );
    expect(exec!.args).toBe("ls");
  });

  it("merges incoming toolCall by semantic command when the realtime execution id differs", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-execution-start",
            toolName: "bash",
            args: "git commit -m M6.3",
            status: "running",
            output: "waiting...",
          },
        ],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "183 tests, 0 clippy warnings. M6.3 commit:" },
          {
            type: "toolCall",
            id: "tc-message-update",
            name: "bash",
            arguments: { command: "git commit -m M6.3", description: "commit M6.3" },
          },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const msg = getLastAssistant();
    expect(msg).not.toBeNull();
    const execs = msg!.content.filter(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
    );
    expect(msg!.content.map((b) => b.type)).toEqual(["text", "toolExecution"]);
    expect(execs).toHaveLength(1);
    expect(execs[0].toolCallId).toBe("tc-execution-start");
    expect(execs[0].status).toBe("running");
    expect(execs[0].output).toBe("waiting...");
    expect(execs[0].description).toBe("commit M6.3");
  });

  it("ignores delayed message_update for a tool call that is already terminal", () => {
    setMessages([
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "ls",
            status: "done",
            output: "file.txt\n",
          },
        ],
        timestamp: Date.now(),
        isStreaming: false,
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "idle" } });

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: TCID, name: "bash", arguments: { command: "ls" } }],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const messages = useChatStore.getState().messagesBySession[SID] || [];
    expect(messages).toHaveLength(1);
    const exec = messages[0].content.find(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolCallId === TCID,
    );
    expect(exec?.status).toBe("done");
    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
  });

  it("ignores delayed message_update when terminal tool is not the last assistant message", () => {
    setMessages([
      {
        id: "history-msg",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: TCID,
            toolName: "bash",
            args: "cargo build",
            status: "done",
            output: "finished\n",
          },
        ],
        timestamp: Date.now() - 10,
        isStreaming: false,
      },
      {
        id: "live-placeholder",
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    useSessionStore.setState({ sessionStatusMap: { [SID]: "streaming" } });

    handleAgentEvent(SID, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "stale replay" },
          {
            type: "toolCall",
            id: TCID,
            name: "bash",
            arguments: { command: "cargo build", description: "build" },
          },
        ],
      },
    } as Parameters<typeof handleAgentEvent>[1]);
    flushNow();

    const messages = getMessages();
    const blocks = messages.flatMap((msg) =>
      msg.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
          b.type === "toolExecution" && b.toolCallId === TCID,
      ),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("done");
    expect(messages[1].content).toHaveLength(0);
  });
});

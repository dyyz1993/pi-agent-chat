import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ContentBlock } from "../src/mainview/types";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
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

vi.mock("../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: vi.fn(),
  extractTokenUsage: vi.fn(() => null),
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })) },
}));

vi.mock("../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: vi.fn(() => ({
      registerUIRequest: vi.fn(),
      clearPendingBySession: vi.fn(),
    })),
  },
}));

vi.mock("../src/mainview/stores/use-session-store", () => {
  type SessionStatus = "idle" | "streaming" | "compacting" | "permission" | "retrying";
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
  interface ChatMessage {
    id: string;
    role: string;
    content: ContentBlock[];
    timestamp: number;
    isStreaming?: boolean;
  }
  interface ChatState {
    messagesBySession: Record<string, ChatMessage[]>;
    inputText: string;
    isStreaming: boolean;
    streamContentVersion: number;
    loadingSessions: Set<string>;
    historyLoadVersion: number;
    setMessagesForSession: (sessionId: string, msgs: ChatMessage[]) => void;
    incrementStreamVersion: () => void;
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
  }));
  return { useChatStore };
});

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() })),
  },
}));

import { handleAgentEvent, toolCallNameMap } from "../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { useUIDialogStore } from "../src/mainview/stores/use-ui-dialog-store";
import { flushNow } from "../src/mainview/stores/message-batcher";

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

  it("restores status from done to running (Bug3 fix verification)", () => {
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
    expect(block!.status).toBe("running");
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
    expect(exec!.args).toBe(JSON.stringify({ command: "ls" }, null, 2));
  });
});

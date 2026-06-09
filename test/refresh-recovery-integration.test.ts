import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import type { ContentBlock } from "../src/mainview/types";
import { create } from "zustand";
import { SID, TCID, makeAssistantMsg, makeUserMsg } from "./fixtures";

mock.module("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

mock.module("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: mock(),
    subscribe: mock(() => Promise.resolve("sub-id")),
    unsubscribe: mock(),
    onReconnect: mock(),
  },
}));

mock.module("../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: mock() },
}));

mock.module("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

mock.module("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}));

mock.module("../src/mainview/stores/use-session-store", () => {
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
  return { useSessionStore };
});

mock.module("../src/mainview/stores/use-chat-store", () => {
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
    setMessagesForSession: (
      sessionId: string,
      msgs: ChatMessage[],
      options?: { bumpStreamVersion?: boolean; streamingFastPath?: boolean },
    ) => void;
    incrementStreamVersion: () => void;
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
  }));
  return { useChatStore };
});

function normalizeToolBlocks(
  msgs: Array<{ role: string; content: ContentBlock[]; [k: string]: unknown }>,
): void {
  const toolCallById = new Map<
    string,
    { msgIndex: number; blockIndex: number; name: string; input: string }
  >();
  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    if (msg.role !== "assistant") continue;
    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      if (b.type === "toolCall") {
        toolCallById.set(b.id, { msgIndex: mi, blockIndex: bi, name: b.name, input: b.input });
      }
    }
  }
  const execByMsg = new Map<number, Map<number, ContentBlock>>();
  const toRemove = new Set<number>();
  for (let ti = 0; ti < msgs.length; ti++) {
    const trMsg = msgs[ti] as { role: string; content: ContentBlock[] };
    if (trMsg.role !== "toolResult") continue;
    const resultBlock = trMsg.content.find(
      (b): b is Extract<ContentBlock, { type: "toolResult" }> => b.type === "toolResult",
    );
    if (!resultBlock) continue;
    toRemove.add(ti);
    const match = toolCallById.get(resultBlock.toolCallId);
    const rawInput = match?.input ?? resultBlock.args;
    const args =
      typeof rawInput === "string"
        ? rawInput
        : rawInput != null
          ? JSON.stringify(rawInput, null, 2)
          : "";
    const execBlock: Extract<ContentBlock, { type: "toolExecution" }> = {
      type: "toolExecution",
      toolCallId: resultBlock.toolCallId,
      toolName: resultBlock.toolName ?? match?.name ?? "unknown",
      args,
      status: resultBlock.isError ? "error" : "done",
      output: resultBlock.content || undefined,
      details: resultBlock.details,
    };
    let targetMi: number;
    let targetBi: number;
    if (match) {
      targetMi = match.msgIndex;
      targetBi = match.blockIndex;
    } else {
      targetMi = ti - 1;
      while (targetMi >= 0 && msgs[targetMi].role !== "assistant") targetMi--;
      targetBi = -1;
    }
    if (targetMi >= 0) {
      if (!execByMsg.has(targetMi)) execByMsg.set(targetMi, new Map());
      execByMsg.get(targetMi)?.set(targetBi, execBlock);
    }
  }
  for (const [mi, biToBlock] of execByMsg) {
    const msg = msgs[mi] as { role: string; content: ContentBlock[]; [k: string]: unknown };
    const newContent: ContentBlock[] = [];
    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      if (b.type === "toolCall") {
        const exec = biToBlock.get(bi) ?? biToBlock.get(-1);
        if (exec) {
          newContent.push(exec);
        } else {
          const args =
            typeof b.input === "string"
              ? b.input
              : b.input != null
                ? JSON.stringify(b.input, null, 2)
                : "";
          newContent.push({
            type: "toolExecution",
            toolCallId: b.id,
            toolName: b.name,
            args,
            status: "running",
          });
        }
      } else {
        newContent.push(b);
      }
    }
    msgs[mi] = { ...msg, content: newContent };
  }
  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi] as { role: string; content: ContentBlock[]; [k: string]: unknown };
    if (msg.role !== "assistant") continue;
    let hasToolCall = false;
    for (const b of msg.content) {
      if (b.type === "toolCall") {
        hasToolCall = true;
        break;
      }
    }
    if (!hasToolCall) continue;
    if (execByMsg.has(mi)) continue;
    const newContent: ContentBlock[] = [];
    for (const b of msg.content) {
      if (b.type === "toolCall") {
        const args =
          typeof b.input === "string"
            ? b.input
            : b.input != null
              ? JSON.stringify(b.input, null, 2)
              : "";
        newContent.push({
          type: "toolExecution",
          toolCallId: b.id,
          toolName: b.name,
          args,
          status: "running",
        });
      } else {
        newContent.push(b);
      }
    }
    msgs[mi] = { ...msg, content: newContent };
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (toRemove.has(i)) msgs.splice(i, 1);
  }
}

mock.module("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: mock(() => ({ setPlugins: mock(), setSkills: mock(), setMcpServers: mock() })),
  },
}));

mock.module("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: mock(() => ({ loadFiles: mock(), addEvent: mock(), addInjected: mock() })),
  },
}));

mock.module("../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: mock(() => ({ startRetry: mock(), endRetry: mock() })) },
}));

mock.module("../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: mock(() => ({ registerUIRequest: mock(), clearPendingBySession: mock() })),
  },
}));

import { handleAgentEvent, toolCallNameMap } from "../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { flushNow } from "../src/mainview/stores/message-batcher";

interface ChatMessage {
  id: string;
  role: string;
  content: ContentBlock[];
  timestamp: number;
  isStreaming?: boolean;
}

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
}

function getToolExecBlock(
  sessionId: string,
): Extract<ContentBlock, { type: "toolExecution" }> | undefined {
  const msgs = useChatStore.getState().messagesBySession[sessionId] || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== "assistant") continue;
    const block = msgs[i].content.find(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolCallId === TCID,
    );
    if (block) return block;
  }
  return undefined;
}

describe("refresh-recovery integration", () => {
  beforeEach(() => {
    resetStores();
    Object.keys(toolCallNameMap).forEach((k) => delete toolCallNameMap[k]);
  });

  afterEach(() => {
    flushNow();
  });

  describe("Scenario 1: real-time streaming (normal flow, no refresh)", () => {
    it("should track toolExecution through start → update → end", () => {
      handleAgentEvent(SID, { type: "agent_start" });
      expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");

      handleAgentEvent(SID, {
        type: "message_start",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: TCID, name: "bash", arguments: "echo hello" }],
        },
      });
      flushNow();

      let block = getToolExecBlock(SID);
      expect(block).toBeDefined();
      expect(block!.status).toBe("running");

      handleAgentEvent(SID, {
        type: "tool_execution_start",
        toolCallId: TCID,
        toolName: "bash",
        args: { command: "echo hello" },
      });
      flushNow();

      handleAgentEvent(SID, {
        type: "tool_execution_update",
        toolCallId: TCID,
        partialResult: { content: [{ type: "text", text: "hel" }] },
      });
      flushNow();

      block = getToolExecBlock(SID);
      expect(block).toBeDefined();
      expect(block!.status).toBe("running");
      expect(block!.output).toBe("hel");

      handleAgentEvent(SID, {
        type: "tool_execution_update",
        toolCallId: TCID,
        partialResult: { content: [{ type: "text", text: "hello\n" }] },
      });
      flushNow();

      block = getToolExecBlock(SID);
      expect(block).toBeDefined();
      expect(block!.status).toBe("running");
      expect(block!.output).toBe("hello\n");

      handleAgentEvent(SID, {
        type: "tool_execution_end",
        toolCallId: TCID,
        result: { content: [{ type: "text", text: "hello\n" }] },
      });

      block = getToolExecBlock(SID);
      expect(block).toBeDefined();
      expect(block!.status).toBe("done");
      expect(block!.output).toBe("hello\n");
    });
  });

  describe("Scenario 2: refresh recovery (core)", () => {
    it("should restore running toolExecution from history + replay", () => {
      const userMsg = makeUserMsg("run bash");
      const assistantMsg = makeAssistantMsg([
        { type: "toolCall", id: TCID, name: "bash", input: "echo hello" },
      ]);

      const msgs: ChatMessage[] = [userMsg, assistantMsg];
      normalizeToolBlocks(msgs);

      const assistantAfter = msgs.find((m) => m.role === "assistant")!;
      const execBlock = assistantAfter.content.find(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      );
      expect(execBlock).toBeDefined();
      expect(execBlock!.status).toBe("running");
      expect(execBlock!.toolCallId).toBe(TCID);

      useChatStore.getState().setMessagesForSession(SID, msgs);

      handleAgentEvent(SID, { type: "agent_start" });

      handleAgentEvent(SID, {
        type: "tool_execution_update",
        toolCallId: TCID,
        partialResult: { content: [{ type: "text", text: "partial output" }] },
      });
      flushNow();

      const block = getToolExecBlock(SID);
      expect(block).toBeDefined();
      expect(block!.status).toBe("running");
      expect(block!.output).toBe("partial output");

      const storeMsgs = useChatStore.getState().messagesBySession[SID];
      expect(storeMsgs).toBeDefined();
      expect(storeMsgs.length).toBeGreaterThanOrEqual(2);
      expect(storeMsgs.some((m) => m.role === "user")).toBe(true);
      expect(storeMsgs.some((m) => m.role === "assistant")).toBe(true);
    });

    it("should handle multiple toolExecution blocks with mixed states after refresh", () => {
      const TCID_DONE = "tc-done-x";
      const TCID_RUNNING = "tc-running-x";

      const userMsg = makeUserMsg("run multiple commands");
      const assistantMsg: ChatMessage = {
        id: "msg-assistant-multi",
        role: "assistant",
        content: [
          { type: "toolCall", id: TCID_DONE, name: "bash", input: "echo done" },
          { type: "toolCall", id: TCID_RUNNING, name: "bash", input: "sleep 999" },
        ],
        timestamp: Date.now(),
      };
      const toolResultMsg: ChatMessage = {
        id: "msg-result-done",
        role: "toolResult",
        content: [
          { type: "toolResult", toolCallId: TCID_DONE, toolName: "bash", content: "done\n" },
        ],
        timestamp: Date.now(),
      };

      const msgs: ChatMessage[] = [userMsg, assistantMsg, toolResultMsg];
      normalizeToolBlocks(msgs);

      expect(msgs.length).toBe(2);

      const asst = msgs.find((m) => m.role === "assistant")!;
      const blocks = asst.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      );
      expect(blocks.length).toBe(2);

      const doneBlock = blocks.find((b) => b.toolCallId === TCID_DONE)!;
      const runningBlock = blocks.find((b) => b.toolCallId === TCID_RUNNING)!;

      expect(doneBlock.status).toBe("done");
      expect(doneBlock.output).toBe("done\n");
      expect(runningBlock.status).toBe("running");

      useChatStore.getState().setMessagesForSession(SID, msgs);

      handleAgentEvent(SID, {
        type: "tool_execution_update",
        toolCallId: TCID_RUNNING,
        partialResult: { content: [{ type: "text", text: "awake!" }] },
      });
      flushNow();

      const storeMsgs = useChatStore.getState().messagesBySession[SID];
      const asstMsg = storeMsgs.find((m) => m.role === "assistant")!;
      const updatedBlocks = asstMsg.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      );

      const doneAfter = updatedBlocks.find((b) => b.toolCallId === TCID_DONE)!;
      const runningAfter = updatedBlocks.find((b) => b.toolCallId === TCID_RUNNING)!;

      expect(doneAfter.status).toBe("done");
      expect(runningAfter.status).toBe("running");
      expect(runningAfter.output).toBe("awake!");
    });
  });

  describe("Scenario 3: replay then load order guarantee", () => {
    it("should correctly merge replay events with loaded messages", () => {
      useChatStore.getState().setMessagesForSession(SID, []);
      expect(useChatStore.getState().messagesBySession[SID]).toEqual([]);

      handleAgentEvent(SID, { type: "agent_start" });
      expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");

      handleAgentEvent(SID, {
        type: "message_start",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: TCID, name: "bash", arguments: "echo test" }],
        },
      });
      flushNow();

      let msgs = useChatStore.getState().messagesBySession[SID];
      expect(msgs.length).toBe(1);
      expect(msgs[0].role).toBe("assistant");

      handleAgentEvent(SID, {
        type: "tool_execution_start",
        toolCallId: TCID,
        toolName: "bash",
        args: { command: "echo test" },
      });
      flushNow();

      const userMsg = makeUserMsg("echo test");
      const assistantMsg = makeAssistantMsg([
        { type: "toolCall", id: TCID, name: "bash", input: "echo test" },
      ]);

      const loadedMsgs = [userMsg, assistantMsg];
      normalizeToolBlocks(loadedMsgs);

      useChatStore.getState().setMessagesForSession(SID, loadedMsgs);

      msgs = useChatStore.getState().messagesBySession[SID];
      expect(msgs.length).toBe(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");

      const asst = msgs.find((m) => m.role === "assistant")!;
      const toolExec = asst.content.find(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      );
      expect(toolExec).toBeDefined();
      expect(toolExec!.toolCallId).toBe(TCID);

      handleAgentEvent(SID, {
        type: "tool_execution_update",
        toolCallId: TCID,
        partialResult: { content: [{ type: "text", text: "test output" }] },
      });
      flushNow();

      msgs = useChatStore.getState().messagesBySession[SID];
      const asstAfter = msgs.find((m) => m.role === "assistant")!;
      const execAfter = asstAfter.content.find(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      );
      expect(execAfter).toBeDefined();
      expect(execAfter!.output).toBe("test output");
      expect(execAfter!.status).toBe("running");
    });

    it("should preserve session status across replay → load sequence", () => {
      handleAgentEvent(SID, { type: "agent_start" });
      expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");

      handleAgentEvent(SID, {
        type: "message_start",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "thinking..." }],
        },
      });
      flushNow();

      let msgs = useChatStore.getState().messagesBySession[SID];
      expect(msgs.length).toBe(1);
      expect(msgs[0].isStreaming).toBe(true);

      const loadedMsgs: ChatMessage[] = [
        makeUserMsg("hello"),
        {
          id: "msg-loaded-assistant",
          role: "assistant",
          content: [{ type: "text", text: "thinking..." }],
          timestamp: Date.now(),
          isStreaming: false,
        },
      ];
      useChatStore.getState().setMessagesForSession(SID, loadedMsgs);

      msgs = useChatStore.getState().messagesBySession[SID];
      expect(msgs.length).toBe(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].isStreaming).toBe(false);

      expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("streaming");

      handleAgentEvent(SID, { type: "agent_end" });
      expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
    });
  });
});

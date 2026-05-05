import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatMessage, ContentBlock } from "../src/mainview/types";
import { SID, TCID, makeAssistantMsg, makeUserMsg } from "./fixtures";

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

vi.mock("../src/mainview/stores/use-session-store", async () => {
  const { create } = await import("zustand");
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

import { handleAgentEvent, toolCallNameMap } from "../src/mainview/stores/agent-event-handler";
import { normalizeToolBlocks, useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { flushNow } from "../src/mainview/stores/message-batcher";

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

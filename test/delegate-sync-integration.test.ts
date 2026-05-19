import { describe, it, expect, vi, beforeEach } from "vitest";

type SyncResult = {
  sessionId: string;
  status: string;
  exitCode: number;
  finalText: string;
  error?: string;
};

type SyncResolver = {
  resolve: (result: SyncResult) => void;
  timeout: ReturnType<typeof setTimeout>;
  parentSessionId: string;
};

interface DelegateSyncDeps {
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
  ) => Promise<{ status: string }>;
  send: (sessionId: string, prompt: string) => void;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  broadcastEvent: (
    event: string,
    payload: Record<string, unknown>,
    opts?: { parentSessionId?: string },
  ) => Promise<void>;
  stop: (sessionId: string) => void;
}

interface SubagentSessionInfo {
  sessionId: string;
  sessionPath: string;
  description: string;
  instruction: string;
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  finalText?: string;
  provider?: string;
  model?: string;
}

type SessionStatus = "idle" | "streaming" | "compacting" | "retrying" | "stopped";

interface ChatMessage {
  id?: string;
  role: string;
  content: Array<Record<string, unknown>>;
  isStreaming?: boolean;
  stopReason?: string | null;
  provider?: string;
  model?: string;
  tokenUsage?: Record<string, unknown>;
}

interface MockSubagentState {
  subsessionsByParent: Record<string, SubagentSessionInfo[]>;
  messagesBySubsession: Record<string, ChatMessage[]>;
  subagentStatusMap: Record<string, SessionStatus>;
  subagentContextMap: Record<string, { tokens: number | null; contextWindow: number }>;
}

class MockSubagentStore {
  state: MockSubagentState = {
    subsessionsByParent: {},
    messagesBySubsession: {},
    subagentStatusMap: {},
    subagentContextMap: {},
  };

  updateSubagentStatus(subId: string, status: SessionStatus): void {
    this.state.subagentStatusMap[subId] = status;
  }

  upsertLiveSubagent(
    parentSessionPath: string,
    subId: string,
    partial: Partial<SubagentSessionInfo>,
  ): void {
    const existing = this.state.subsessionsByParent[parentSessionPath] || [];
    const idx = existing.findIndex((e) => e.sessionId === subId);
    const base =
      idx >= 0
        ? existing[idx]
        : {
            sessionId: subId,
            sessionPath: "",
            description: "",
            instruction: "",
            startedAt: Date.now(),
          };
    const merged: SubagentSessionInfo = { ...base, ...partial };
    let updated: SubagentSessionInfo[];
    if (idx >= 0) {
      updated = [...existing];
      updated[idx] = merged;
    } else {
      updated = [...existing, merged];
    }
    this.state.subsessionsByParent[parentSessionPath] = updated;
  }

  setSubMessages(subId: string, msgs: ChatMessage[]): void {
    this.state.messagesBySubsession[subId] = msgs;
  }

  reset(): void {
    this.state = {
      subsessionsByParent: {},
      messagesBySubsession: {},
      subagentStatusMap: {},
      subagentContextMap: {},
    };
  }
}

class SyncDelegateHarness {
  syncDelegateResolvers = new Map<string, SyncResolver>();
  subagentSyncChildren = new Set<string>();
  syncDelegateLastText = new Map<string, string>();
  parentChildMap = new Map<string, Set<string>>();
  delegateCreatedAt = new Map<string, number>();
  delegateReplyCount = new Map<string, number>();

  constructor(private deps: DelegateSyncDeps) {}

  private generateSessionId(): string {
    return `sess_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  startDelegateSync(
    parentSessionId: string,
    msg: { task: string; title?: string; agent?: string; timeoutMs?: number },
  ): { sessionId: string; resultPromise: Promise<SyncResult> } {
    const { task, title, agent, timeoutMs = 300000 } = msg;

    const newSessionId = this.generateSessionId();

    this.delegateCreatedAt.set(newSessionId, Date.now());
    this.delegateReplyCount.set(newSessionId, 0);

    let children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      children = new Set<string>();
      this.parentChildMap.set(parentSessionId, children);
    }
    children.add(newSessionId);

    const rawTitle = title ?? task.slice(0, 60);

    const syncPromise = new Promise<SyncResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.syncDelegateResolvers.delete(newSessionId);
        this.subagentSyncChildren.delete(newSessionId);
        this.syncDelegateLastText.delete(newSessionId);
        resolve({
          sessionId: newSessionId,
          status: "timeout",
          exitCode: 1,
          finalText: "(timed out)",
        });
      }, timeoutMs);

      this.syncDelegateResolvers.set(newSessionId, { resolve, timeout, parentSessionId });
    });

    this.subagentSyncChildren.add(newSessionId);

    const sessionTitle = `子代理: ${rawTitle}`;
    const delegatePrompt = [
      `[系统提示] 你是一个子代理任务会话。`,
      agent ? `**Agent 角色:** ${agent}` : "",
      `**任务:** ${rawTitle}`,
      ``,
      `要求：`,
      `1. 专注于完成委派给你的任务`,
      `2. 执行完毕后，明确总结你的工作成果`,
      `3. 如果遇到问题无法继续，说明原因`,
      ``,
      `---`,
      ``,
      task,
    ]
      .filter(Boolean)
      .join("\n");

    const resultPromise = this.deps
      .start(newSessionId, "/fake/project", `/fake/sessions/${newSessionId}.jsonl`)
      .then(() => this.deps.setSessionName(newSessionId, sessionTitle))
      .then(() => {
        this.deps.send(newSessionId, delegatePrompt);
        return this.deps.broadcastEvent("subagent.event", {
          parentSessionId,
          parentSessionPath: `/fake/sessions/${parentSessionId}.jsonl`,
          subSessionId: newSessionId,
          event: {
            type: "subagent_start",
            toolCallId: "",
            description: rawTitle,
            instruction: task,
          },
        });
      })
      .then(() => syncPromise);

    return { sessionId: newSessionId, resultPromise };
  }

  simulateAgentStart(sessionId: string, parentId: string): void {
    if (!this.subagentSyncChildren.has(sessionId)) return;
    this.deps
      .broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: `/fake/sessions/${parentId}.jsonl`,
        subSessionId: sessionId,
        event: { type: "agent_start" },
      })
      .catch(() => {});
  }

  simulateMessageStart(sessionId: string, parentId: string, messageId?: string): void {
    if (!this.subagentSyncChildren.has(sessionId)) return;
    this.deps
      .broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: `/fake/sessions/${parentId}.jsonl`,
        subSessionId: sessionId,
        event: {
          type: "message_start",
          message: { id: messageId ?? "msg-1", role: "assistant", content: [] },
        },
      })
      .catch(() => {});
  }

  simulateMessageUpdate(sessionId: string, parentId: string, textDelta: string): void {
    if (!this.subagentSyncChildren.has(sessionId)) return;
    this.deps
      .broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: `/fake/sessions/${parentId}.jsonl`,
        subSessionId: sessionId,
        event: {
          type: "message_update",
          message: {
            role: "assistant",
            content: [{ type: "text", text: textDelta }],
          },
        },
      })
      .catch(() => {});
  }

  simulateToolExecutionStart(
    sessionId: string,
    parentId: string,
    toolCallId: string,
    toolName: string,
  ): void {
    if (!this.subagentSyncChildren.has(sessionId)) return;
    this.deps
      .broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: `/fake/sessions/${parentId}.jsonl`,
        subSessionId: sessionId,
        event: { type: "tool_execution_start", toolCallId, toolName },
      })
      .catch(() => {});
  }

  simulateMessageEnd(sessionId: string, textContent: string): void {
    if (this.subagentSyncChildren.has(sessionId)) {
      this.syncDelegateLastText.set(sessionId, textContent.slice(0, 2000));
    }
  }

  simulateAgentEnd(sessionId: string): void {
    const resolver = this.syncDelegateResolvers.get(sessionId);
    if (resolver) {
      clearTimeout(resolver.timeout);
      this.syncDelegateResolvers.delete(sessionId);
      this.subagentSyncChildren.delete(sessionId);
      const finalText = this.syncDelegateLastText.get(sessionId) ?? "(completed)";
      this.syncDelegateLastText.delete(sessionId);
      resolver.resolve({
        sessionId,
        status: "completed",
        exitCode: 0,
        finalText: finalText || "(completed)",
      });
    }
  }

  simulateCrash(sessionId: string, errorText: string): void {
    const resolver = this.syncDelegateResolvers.get(sessionId);
    if (resolver) {
      clearTimeout(resolver.timeout);
      this.syncDelegateResolvers.delete(sessionId);
      this.subagentSyncChildren.delete(sessionId);
      this.syncDelegateLastText.delete(sessionId);
      resolver.resolve({
        sessionId,
        status: "error",
        exitCode: 1,
        finalText: errorText,
        error: errorText,
      });
    }
  }

  stopSession(sessionId: string): void {
    this.deps.stop(sessionId);

    for (const [, childSet] of this.parentChildMap) {
      childSet.delete(sessionId);
    }
    this.delegateReplyCount.delete(sessionId);
    this.delegateCreatedAt.delete(sessionId);

    const syncResolver = this.syncDelegateResolvers.get(sessionId);
    if (syncResolver) {
      clearTimeout(syncResolver.timeout);
      this.syncDelegateResolvers.delete(sessionId);
      this.subagentSyncChildren.delete(sessionId);
      this.syncDelegateLastText.delete(sessionId);
      syncResolver.resolve({ sessionId, status: "aborted", exitCode: 1, finalText: "(stopped)" });
    }
  }

  findParentSession(childSessionId: string): string | null {
    for (const [parentId, children] of this.parentChildMap.entries()) {
      if (children.has(childSessionId)) return parentId;
    }
    return null;
  }
}

function createMockDeps(): DelegateSyncDeps & { _mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const start = vi.fn().mockResolvedValue({ status: "started" });
  const send = vi.fn();
  const setSessionName = vi.fn().mockResolvedValue(undefined);
  const broadcastEvent = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn();
  return {
    start,
    send,
    setSessionName,
    broadcastEvent,
    stop,
    _mocks: { start, send, setSessionName, broadcastEvent, stop },
  };
}

function feedEventToStore(
  store: MockSubagentStore,
  subId: string,
  event: Record<string, unknown>,
  parentPath?: string,
): void {
  const eventType = event.type as string;

  if (eventType === "agent_start" || eventType === "subagent_start") {
    store.updateSubagentStatus(subId, "streaming");
    if (eventType === "subagent_start" && parentPath) {
      store.upsertLiveSubagent(parentPath, subId, {
        description: (event.description as string) ?? "",
        instruction: (event.instruction as string) ?? "",
      });
    }
    return;
  }

  if (eventType === "agent_end") {
    for (const [path, subs] of Object.entries(store.state.subsessionsByParent)) {
      const match = subs.find((s) => s.sessionId === subId);
      if (match && !match.completedAt) {
        store.upsertLiveSubagent(path, subId, {
          completedAt: Date.now(),
          exitCode: 0,
          finalText: match.finalText ?? "(completed)",
        });
        break;
      }
    }
    store.updateSubagentStatus(subId, "idle");
    return;
  }

  if (eventType === "message_start") {
    const msg = event.message as Record<string, unknown> | undefined;
    if (msg) {
      const existing = store.state.messagesBySubsession[subId] || [];
      store.setSubMessages(subId, [
        ...existing,
        {
          role: String(msg.role ?? "assistant"),
          content: (msg.content as Array<Record<string, unknown>>) ?? [],
          isStreaming: true,
        },
      ]);
    }
    return;
  }

  if (eventType === "message_update") {
    const existing = store.state.messagesBySubsession[subId] || [];
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const blocks = [...(lastMsg.content as Array<Record<string, unknown>>)];
    const msgContent = (event.message as Record<string, unknown>)?.content as
      | Array<Record<string, unknown>>
      | undefined;
    if (!msgContent) return;

    for (const block of msgContent) {
      if (block.type === "text") {
        const lastIdx = blocks.length - 1;
        const lastBlock = blocks[lastIdx];
        if (lastIdx >= 0 && lastBlock?.type === "text") {
          blocks[lastIdx] = { type: "text", text: lastBlock.text + block.text };
        } else {
          blocks.push(block);
        }
      } else {
        blocks.push(block);
      }
    }

    store.setSubMessages(subId, [...existing.slice(0, -1), { ...lastMsg, content: blocks }]);
    return;
  }

  if (eventType === "message_end") {
    const existing = store.state.messagesBySubsession[subId] || [];
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const msg = event.message as Record<string, unknown> | undefined;
    let finalText = "";
    const content = msg?.content as Array<{ type: string; text?: string }> | undefined;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text" && typeof part.text === "string") finalText += part.text;
      }
    }

    store.setSubMessages(subId, [
      ...existing.slice(0, -1),
      { ...lastMsg, isStreaming: false, stopReason: (msg?.stopReason as string) ?? null },
    ]);

    if (finalText) {
      for (const [path, subs] of Object.entries(store.state.subsessionsByParent)) {
        if (subs.some((s) => s.sessionId === subId)) {
          store.upsertLiveSubagent(path, subId, {
            completedAt: Date.now(),
            exitCode: 0,
            finalText: finalText.slice(0, 200),
          });
          break;
        }
      }
    }
    return;
  }

  if (eventType === "tool_execution_start") {
    const existing = store.state.messagesBySubsession[subId] || [];
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const blocks = [...(lastMsg.content as Array<Record<string, unknown>>)];
    blocks.push({
      type: "toolExecution",
      toolCallId: event.toolCallId as string,
      toolName: event.toolName as string,
      args: "",
      status: "running",
    });

    store.setSubMessages(subId, [...existing.slice(0, -1), { ...lastMsg, content: blocks }]);
    return;
  }

  if (eventType === "tool_execution_end") {
    const existing = store.state.messagesBySubsession[subId] || [];
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const blocks = [...(lastMsg.content as Array<Record<string, unknown>>)];
    const targetIdx = blocks.findIndex(
      (b): b is Record<string, unknown> & { toolCallId: string } =>
        b.type === "toolExecution" && b.toolCallId === (event.toolCallId as string),
    );

    if (targetIdx >= 0) {
      const isError = Boolean(event.isError);
      blocks[targetIdx] = {
        ...blocks[targetIdx],
        status: isError ? "error" : "done",
        output: event.result ? JSON.stringify(event.result) : "",
      };
    }

    store.setSubMessages(subId, [...existing.slice(0, -1), { ...lastMsg, content: blocks }]);
    return;
  }
}

describe("session_delegate_sync — Full Integration", () => {
  let mockDeps: ReturnType<typeof createMockDeps>;
  let harness: SyncDelegateHarness;
  let mockStore: MockSubagentStore;

  beforeEach(() => {
    mockDeps = createMockDeps();
    harness = new SyncDelegateHarness(mockDeps);
    mockStore = new MockSubagentStore();
  });

  describe("Lifecycle: created → running → completed", () => {
    it("should create child session and register parent-child relationship", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "refactor auth module",
        title: "Auth Refactor",
      });

      expect(childId).toMatch(/^sess_sub_/);
      expect(harness.syncDelegateResolvers.has(childId)).toBe(true);
      expect(harness.subagentSyncChildren.has(childId)).toBe(true);

      const children = harness.parentChildMap.get("parent-001");
      expect(children).toBeDefined();
      expect(children!.has(childId)).toBe(true);

      harness.simulateAgentEnd(childId);
      await resultPromise;
    });

    it("should emit subagent_start event with correct metadata", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "write unit tests for user service",
        title: "User Service Tests",
        agent: "test-writer",
      });

      harness.simulateAgentEnd(childId);
      await resultPromise;

      const subagentCalls = mockDeps._mocks.broadcastEvent.mock.calls.filter(
        (c) => c[0] === "subagent.event",
      );
      expect(subagentCalls.length).toBeGreaterThanOrEqual(1);

      const startCall = subagentCalls.find(
        (c) =>
          ((c[1] as Record<string, unknown>).event as Record<string, unknown>).type ===
          "subagent_start",
      );
      expect(startCall).toBeDefined();

      const payload = startCall![1] as Record<string, unknown>;
      const evt = payload.event as Record<string, unknown>;

      expect(payload.parentSessionId).toBe("parent-001");
      expect(payload.subSessionId).toBe(childId);
      expect(evt.type).toBe("subagent_start");
      expect(evt.description).toBe("User Service Tests");
      expect(evt.instruction).toBe("write unit tests for user service");
      expect(evt.toolCallId).toBe("");
    });

    it("should route agent_start as subagent.event to frontend", () => {
      const childId = "sync-child-agent-start";
      harness.subagentSyncChildren.add(childId);

      harness.simulateAgentStart(childId, "parent-001");

      const calls = mockDeps._mocks.broadcastEvent.mock.calls.filter(
        (c) => c[0] === "subagent.event",
      );
      const agentStartCall = calls.find(
        (c) =>
          ((c[1] as Record<string, unknown>).event as Record<string, unknown>).type ===
          "agent_start",
      );
      expect(agentStartCall).toBeDefined();

      const payload = agentStartCall![1] as Record<string, unknown>;
      expect(payload.subSessionId).toBe(childId);
      expect(payload.parentSessionId).toBe("parent-001");
    });

    it("should route message_start/update/end as subagent.event", () => {
      const childId = "sync-child-msg-flow";
      harness.subagentSyncChildren.add(childId);

      harness.simulateMessageStart(childId, "parent-001", "msg-a");
      harness.simulateMessageUpdate(childId, "parent-001", "Hello ");
      harness.simulateMessageUpdate(childId, "parent-001", "World");

      const calls = mockDeps._mocks.broadcastEvent.mock.calls.filter(
        (c) => c[0] === "subagent.event",
      );

      const msgStart = calls.find(
        (c) =>
          ((c[1] as Record<string, unknown>).event as Record<string, unknown>).type ===
          "message_start",
      );
      expect(msgStart).toBeDefined();

      const msgUpdates = calls.filter(
        (c) =>
          ((c[1] as Record<string, unknown>).event as Record<string, unknown>).type ===
          "message_update",
      );
      expect(msgUpdates.length).toBe(2);
    });

    it("should route tool_execution events as subagent.event", () => {
      const childId = "sync-child-tool";
      harness.subagentSyncChildren.add(childId);

      harness.simulateToolExecutionStart(childId, "parent-001", "tc-1", "Bash");

      const calls = mockDeps._mocks.broadcastEvent.mock.calls.filter(
        (c) => c[0] === "subagent.event",
      );
      const toolCall = calls.find(
        (c) =>
          ((c[1] as Record<string, unknown>).event as Record<string, unknown>).type ===
          "tool_execution_start",
      );
      expect(toolCall).toBeDefined();

      const evt = (toolCall![1] as Record<string, unknown>).event as Record<string, unknown>;
      expect(evt.toolCallId).toBe("tc-1");
      expect(evt.toolName).toBe("Bash");
    });

    it("should resolve with completed status on agent_end", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "complete task",
      });

      let resolved = false;
      resultPromise.then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);

      harness.simulateAgentEnd(childId);
      const result = await resultPromise;

      expect(result.status).toBe("completed");
      expect(result.exitCode).toBe(0);
      expect(result.sessionId).toBe(childId);
    });

    it("should include finalText in resolved result", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "produce output",
      });

      harness.simulateMessageEnd(childId, "Here is the complete analysis report...");
      harness.simulateAgentEnd(childId);

      const result = await resultPromise;
      expect(result.finalText).toBe("Here is the complete analysis report...");
    });
  });

  describe("Error handling", () => {
    it("should resolve with error status on child crash", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "crashy task",
      });

      harness.simulateCrash(childId, "Process exited with code SIGSEGV");

      const result = await resultPromise;
      expect(result.status).toBe("error");
      expect(result.exitCode).toBe(1);
      expect(result.finalText).toBe("Process exited with code SIGSEGV");
      expect(result.error).toBe("Process exited with code SIGSEGV");
    });

    it("should timeout and resolve with timeout status", async () => {
      vi.useFakeTimers();
      try {
        const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
          task: "slow task",
          timeoutMs: 5000,
        });

        vi.advanceTimersByTime(5000);
        const result = await resultPromise;

        expect(result.status).toBe("timeout");
        expect(result.exitCode).toBe(1);
        expect(result.finalText).toBe("(timed out)");
        expect(harness.syncDelegateResolvers.has(childId)).toBe(false);
        expect(harness.subagentSyncChildren.has(childId)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should abort and resolve with aborted status on stop", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "stoppable task",
      });

      harness.stopSession(childId);
      const result = await resultPromise;

      expect(result.status).toBe("aborted");
      expect(result.exitCode).toBe(1);
      expect(result.finalText).toBe("(stopped)");
      expect(mockDeps._mocks.stop).toHaveBeenCalledWith(childId);
    });

    it("should handle multiple error scenarios independently", async () => {
      vi.useFakeTimers();
      try {
        const { sessionId: id1, resultPromise: p1 } = harness.startDelegateSync("parent-001", {
          task: "ok",
        });
        const { sessionId: id2, resultPromise: p2 } = harness.startDelegateSync("parent-001", {
          task: "crash",
        });
        harness.startDelegateSync("parent-001", {
          task: "timeout",
          timeoutMs: 3000,
        });

        harness.simulateAgentEnd(id1, "done ok");
        harness.simulateCrash(id2, "OOM killed");

        vi.advanceTimersByTime(3001);

        const [r1, r2, r3] = await Promise.allSettled([p1, p2, p3]);

        expect(r1.status).toBe("fulfilled");
        if (r1.status === "fulfilled") expect(r1.value.status).toBe("completed");

        expect(r2.status).toBe("fulfilled");
        if (r2.status === "fulfilled") expect(r2.value.status).toBe("error");

        expect(r3.status).toBe("fulfilled");
        if (r3.status === "fulfilled") expect(r3.value.status).toBe("timeout");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Cleanup", () => {
    it("should clean up resolvers after resolve", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "cleanup resolver",
      });

      expect(harness.syncDelegateResolvers.size).toBe(1);

      harness.simulateAgentEnd(childId);
      await resultPromise;

      expect(harness.syncDelegateResolvers.has(childId)).toBe(false);
      expect(harness.syncDelegateResolvers.size).toBe(0);
    });

    it("should clean up subagentSyncChildren set", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "cleanup children",
      });

      expect(harness.subagentSyncChildren.has(childId)).toBe(true);

      harness.simulateAgentEnd(childId);
      await resultPromise;

      expect(harness.subagentSyncChildren.has(childId)).toBe(false);
    });

    it("should NOT remove from parentChildMap on normal completion", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "keep parent map",
      });

      harness.simulateAgentEnd(childId);
      await resultPromise;

      const children = harness.parentChildMap.get("parent-001");
      expect(children).toBeDefined();
      expect(children!.has(childId)).toBe(true);
    });

    it("should remove from parentChildMap on stop", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "remove from map",
      });

      harness.stopSession(childId);
      await resultPromise;

      const children = harness.parentChildMap.get("parent-001");
      if (children) expect(children.has(childId)).toBe(false);
    });

    it("should clean up all metadata maps on abort", async () => {
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-001", {
        task: "full cleanup",
      });

      expect(harness.delegateCreatedAt.has(childId)).toBe(true);
      expect(harness.delegateReplyCount.has(childId)).toBe(true);

      harness.stopSession(childId);
      await resultPromise;

      expect(harness.syncDelegateResolvers.has(childId)).toBe(false);
      expect(harness.subagentSyncChildren.has(childId)).toBe(false);
      expect(harness.syncDelegateLastText.has(childId)).toBe(false);
      expect(harness.delegateCreatedAt.has(childId)).toBe(false);
      expect(harness.delegateReplyCount.has(childId)).toBe(false);
    });
  });

  describe("Multiple concurrent delegates", () => {
    it("should handle 3 parallel delegates independently", async () => {
      const { sessionId: id1, resultPromise: p1 } = harness.startDelegateSync("parent-A", {
        task: "task-alpha",
      });
      const { sessionId: id2, resultPromise: p2 } = harness.startDelegateSync("parent-A", {
        task: "task-beta",
      });
      const { sessionId: id3, resultPromise: p3 } = harness.startDelegateSync("parent-B", {
        task: "task-gamma",
      });

      expect(harness.syncDelegateResolvers.size).toBe(3);
      expect(harness.subagentSyncChildren.size).toBe(3);

      const childrenA = harness.parentChildMap.get("parent-A");
      expect(childrenA!.size).toBe(2);
      expect(childrenA!.has(id1)).toBe(true);
      expect(childrenA!.has(id2)).toBe(true);

      const childrenB = harness.parentChildMap.get("parent-B");
      expect(childrenB!.size).toBe(1);
      expect(childrenB!.has(id3)).toBe(true);

      harness.simulateMessageEnd(id1, "alpha done");
      harness.simulateMessageEnd(id2, "beta done");
      harness.simulateMessageEnd(id3, "gamma done");
      harness.simulateAgentEnd(id1);
      harness.simulateAgentEnd(id2);
      harness.simulateAgentEnd(id3);

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(r1.sessionId).toBe(id1);
      expect(r1.finalText).toBe("alpha done");
      expect(r2.sessionId).toBe(id2);
      expect(r2.finalText).toBe("beta done");
      expect(r3.sessionId).toBe(id3);
      expect(r3.finalText).toBe("gamma done");
    });

    it("should not cross-contaminate between delegates", async () => {
      const { sessionId: idA, resultPromise: pA } = harness.startDelegateSync("parent-X", {
        task: "delegate A work",
      });
      const { sessionId: idB, resultPromise: pB } = harness.startDelegateSync("parent-Y", {
        task: "delegate B work",
      });

      harness.simulateMessageEnd(idA, "output from A only");
      harness.simulateMessageEnd(idB, "output from B only");

      harness.simulateAgentEnd(idA);
      harness.simulateAgentEnd(idB);

      const [rA, rB] = await Promise.all([pA, pB]);

      expect(rA.finalText).toBe("output from A only");
      expect(rB.finalText).toBe("output from B only");
      expect(rA.sessionId).not.toBe(rB.sessionId);
    });

    it("should resolve delegates in any order regardless of creation order", async () => {
      const { sessionId: id1, resultPromise: p1 } = harness.startDelegateSync("parent-001", {
        task: "first",
      });
      const { sessionId: id2, resultPromise: p2 } = harness.startDelegateSync("parent-001", {
        task: "second",
      });
      const { sessionId: id3, resultPromise: p3 } = harness.startDelegateSync("parent-001", {
        task: "third",
      });

      harness.simulateMessageEnd(id3, "third finishes first");
      harness.simulateMessageEnd(id1, "first finishes second");
      harness.simulateMessageEnd(id2, "second finishes last");
      harness.simulateAgentEnd(id3);
      harness.simulateAgentEnd(id1);
      harness.simulateAgentEnd(id2);

      const results = await Promise.all([p1, p2, p3]);

      const statuses = results.map((r) => r.status);
      expect(statuses.every((s) => s === "completed")).toBe(true);

      const finals = results.map((r) => r.finalText);
      expect(finals).toContain("first finishes second");
      expect(finals).toContain("second finishes last");
      expect(finals).toContain("third finishes first");
    });
  });

  describe("Frontend store can consume full event stream", () => {
    const parentPath = "/sessions/parent-session.jsonl";

    it("should build complete subagent lifecycle in store from event sequence", () => {
      const subId = "store-test-sub-001";

      feedEventToStore(
        mockStore,
        subId,
        { type: "subagent_start", description: "Fix login bug", instruction: "Fix null check" },
        parentPath,
      );

      expect(mockStore.state.subagentStatusMap[subId]).toBe("streaming");

      const subs = mockStore.state.subsessionsByParent[parentPath];
      expect(subs).toBeDefined();
      expect(subs!.length).toBe(1);
      expect(subs![0].sessionId).toBe(subId);
      expect(subs![0].description).toBe("Fix login bug");
      expect(subs![0].instruction).toBe("Fix null check");
      expect(subs![0].startedAt).toBeDefined();
    });

    it("should accumulate messages through start→update→end cycle", () => {
      const subId = "store-test-sub-002";

      feedEventToStore(
        mockStore,
        subId,
        { type: "message_start", message: { role: "assistant", content: [] } },
        parentPath,
      );
      expect(mockStore.state.messagesBySubsession[subId]).toHaveLength(1);
      expect(mockStore.state.messagesBySubsession[subId][0].isStreaming).toBe(true);

      feedEventToStore(
        mockStore,
        subId,
        {
          type: "message_update",
          message: { role: "assistant", content: [{ type: "text", text: "Hello " }] },
        },
        parentPath,
      );

      feedEventToStore(
        mockStore,
        subId,
        {
          type: "message_update",
          message: { role: "assistant", content: [{ type: "text", text: "World" }] },
        },
        parentPath,
      );

      const msg = mockStore.state.messagesBySubsession[subId][0];
      const textBlock = msg.content.find((b) => b.type === "text");
      expect(textBlock?.text).toBe("Hello World");

      feedEventToStore(
        mockStore,
        subId,
        {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Hello World" }],
            stopReason: "end_turn",
          },
        },
        parentPath,
      );

      const finalMsg = mockStore.state.messagesBySubsession[subId][0];
      expect(finalMsg.isStreaming).toBe(false);
      expect(finalMsg.stopReason).toBe("end_turn");
    });

    it("should track tool execution through start→end", () => {
      const subId = "store-test-sub-003";

      feedEventToStore(
        mockStore,
        subId,
        { type: "message_start", message: { role: "assistant", content: [] } },
        parentPath,
      );

      feedEventToStore(
        mockStore,
        subId,
        {
          type: "tool_execution_start",
          toolCallId: "call_1",
          toolName: "Bash",
        },
        parentPath,
      );

      let msg = mockStore.state.messagesBySubsession[subId][0];
      const toolBlock = msg.content.find(
        (b): b is Record<string, unknown> & { type: string } => b.type === "toolExecution",
      );
      expect(toolBlock).toBeDefined();
      expect(toolBlock!.status).toBe("running");
      expect(toolBlock!.toolName).toBe("Bash");

      feedEventToStore(
        mockStore,
        subId,
        {
          type: "tool_execution_end",
          toolCallId: "call_1",
          result: { content: [{ text: "file created" }] },
          isError: false,
        },
        parentPath,
      );

      msg = mockStore.state.messagesBySubsession[subId][0];
      const doneTool = msg.content.find(
        (b): b is Record<string, unknown> & { type: string; status: string } =>
          b.type === "toolExecution",
      )!;
      expect(doneTool.status).toBe("done");
    });

    it("should transition status to idle on agent_end and record completion", () => {
      const subId = "store-test-sub-004";

      feedEventToStore(
        mockStore,
        subId,
        { type: "subagent_start", description: "Test task", instruction: "do work" },
        parentPath,
      );
      feedEventToStore(
        mockStore,
        subId,
        { type: "message_start", message: { role: "assistant", content: [] } },
        parentPath,
      );
      feedEventToStore(
        mockStore,
        subId,
        {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "All done!" }] },
        },
        parentPath,
      );

      expect(mockStore.state.subagentStatusMap[subId]).toBe("streaming");

      feedEventToStore(mockStore, subId, { type: "agent_end" }, parentPath);

      expect(mockStore.state.subagentStatusMap[subId]).toBe("idle");

      const subs = mockStore.state.subsessionsByParent[parentPath];
      const sub = subs!.find((s) => s.sessionId === subId);
      expect(sub!.completedAt).toBeDefined();
      expect(sub!.exitCode).toBe(0);
      expect(sub!.finalText).toBe("All done!");
    });

    it("should handle complete end-to-end event sequence correctly", () => {
      const subId = "e2e-full-cycle";
      const events: Array<{ subId: string; event: Record<string, unknown>; parentPath?: string }> =
        [
          {
            subId,
            event: {
              type: "subagent_start",
              description: "E2E Task",
              instruction: "full flow test",
            },
            parentPath,
          },
          { subId, event: { type: "agent_start" } },
          { subId, event: { type: "message_start", message: { role: "assistant", content: [] } } },
          {
            subId,
            event: {
              type: "message_update",
              message: { role: "assistant", content: [{ type: "text", text: "Working" }] },
            },
          },
          {
            subId,
            event: { type: "tool_execution_start", toolCallId: "tc_e2e_1", toolName: "Read" },
          },
          {
            subId,
            event: {
              type: "tool_execution_end",
              toolCallId: "tc_e2e_1",
              result: { content: [{ text: "ok" }] },
              isError: false,
            },
          },
          {
            subId,
            event: {
              type: "message_update",
              message: { role: "assistant", content: [{ type: "text", text: " on it..." }] },
            },
          },
          {
            subId,
            event: {
              type: "message_end",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "Working on it..." }],
                stopReason: "end_turn",
              },
            },
          },
          { subId, event: { type: "agent_end" } },
        ];

      for (const { subId: sid, event, parentPath: pp } of events) {
        feedEventToStore(mockStore, sid, event, pp);
      }

      const subs = mockStore.state.subsessionsByParent[parentPath];
      expect(subs).toHaveLength(1);
      const entry = subs![0];
      expect(entry.sessionId).toBe(subId);
      expect(entry.description).toBe("E2E Task");
      expect(entry.instruction).toBe("full flow test");
      expect(entry.completedAt).toBeDefined();
      expect(entry.exitCode).toBe(0);
      expect(entry.finalText).toBe("Working on it...");

      expect(mockStore.state.subagentStatusMap[subId]).toBe("idle");

      const msgs = mockStore.state.messagesBySubsession[subId];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].isStreaming).toBe(false);

      const content = msgs[0].content as Array<Record<string, unknown>>;
      const textBlocks = content.filter((b) => b.type === "text");
      expect(textBlocks.length).toBeGreaterThanOrEqual(1);
      const allText = textBlocks.map((b) => b.text).join("");
      expect(allText).toContain("Working on it...");

      const toolBlocks = content.filter((b) => b.type === "toolExecution");
      expect(toolBlocks.length).toBe(1);
      expect(toolBlocks[0].status).toBe("done");
    });

    it("should isolate state between different subsessions under same parent", () => {
      const subA = "isolated-sub-A";
      const subB = "isolated-sub-B";

      feedEventToStore(
        mockStore,
        subA,
        { type: "subagent_start", description: "Task A", instruction: "work A" },
        parentPath,
      );
      feedEventToStore(
        mockStore,
        subB,
        { type: "subagent_start", description: "Task B", instruction: "work B" },
        parentPath,
      );

      feedEventToStore(
        mockStore,
        subA,
        { type: "message_start", message: { role: "assistant", content: [] } },
        parentPath,
      );
      feedEventToStore(
        mockStore,
        subB,
        { type: "message_start", message: { role: "assistant", content: [] } },
        parentPath,
      );

      feedEventToStore(
        mockStore,
        subA,
        {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "Result A" }] },
        },
        parentPath,
      );
      feedEventToStore(
        mockStore,
        subB,
        {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "Result B" }] },
        },
        parentPath,
      );

      feedEventToStore(mockStore, subA, { type: "agent_end" }, parentPath);
      feedEventToStore(mockStore, subB, { type: "agent_end" }, parentPath);

      const subs = mockStore.state.subsessionsByParent[parentPath];
      expect(subs).toHaveLength(2);

      const entryA = subs!.find((s) => s.sessionId === subA);
      const entryB = subs!.find((s) => s.sessionId === subB);
      expect(entryA!.finalText).toBe("Result A");
      expect(entryB!.finalText).toBe("Result B");

      const msgsA = mockStore.state.messagesBySubsession[subA];
      const msgsB = mockStore.state.messagesBySubsession[subB];
      expect(msgsA).toHaveLength(1);
      expect(msgsB).toHaveLength(1);
    });
  });

  describe("Integration: harness + store wired together", () => {
    it("should produce correct store state after full harness lifecycle", async () => {
      const parentSessionId = "int-parent";
      const parentPath = `/fake/sessions/${parentSessionId}.jsonl`;

      const delegateResult = harness.startDelegateSync(parentSessionId, {
        task: "Implement OAuth2 flow",
        title: "OAuth2 Implementation",
        agent: "backend-dev",
      });
      const { sessionId: childId } = delegateResult;

      harness.simulateAgentStart(childId, parentSessionId);
      harness.simulateMessageStart(childId, parentSessionId, "msg-oauth-1");
      harness.simulateMessageUpdate(childId, parentSessionId, "Starting OAuth2... ");
      harness.simulateToolExecutionStart(childId, parentSessionId, "tc-read", "Read");
      harness.simulateMessageUpdate(childId, parentSessionId, "Reading config files\n");
      harness.simulateMessageEnd(childId, "OAuth2 implementation complete. All tests passing.");

      harness.simulateAgentEnd(childId);
      const result = await delegateResult.resultPromise;

      expect(result.status).toBe("completed");
      expect(result.sessionId).toBe(childId);
      expect(result.exitCode).toBe(0);
      expect(result.finalText).toBe("OAuth2 implementation complete. All tests passing.");

      const allBroadcasts = mockDeps._mocks.broadcastEvent.mock.calls;
      const subagentEvents = allBroadcasts
        .filter((c) => c[0] === "subagent.event")
        .map((c) => c[1] as Record<string, unknown>);

      for (const payload of subagentEvents) {
        const evt = payload.event as Record<string, unknown>;
        feedEventToStore(
          mockStore,
          payload.subSessionId as string,
          evt,
          payload.parentSessionPath as string,
        );
      }

      feedEventToStore(mockStore, childId, { type: "agent_end" }, parentPath);

      const subs = mockStore.state.subsessionsByParent[parentPath];
      expect(subs).toBeDefined();
      expect(subs!.length).toBeGreaterThanOrEqual(1);
      const subEntry = subs!.find((s) => s.sessionId === childId);
      expect(subEntry).toBeDefined();
      expect(subEntry!.description).toBe("OAuth2 Implementation");

      expect(mockStore.state.subagentStatusMap[childId]).toBe("idle");

      const msgs = mockStore.state.messagesBySubsession[childId];
      expect(msgs).toBeDefined();
      expect(msgs!.length).toBeGreaterThanOrEqual(1);
    });

    it("should maintain store consistency when delegate errors mid-stream", async () => {
      const parentSessionId = "err-parent";

      const { sessionId: childId, resultPromise } = harness.startDelegateSync(parentSessionId, {
        task: "will fail halfway",
        title: "Failing Task",
      });

      harness.simulateAgentStart(childId, parentSessionId);
      harness.simulateMessageStart(childId, parentSessionId);
      harness.simulateMessageUpdate(childId, parentSessionId, "Partial output...");

      harness.simulateCrash(childId, "Child process OOM");
      const result = await resultPromise;

      expect(result.status).toBe("error");

      const allBroadcasts = mockDeps._mocks.broadcastEvent.mock.calls;
      const subagentEvents = allBroadcasts
        .filter((c) => c[0] === "subagent.event")
        .map((c) => c[1] as Record<string, unknown>);

      for (const payload of subagentEvents) {
        const evt = payload.event as Record<string, unknown>;
        feedEventToStore(
          mockStore,
          payload.subSessionId as string,
          evt,
          payload.parentSessionPath as string,
        );
      }

      expect(mockStore.state.subagentStatusMap[childId]).toBe("streaming");
    });
  });
});

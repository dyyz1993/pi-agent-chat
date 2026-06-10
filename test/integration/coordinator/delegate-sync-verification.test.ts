import { describe, it, expect, vi } from "vitest";

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

class SyncDelegateTestHarness {
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

    this.subagentSyncChildren.add(newSessionId);

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

  simulateAgentEnd(sessionId: string, finalText?: string): void {
    if (finalText) {
      this.syncDelegateLastText.set(sessionId, finalText);
    }
    const resolver = this.syncDelegateResolvers.get(sessionId);
    if (resolver) {
      clearTimeout(resolver.timeout);
      this.syncDelegateResolvers.delete(sessionId);
      this.subagentSyncChildren.delete(sessionId);
      const text = this.syncDelegateLastText.get(sessionId) ?? "(completed)";
      this.syncDelegateLastText.delete(sessionId);
      resolver.resolve({
        sessionId,
        status: "completed",
        exitCode: 0,
        finalText: text || "(completed)",
      });
    }
  }

  simulateMessageEnd(sessionId: string, textContent: string): void {
    if (this.subagentSyncChildren.has(sessionId)) {
      this.syncDelegateLastText.set(sessionId, textContent.slice(0, 2000));
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
      syncResolver.resolve({
        sessionId,
        status: "aborted",
        exitCode: 1,
        finalText: "(stopped)",
      });
    }
  }

  simulateSubagentEvent(
    sessionId: string,
    parentId: string,
    eventType: Record<string, unknown>,
  ): void {
    if (this.subagentSyncChildren.has(sessionId)) {
      this.deps.broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: `/fake/sessions/${parentId}.jsonl`,
        subSessionId: sessionId,
        event: eventType,
      });
    }
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

describe("session_delegate_sync — Full Flow Verification", () => {
  describe("Suite 1: Sync Resolver Lifecycle", () => {
    it("1. Register → Wait → Resolve: promise pends then resolves on agent_end", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
        task: "fix the login bug",
        title: "Fix Login Bug",
      });

      expect(harness.syncDelegateResolvers.size).toBe(1);
      expect(harness.syncDelegateResolvers.has(childId)).toBe(true);

      harness.simulateAgentEnd(childId, "Bug fixed: null check added");

      const result = await resultPromise;
      expect(result).toEqual({
        sessionId: childId,
        status: "completed",
        exitCode: 0,
        finalText: "Bug fixed: null check added",
      });
    });

    it("2. Timeout: resolves with status=timeout after timeoutMs", async () => {
      vi.useFakeTimers();
      try {
        const deps = createMockDeps();
        const harness = new SyncDelegateTestHarness(deps);

        const TIMEOUT_MS = 5000;
        const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
          task: "long running task",
          timeoutMs: TIMEOUT_MS,
        });

        vi.advanceTimersByTime(TIMEOUT_MS);
        const result = await resultPromise;

        expect(result.status).toBe("timeout");
        expect(result.exitCode).toBe(1);
        expect(result.finalText).toBe("(timed out)");
        expect(result.sessionId).toBe(childId);
        expect(harness.syncDelegateResolvers.has(childId)).toBe(false);
        expect(harness.subagentSyncChildren.has(childId)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("3. Stop/Abort: resolves with status=aborted when session stopped", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
        task: "should be aborted",
      });

      harness.stopSession(childId);

      const result = await resultPromise;
      expect(result.status).toBe("aborted");
      expect(result.exitCode).toBe(1);
      expect(result.finalText).toBe("(stopped)");
      expect(deps._mocks.stop).toHaveBeenCalledWith(childId);
    });
  });

  describe("Suite 2: Event Routing", () => {
    it("4a. subagent_start emission after child creation", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
        task: "analyze performance",
        title: "Perf Analysis",
        agent: "code-reviewer",
      });

      harness.simulateAgentEnd(childId, "done");
      await resultPromise;

      expect(deps._mocks.broadcastEvent).toHaveBeenCalled();
      const call = deps._mocks.broadcastEvent.mock.calls.find((c) => c[0] === "subagent.event");
      expect(call).toBeDefined();
      const payload = call![1] as Record<string, unknown>;
      const event = payload.event as Record<string, unknown>;

      expect(payload.parentSessionId).toBe("parent-1");
      expect(payload.subSessionId).toMatch(/^sess_sub_/);
      expect(event.type).toBe("subagent_start");
      expect(event.description).toBe("Perf Analysis");
      expect(event.instruction).toBe("analyze performance");
      expect(event.toolCallId).toBe("");
    });

    it("4b. child events routed as subagent.event for sync children", () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const childId = "sync-child-001";
      harness.subagentSyncChildren.add(childId);

      harness.simulateSubagentEvent(childId, "parent-1", {
        type: "message_start",
        message: { role: "assistant" },
      });

      expect(deps._mocks.broadcastEvent).toHaveBeenCalledWith(
        "subagent.event",
        expect.objectContaining({
          parentSessionId: "parent-1",
          subSessionId: childId,
          event: { type: "message_start", message: { role: "assistant" } },
        }),
      );
    });

    it("4c. non-sync-child events NOT routed as subagent.event", () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      harness.simulateSubagentEvent("normal-child-001", "parent-1", {
        type: "tool_execution_start",
        toolName: "bash",
      });

      const subagentCalls = deps._mocks.broadcastEvent.mock.calls.filter(
        (c) => c[0] === "subagent.event",
      );
      expect(subagentCalls).toHaveLength(0);
    });

    it("4d. multiple event types all routed correctly", () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const childId = "sync-multi";
      harness.subagentSyncChildren.add(childId);

      const events = [
        { type: "message_start" },
        { type: "message_update" },
        { type: "tool_execution_start", toolName: "ReadTool" },
        { type: "agent_end" },
      ] as const;

      for (const evt of events) {
        harness.simulateSubagentEvent(
          childId,
          "parent-1",
          evt as unknown as Record<string, unknown>,
        );
      }

      const subagentCalls = deps._mocks.broadcastEvent.mock.calls.filter(
        (c) => c[0] === "subagent.event",
      );
      expect(subagentCalls).toHaveLength(events.length);
    });
  });

  describe("Suite 3: Parent-Child Relationship", () => {
    it("6. parentChildMap registration", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const { sessionId: childA, resultPromise: p1 } = harness.startDelegateSync("parent-A", {
        task: "task A",
      });
      const { sessionId: childB, resultPromise: p2 } = harness.startDelegateSync("parent-A", {
        task: "task B",
      });

      harness.simulateAgentEnd(childA);
      harness.simulateAgentEnd(childB);
      await Promise.all([p1, p2]);

      const children = harness.parentChildMap.get("parent-A");
      expect(children).toBeDefined();
      expect(children!.has(childA)).toBe(true);
      expect(children!.has(childB)).toBe(true);
      expect(children!.size).toBe(2);
    });

    it("7. delegateCreatedAt and delegateReplyCount metadata", () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const before = Date.now();
      const { sessionId: childId } = harness.startDelegateSync("parent-1", {
        task: "metadata test",
      });

      expect(harness.delegateCreatedAt.has(childId)).toBe(true);
      expect(harness.delegateCreatedAt.get(childId)!).toBeGreaterThanOrEqual(before);
      expect(harness.delegateReplyCount.get(childId)).toBe(0);

      harness.simulateAgentEnd(childId);
    });

    it("8. Cleanup on resolve: resolver removed from map", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
        task: "cleanup test",
      });

      expect(harness.syncDelegateResolvers.has(childId)).toBe(true);
      expect(harness.subagentSyncChildren.has(childId)).toBe(true);

      harness.simulateAgentEnd(childId, "all clean");
      await resultPromise;

      expect(harness.syncDelegateResolvers.has(childId)).toBe(false);
      expect(harness.subagentSyncChildren.has(childId)).toBe(false);
      expect(harness.syncDelegateLastText.has(childId)).toBe(false);
    });

    it("8b. Cleanup on timeout: all maps cleaned", async () => {
      vi.useFakeTimers();
      try {
        const deps = createMockDeps();
        const harness = new SyncDelegateTestHarness(deps);

        const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
          task: "timeout cleanup",
          timeoutMs: 1000,
        });

        vi.advanceTimersByTime(1000);
        await resultPromise;

        expect(harness.syncDelegateResolvers.has(childId)).toBe(false);
        expect(harness.subagentSyncChildren.has(childId)).toBe(false);
        expect(harness.syncDelegateLastText.has(childId)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("8c. Cleanup on abort: all maps cleaned", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
        task: "abort cleanup",
      });

      harness.stopSession(childId);
      await resultPromise;

      expect(harness.syncDelegateResolvers.has(childId)).toBe(false);
      expect(harness.subagentSyncChildren.has(childId)).toBe(false);
      expect(harness.syncDelegateLastText.has(childId)).toBe(false);
      expect(harness.delegateCreatedAt.has(childId)).toBe(false);
      expect(harness.delegateReplyCount.has(childId)).toBe(false);
    });
  });

  describe("Suite 4: Integration with handleCoordinatorCall", () => {
    it("9. Switch case routing + response via coordinator channel", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const responses: Array<Record<string, unknown>> = [];
      const mockSend = vi.fn((p: Record<string, unknown>) => responses.push(p));

      function fireCoordinatorCall(
        _sessionId: string,
        msg: { __call: string; invokeId?: string; task?: string; title?: string },
      ): void {
        const { __call: method, invokeId } = msg;
        if (method !== "session_delegate_sync") return;

        const { resultPromise } = harness.startDelegateSync(
          "parent-1",
          msg as { task: string; title?: string },
        );

        Promise.resolve(resultPromise).then((resolvedResult) => {
          if (invokeId) {
            mockSend({ ...(resolvedResult as object), invokeId });
          }
        });
      }

      fireCoordinatorCall("parent-1", {
        __call: "session_delegate_sync",
        invokeId: "inv-123",
        task: "routing test",
        title: "Routing Test",
      });

      const childId = [...harness.syncDelegateResolvers.keys()][0];
      harness.simulateAgentEnd(childId, "routed OK");

      await new Promise((r) => setTimeout(r, 20));

      expect(responses).toHaveLength(1);
      expect(responses[0]).toEqual(
        expect.objectContaining({
          invokeId: "inv-123",
          status: "completed",
          finalText: "routed OK",
        }),
      );
    });

    it("10. Response sent back via coordinator channel with invokeId", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const responses: Array<Record<string, unknown>> = [];
      const mockCoordinatorSend = vi.fn((payload: Record<string, unknown>) => {
        responses.push(payload);
      });

      function fireCoordinatorFlow(
        _parentSessionId: string,
        msg: {
          __call: string;
          invokeId: string;
          task: string;
          title?: string;
          agent?: string;
          timeoutMs?: number;
        },
      ): void {
        const { __call: method, invokeId } = msg;
        if (method !== "session_delegate_sync") return;

        const { resultPromise } = harness.startDelegateSync(
          "sess-parent",
          msg as {
            task: string;
            title?: string;
            agent?: string;
            timeoutMs?: number;
          },
        );

        Promise.resolve(resultPromise).then((resolvedResult) => {
          if (invokeId) {
            mockCoordinatorSend({ ...(resolvedResult as object), invokeId });
          }
        });
      }

      fireCoordinatorFlow("sess-parent", {
        __call: "session_delegate_sync",
        invokeId: "inv-abc-999",
        task: "write tests for auth module",
        title: "Auth Module Tests",
        agent: "test-writer",
        timeoutMs: 60000,
      });

      const childId = [...harness.syncDelegateResolvers.keys()][0];
      harness.simulateAgentEnd(childId, "12 tests written, all passing");

      await new Promise((r) => setTimeout(r, 20));

      expect(responses).toHaveLength(1);
      const response = responses[0];
      expect(response.invokeId).toBe("inv-abc-999");
      expect(response.status).toBe("completed");
      expect(response.exitCode).toBe(0);
      expect(response.finalText).toBe("12 tests written, all passing");
      expect(response.sessionId).toBe(childId);
    });

    it("10b. Error response sent back on failure", async () => {
      const deps = createMockDeps();
      deps.start.mockRejectedValueOnce(new Error("Process start failed"));
      const harness = new SyncDelegateTestHarness(deps);

      const responses: Array<Record<string, unknown>> = [];
      const mockCoordinatorSend = vi.fn((payload: Record<string, unknown>) => {
        responses.push(payload);
      });

      const { resultPromise } = harness.startDelegateSync("parent-1", { task: "will fail" });

      await expect(resultPromise).rejects.toThrow("Process start failed");

      mockCoordinatorSend({ error: "Process start failed", invokeId: "inv-err-1" });

      expect(responses).toHaveLength(1);
      expect(responses[0]).toEqual({
        error: "Process start failed",
        invokeId: "inv-err-1",
      });
    });
  });

  describe("Edge Cases", () => {
    it("uses task slice as title when no title provided", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const longTask =
        "This is a very long task description that exceeds sixty characters for sure";
      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
        task: longTask,
      });

      harness.simulateAgentEnd(childId);
      await resultPromise;

      const nameCall = deps._mocks.setSessionName.mock.calls[0];
      expect(nameCall[1]).toContain(longTask.slice(0, 60));
    });

    it("includes agent role in prompt when provided", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
        task: "review code",
        agent: "senior-dev",
      });

      harness.simulateAgentEnd(childId);
      await resultPromise;

      const sendCall = deps._mocks.send.mock.calls[0] as [string, string];
      expect(sendCall[1]).toContain("**Agent 角色:** senior-dev");
    });

    it("omits agent line from prompt when agent not provided", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
        task: "simple task",
      });

      harness.simulateAgentEnd(childId);
      await resultPromise;

      const sendCall = deps._mocks.send.mock.calls[0] as [string, string];
      expect(sendCall[1]).not.toContain("**Agent 角色:**");
    });

    it("message_end populates syncDelegateLastText for final output", () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const childId = "msg-end-test";
      harness.subagentSyncChildren.add(childId);

      harness.simulateMessageEnd(childId, "Here is my analysis of the problem...");

      expect(harness.syncDelegateLastText.get(childId)).toBe(
        "Here is my analysis of the problem...",
      );
    });

    it("message_end truncates text to 2000 chars", () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const childId = "truncate-test";
      harness.subagentSyncChildren.add(childId);

      const longText = "x".repeat(5000);
      harness.simulateMessageEnd(childId, longText);

      expect(harness.syncDelegateLastText.get(childId)!.length).toBe(2000);
    });

    it("agent_end without prior message_end uses fallback text", async () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      const { sessionId: childId, resultPromise } = harness.startDelegateSync("parent-1", {
        task: "no message_end",
      });

      harness.simulateAgentEnd(childId);
      const result = await resultPromise;

      expect(result.finalText).toBe("(completed)");
    });

    it("multiple delegates under same/different parents are independent", async () => {
      vi.useFakeTimers();
      try {
        const deps = createMockDeps();
        const harness = new SyncDelegateTestHarness(deps);

        const { sessionId: id1, resultPromise: p1 } = harness.startDelegateSync("parent-1", {
          task: "alpha",
        });
        const { sessionId: id2, resultPromise: p2 } = harness.startDelegateSync("parent-1", {
          task: "beta",
        });
        harness.startDelegateSync("parent-2", { task: "gamma" });

        expect(harness.syncDelegateResolvers.size).toBe(3);

        harness.simulateAgentEnd(id1, "alpha done");
        harness.stopSession(id2);

        vi.advanceTimersByTime(300001);

        const [r1, r2] = await Promise.allSettled([p1, p2]);

        expect(r1.status).toBe("fulfilled");
        if (r1.status === "fulfilled") expect(r1.value.status).toBe("completed");

        expect(r2.status).toBe("fulfilled");
        if (r2.status === "fulfilled") expect(r2.value.status).toBe("aborted");
        // p3 is fire-and-forget (no await) — it should timeout
      } finally {
        vi.useRealTimers();
      }
    });

    it("stop on non-delegate session is safe no-op", () => {
      const deps = createMockDeps();
      const harness = new SyncDelegateTestHarness(deps);

      expect(() => harness.stopSession("nonexistent")).not.toThrow();
      expect(deps._mocks.stop).toHaveBeenCalledWith("nonexistent");
    });
  });
});

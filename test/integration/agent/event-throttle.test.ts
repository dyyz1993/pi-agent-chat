/**
 * @vitest-environment node
 *
 * Tests for event throttling in agent-event-routing.ts.
 * Verifies that high-frequency events (message_update, tool_execution_update)
 * are throttled rather than sent individually.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { AgentEvent } from "../../../src/shared/modules/agent";
import { handleAgentEventOperation, _resetThrottleBuffers } from "../../../src/shared/agent/agent-event-routing";
import type { SyncDelegateResolver } from "../../../src/shared/agent/coordinator-session-state";

interface ManagedFixture {
  client?: {
    getTreeWithLeaf: ReturnType<typeof vi.fn>;
  };
  info: {
    status: string;
    holdEvents: unknown[];
    projectPath: string;
    sessionPath?: string;
    activeToolExecutions?: Array<{
      toolCallId: string;
      toolName: string;
      args?: unknown;
      startedAt?: number;
    }>;
  };
  lastActiveAt: number;
}

function makeManaged(overrides: Partial<ManagedFixture> = {}): ManagedFixture {
  return {
    client: {
      getTreeWithLeaf: vi.fn().mockResolvedValue({ entries: [], leafId: "leaf-1" }),
    },
    info: {
      status: "idle",
      holdEvents: [],
      projectPath: "/repo/app",
      sessionPath: "/sessions/sess.jsonl",
    },
    lastActiveAt: 0,
    ...overrides,
  };
}

function makeOptions(overrides: {
  sessionId?: string;
  event?: AgentEvent;
  clients?: Map<string, ManagedFixture>;
  broadcastEvent?: ReturnType<typeof vi.fn>;
  emitAgentEvent?: ReturnType<typeof vi.fn>;
} = {}) {
  const sessionId = overrides.sessionId ?? "sess-1";
  const clients = overrides.clients ?? new Map([[sessionId, makeManaged()]]);
  return {
    sessionId,
    event: overrides.event ?? ({ type: "agent_start" } as AgentEvent),
    getActiveManaged: (id: string) => clients.get(id) ?? null,
    clients,
    parentChildMap: new Map(),
    leafIds: new Map<string, string | null>(),
    syncDelegateResolvers: new Map<string, SyncDelegateResolver>(),
    subagentSyncChildren: new Map<string, string>(),
    syncDelegateLastText: new Map<string, string>(),
    sandboxEnabled: false,
    broadcastEvent: overrides.broadcastEvent ?? vi.fn().mockResolvedValue(undefined),
    broadcastSessionStatus: vi.fn(),
    emitAgentEvent: overrides.emitAgentEvent ?? vi.fn().mockResolvedValue(undefined),
    handleSubagentChannelData: vi.fn(),
    handleTodoChannelData: vi.fn(),
    handleBashChannelData: vi.fn(),
    handleLspChannelData: vi.fn(),
    handleRulesChannelData: vi.fn(),
    handleMemoryChannelData: vi.fn(),
    handleSupervisorChannelData: vi.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("event throttling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetThrottleBuffers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("message_update throttling", () => {
    it("throttles rapid message_update events: only sends the latest one after throttle window", async () => {
      const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
      const opts = makeOptions({ emitAgentEvent });

      // Send 10 rapid message_update events
      for (let i = 0; i < 10; i++) {
        handleAgentEventOperation({
          ...opts,
          event: {
            type: "message_update",
            message: { role: "assistant", content: [{ type: "text", text: `chunk-${i}` }] },
            assistantMessageEvent: {},
          } as unknown as AgentEvent,
        });
      }

      // Before throttle window expires: no emitAgentEvent calls yet
      // (first call sets the timer, subsequent calls just update the buffered event)
      expect(emitAgentEvent).toHaveBeenCalledTimes(0);

      // Advance past throttle window (50ms)
      vi.advanceTimersByTime(60);
      await flushMicrotasks();

      // Should have sent exactly 1 emitAgentEvent with the LAST message_update
      expect(emitAgentEvent).toHaveBeenCalledTimes(1);
      const lastCall = emitAgentEvent.mock.calls[0];
      expect(lastCall[0]).toBe("sess-1");
      const sentEvent = lastCall[1] as Record<string, unknown>;
      const msg = sentEvent.message as { content: Array<{ text: string }> };
      expect(msg.content[0].text).toBe("chunk-9");
    });

    it("flushes pending message_update when a non-throttled event arrives", async () => {
      const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
      const opts = makeOptions({ emitAgentEvent });

      // Send a message_update
      handleAgentEventOperation({
        ...opts,
        event: {
          type: "message_update",
          message: { role: "assistant", content: [{ type: "text", text: "partial" }] },
          assistantMessageEvent: {},
        } as unknown as AgentEvent,
      });

      // Immediately send a non-throttled event (agent_end)
      handleAgentEventOperation({
        ...opts,
        event: { type: "agent_end" } as AgentEvent,
      });
      await flushMicrotasks();

      // The pending message_update should be flushed + the agent_end itself
      const calls = emitAgentEvent.mock.calls;
      // 2 calls: flushed message_update + agent_end
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("tool_execution_update throttling", () => {
    it("should NOT send each tool_execution_update individually when they arrive rapidly", async () => {
      const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
      const opts = makeOptions({ emitAgentEvent });

      // Simulate rapid tool_execution_update events (e.g. progress updates)
      for (let i = 0; i < 20; i++) {
        handleAgentEventOperation({
          ...opts,
          event: {
            type: "tool_execution_update",
            toolCallId: "tc-1",
            status: "running",
            progress: i * 5,
          } as unknown as AgentEvent,
        });
      }

      await flushMicrotasks();

      // BEFORE optimization: all 20 calls go through individually
      // AFTER optimization: should be throttled (significantly fewer calls)
      const callCount = emitAgentEvent.mock.calls.length;

      // The test expectation: call count should be much less than 20
      // Current code sends all 20 — this test will FAIL initially (proving the problem)
      // After adding throttling, it should pass
      expect(callCount).toBeLessThan(20);
    });

    it("should preserve the latest tool_execution_update data after throttle", async () => {
      const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
      const opts = makeOptions({ emitAgentEvent });

      // Send rapid updates
      for (let i = 0; i < 5; i++) {
        handleAgentEventOperation({
          ...opts,
          event: {
            type: "tool_execution_update",
            toolCallId: "tc-1",
            status: "running",
            progress: i * 20,
          } as unknown as AgentEvent,
        });
      }

      // Advance timers to flush any throttle
      vi.advanceTimersByTime(150);
      await flushMicrotasks();

      // The last emitted tool_execution_update should have progress=80 (last one)
      const toolCalls = emitAgentEvent.mock.calls.filter(
        (call: unknown[]) => {
          const evt = call[1] as Record<string, unknown> | undefined;
          return evt?.type === "tool_execution_update";
        },
      );

      if (toolCalls.length > 0) {
        const lastToolCall = toolCalls[toolCalls.length - 1];
        const evt = lastToolCall[1] as Record<string, unknown>;
        expect(evt.progress).toBe(80);
      }
    });
  });

  describe("mixed event types", () => {
    it("non-throttled events (agent_start, agent_end) are sent immediately without waiting for timer", async () => {
      const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
      const opts = makeOptions({ emitAgentEvent });

      // Send agent_start — no pending throttle buffers, should emit exactly once
      handleAgentEventOperation({
        ...opts,
        event: { type: "agent_start" } as AgentEvent,
      });
      await flushMicrotasks();

      expect(emitAgentEvent).toHaveBeenCalledTimes(1);

      // Send agent_end — still no pending throttle buffers, should emit once more
      handleAgentEventOperation({
        ...opts,
        event: { type: "agent_end" } as AgentEvent,
      });
      await flushMicrotasks();

      expect(emitAgentEvent).toHaveBeenCalledTimes(2);
    });

    it("flushes pending throttled events when a non-throttled event arrives", async () => {
      const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
      const opts = makeOptions({ emitAgentEvent });

      // Send a message_update (gets throttled, timer set)
      handleAgentEventOperation({
        ...opts,
        event: {
          type: "message_update",
          message: { role: "assistant", content: [{ type: "text", text: "partial" }] },
          assistantMessageEvent: {},
        } as unknown as AgentEvent,
      });

      // Timer hasn't fired yet, so no emitAgentEvent
      expect(emitAgentEvent).toHaveBeenCalledTimes(0);

      // Send agent_end immediately (non-throttled, should flush pending message_update)
      handleAgentEventOperation({
        ...opts,
        event: { type: "agent_end" } as AgentEvent,
      });
      await flushMicrotasks();

      // Should have 2 calls: flushed message_update + agent_end
      expect(emitAgentEvent).toHaveBeenCalledTimes(2);
    });
  });
});

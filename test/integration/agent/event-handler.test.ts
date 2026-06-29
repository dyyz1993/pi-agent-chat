/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { AgentEventHandler, type ManagedClient } from "../../../src/shared/agent/event-handler";
import type { AgentEvent } from "../../../src/shared/modules/agent";

function makeManaged(): ManagedClient {
  return {
    client: {
      getTreeWithLeaf: vi.fn().mockResolvedValue({ entries: [], leafId: "leaf-1" }),
    },
    info: {
      status: "idle",
      projectPath: "/repo/app",
      sessionPath: "/sessions/sess.jsonl",
    },
    unsubscribe: vi.fn(),
    _activeSessionId: "sess-1",
    lastActiveAt: 0,
    activeBackgroundTools: new Set(),
  };
}

describe("AgentEventHandler", () => {
  it("forwards askUserQuestion extension UI requests to frontend subscribers", async () => {
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
    const handler = new AgentEventHandler({
      broadcastEvent: vi.fn().mockResolvedValue(undefined),
      broadcastSessionStatus: vi.fn(),
      emitAgentEvent,
      getActiveManaged: () => makeManaged(),
      findParentSession: () => undefined,
      clients: new Map(),
      lastLspState: new Map(),
      leafIds: new Map(),
      syncDelegateResolvers: new Map(),
      syncDelegateLastText: new Map(),
      subagentSyncChildren: new Set(),
      parentChildMap: new Map(),
      delegateReplyCount: new Map(),
      delegateCreatedAt: new Map(),
      delegateRepliedSessions: new Set(),
      sendDelegateFallbackReply: vi.fn().mockResolvedValue(false),
    });
    const event = {
      type: "extension_ui_request",
      id: "ask-1",
      method: "askUserQuestion",
      title: "Pick one",
      questions: [{ id: "choice", question: "Which option?", options: [{ label: "A" }] }],
    } as unknown as AgentEvent;

    handler.handleEvent("sess-1", event);
    await Promise.resolve();

    expect(emitAgentEvent).toHaveBeenCalledWith("sess-1", event);
  });

  it("resolves sync delegates with error status when agent_end carries a crash reason", async () => {
    const resolved: unknown[] = [];
    const timeout = setTimeout(() => undefined, 10_000);
    const handler = new AgentEventHandler({
      broadcastEvent: vi.fn().mockResolvedValue(undefined),
      broadcastSessionStatus: vi.fn(),
      emitAgentEvent: vi.fn().mockResolvedValue(undefined),
      getActiveManaged: () => makeManaged(),
      findParentSession: () => undefined,
      clients: new Map(),
      lastLspState: new Map(),
      leafIds: new Map(),
      syncDelegateResolvers: new Map([
        [
          "sess-1",
          {
            resolve: (value) => resolved.push(value),
            timeout,
            parentSessionId: "parent-1",
          },
        ],
      ]),
      syncDelegateLastText: new Map([["sess-1", "partial answer"]]),
      subagentSyncChildren: new Set(["sess-1"]),
      parentChildMap: new Map(),
      delegateReplyCount: new Map(),
      delegateCreatedAt: new Map(),
      delegateRepliedSessions: new Set(),
      sendDelegateFallbackReply: vi.fn().mockResolvedValue(false),
    });

    handler.handleEvent("sess-1", {
      type: "agent_end",
      reason: "crashed",
    } as unknown as AgentEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(resolved).toEqual([
      {
        sessionId: "sess-1",
        status: "error",
        exitCode: 1,
        finalText: "partial answer",
        error: "crashed",
      },
    ]);
  });
});

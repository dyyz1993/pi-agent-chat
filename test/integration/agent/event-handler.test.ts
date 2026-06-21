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
});

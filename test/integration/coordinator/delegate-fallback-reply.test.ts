/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { CoordinatorHandler, type CoordinatorHandlerDeps } from "../../../src/shared/agent/coordinator-handler";

function makeManaged(status = "idle", sessionPath = "/tmp/session.jsonl") {
  return {
    _activeSessionId: sessionPath,
    client: {
      channel: () => ({ send: vi.fn() }),
    },
    info: {
      status,
      projectPath: "/project",
      sessionPath,
      sessionName: sessionPath.split("/").pop()?.replace(".jsonl", ""),
    },
  };
}

function makeHandler() {
  const clients = new Map([
    ["parent", makeManaged("idle", "/tmp/parent.jsonl")],
    ["child", makeManaged("idle", "/tmp/child.jsonl")],
  ]);
  const deps: CoordinatorHandlerDeps = {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(),
    steer: vi.fn(),
    followUp: vi.fn(),
    broadcastEvent: vi.fn().mockResolvedValue(undefined),
    setSessionName: vi.fn(),
    switchAgent: vi.fn(),
    getState: vi.fn(),
    getStatus: vi.fn(),
    getContextUsage: vi.fn(),
    getActiveManaged: (sessionId) => clients.get(sessionId),
    sessionPaths: new Map(),
    sessionProjectPaths: new Map(),
    clients,
    processByCwd: new Map(),
    isStartInProgress: () => false,
    queueDelegateRequest: vi.fn(),
  };
  const handler = new CoordinatorHandler(deps);
  handler.parentChildMap.set("parent", new Set(["child"]));
  handler.delegateCreatedAt.set("child", 1000);
  return { handler, deps };
}

describe("coordinator delegate fallback reply", () => {
  it("sends one fallback delegate reply when an async child completed without replying", async () => {
    const { handler, deps } = makeHandler();

    await expect(handler.sendDelegateFallbackReply("child")).resolves.toBe(true);

    expect(deps.steer).toHaveBeenCalledWith(
      "parent",
      expect.stringContaining('<delegate-reply from="child" sessionId="child" targetSessionId="parent"'),
    );
    expect(deps.steer).toHaveBeenCalledWith(
      "parent",
      expect.stringContaining("没有主动回传最终结果"),
    );
    expect(handler.delegateRepliedSessions.has("child")).toBe(true);
  });

  it("does not send fallback when the child already replied", async () => {
    const { handler, deps } = makeHandler();
    handler.delegateRepliedSessions.add("child");

    await expect(handler.sendDelegateFallbackReply("child")).resolves.toBe(false);

    expect(deps.steer).not.toHaveBeenCalled();
  });

  it("does not send fallback for sync subagent children", async () => {
    const { handler, deps } = makeHandler();
    handler.subagentSyncChildren.add("child");

    await expect(handler.sendDelegateFallbackReply("child")).resolves.toBe(false);

    expect(deps.steer).not.toHaveBeenCalled();
  });
});

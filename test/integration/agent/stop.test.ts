/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { stopAgentClientOperation } from "../../../src/shared/agent/agent-stop-operations";

interface TestManagedClient {
  client: {
    getTreeWithLeaf: () => Promise<{ leafId?: string | null }>;
    stop: () => Promise<unknown>;
  };
  info: {
    status: string;
    projectPath: string;
  };
  unsubscribe: () => void;
  _activeSessionId: string;
}

function makeManaged(options?: {
  status?: string;
  projectPath?: string;
  activeSessionId?: string;
  leafId?: string | null;
}): TestManagedClient {
  return {
    client: {
      getTreeWithLeaf: vi.fn().mockResolvedValue({ leafId: options?.leafId ?? "leaf-1" }),
      stop: vi.fn().mockResolvedValue(undefined),
    },
    info: {
      status: options?.status ?? "streaming",
      projectPath: options?.projectPath ?? "/project",
    },
    unsubscribe: vi.fn(),
    _activeSessionId: options?.activeSessionId ?? "sess-1",
  };
}

describe("stopAgentClientOperation", () => {
  it("returns false when the session is not active", async () => {
    await expect(
      stopAgentClientOperation({
        sessionId: "missing",
        getActiveManaged: () => null,
        clients: new Map(),
        parentChildMap: new Map(),
        delegateCreatedAt: new Map(),
        delegateReplyCount: new Map(),
        delegateReplyMetadata: new Map(),
        delegateRepliedSessions: new Set(),
        syncDelegateResolvers: new Map(),
        subagentSyncChildren: new Set(),
        syncDelegateLastText: new Map(),
        leafIds: new Map(),
        getPoolKey: (cwd) => cwd,
        removeFromPool: vi.fn(),
        stopChild: vi.fn(),
        emitAgentEvent: vi.fn(),
        deleteLspState: vi.fn(),
        clearSessionCache: vi.fn(),
      }),
    ).resolves.toBe(false);
  });

  it("stops the client, records leaf state, clears delegate tracking, and removes pool entries", async () => {
    const managed = makeManaged({ activeSessionId: "sandbox-user" });
    const clients = new Map([["sess-1", managed]]);
    const parentChildMap = new Map([["sess-1", new Set(["child-1"])]]);
    const delegateCreatedAt = new Map([["sess-1", 1000]]);
    const delegateReplyCount = new Map([["sess-1", 2]]);
    const timeout = setTimeout(() => undefined, 10_000);
    const syncResolve = vi.fn();
    const syncDelegateResolvers = new Map([
      [
        "sess-1",
        {
          resolve: syncResolve,
          timeout,
          parentSessionId: "parent",
        },
      ],
    ]);
    const subagentSyncChildren = new Set(["sess-1"]);
    const syncDelegateLastText = new Map([["sess-1", "partial"]]);
    const leafIds = new Map<string, string>();
    const removeFromPool = vi.fn();
    const stopChild = vi.fn().mockResolvedValue(true);
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
    const deleteLspState = vi.fn();
    const clearSessionCache = vi.fn();

    await expect(
      stopAgentClientOperation({
        sessionId: "sess-1",
        crashReason: "crashed",
        getActiveManaged: () => managed,
        clients,
        parentChildMap,
        delegateCreatedAt,
        delegateReplyCount,
        delegateReplyMetadata: new Map(),
        delegateRepliedSessions: new Set(),
        syncDelegateResolvers,
        subagentSyncChildren,
        syncDelegateLastText,
        leafIds,
        getPoolKey: (cwd, userId) => (userId ? `${cwd}::${userId}` : cwd),
        removeFromPool,
        stopChild,
        emitAgentEvent,
        deleteLspState,
        clearSessionCache,
      }),
    ).resolves.toBe(true);

    expect(managed.info.status).toBe("idle");
    expect(emitAgentEvent).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ type: "agent_end", reason: "crashed" }),
    );
    expect(stopChild).toHaveBeenCalledWith("child-1");
    expect(parentChildMap.has("sess-1")).toBe(false);
    expect(delegateCreatedAt.has("sess-1")).toBe(false);
    expect(delegateReplyCount.has("sess-1")).toBe(false);
    expect(syncResolve).toHaveBeenCalledWith({
      sessionId: "sess-1",
      status: "aborted",
      exitCode: 1,
      finalText: "(stopped)",
    });
    expect(syncDelegateResolvers.has("sess-1")).toBe(false);
    expect(subagentSyncChildren.has("sess-1")).toBe(false);
    expect(syncDelegateLastText.has("sess-1")).toBe(false);
    expect(leafIds.get("sess-1")).toBe("leaf-1");
    expect(managed.unsubscribe).toHaveBeenCalled();
    expect(managed.client.stop).toHaveBeenCalled();
    expect(clients.has("sess-1")).toBe(false);
    expect(removeFromPool).toHaveBeenCalledWith("/project", managed);
    expect(removeFromPool).toHaveBeenCalledWith("/project::sandbox-user", managed);
    expect(deleteLspState).toHaveBeenCalledWith("sess-1");
    expect(clearSessionCache).toHaveBeenCalledWith("sess-1");
  });

  it("delivers agent_end before clearing child-to-parent tracking", async () => {
    const managed = makeManaged();
    const clients = new Map([["child-1", managed]]);
    const parentChildMap = new Map([["parent-1", new Set(["child-1"])]]);
    let parentWasVisibleDuringEnd = false;
    const emitAgentEvent = vi.fn().mockImplementation(async () => {
      await Promise.resolve();
      parentWasVisibleDuringEnd = [...parentChildMap.values()].some((children) =>
        children.has("child-1"),
      );
    });

    await expect(
      stopAgentClientOperation({
        sessionId: "child-1",
        getActiveManaged: () => managed,
        clients,
        parentChildMap,
        delegateCreatedAt: new Map([["child-1", 1000]]),
        delegateReplyCount: new Map(),
        delegateReplyMetadata: new Map(),
        delegateRepliedSessions: new Set(),
        syncDelegateResolvers: new Map(),
        subagentSyncChildren: new Set(),
        syncDelegateLastText: new Map(),
        leafIds: new Map(),
        getPoolKey: (cwd) => cwd,
        removeFromPool: vi.fn(),
        stopChild: vi.fn(),
        emitAgentEvent,
        deleteLspState: vi.fn(),
        clearSessionCache: vi.fn(),
      }),
    ).resolves.toBe(true);

    expect(emitAgentEvent).toHaveBeenCalledWith(
      "child-1",
      expect.objectContaining({ type: "agent_end" }),
    );
    expect(parentWasVisibleDuringEnd).toBe(true);
    expect(parentChildMap.has("parent-1")).toBe(false);
  });
});

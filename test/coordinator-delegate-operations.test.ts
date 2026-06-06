/**
 * @vitest-environment node
 */
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

import {
  handleCoordinatorDelegateOperation,
  handleCoordinatorDelegateForkOperation,
  handleCoordinatorDelegateListOperation,
  handleCoordinatorDelegateSendOperation,
  handleCoordinatorDelegateSyncOperation,
  handleCoordinatorDelegateStatusOperation,
  handleCoordinatorDelegateStopOperation,
} from "../src/shared/agent/coordinator-delegate-operations";

function makeManaged(status = "idle", sessionPath = "/tmp/child.jsonl") {
  return {
    info: {
      status,
      sessionPath,
      projectPath: "/project",
    },
  };
}

describe("coordinator delegate operations", () => {
  it("starts coordinator delegates, tracks parent child state, sends prompt, and broadcasts creation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-delegate-create-"));
    const parentSessionPath = join(dir, "parent.jsonl");
    writeFileSync(parentSessionPath, '{"type":"session"}\n', "utf-8");
    const parentChildMap = new Map<string, Set<string>>();
    const delegateCreatedAt = new Map<string, number>();
    const delegateReplyCount = new Map<string, number>();
    const start = vi.fn().mockResolvedValue({ status: "started" });
    const setSessionName = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);

    await expect(
      handleCoordinatorDelegateOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate",
          task: "inspect repo",
          title: "Inspect",
        },
        getActiveManaged: () => makeManaged("idle", parentSessionPath),
        start,
        setSessionName,
        send,
        broadcastEvent,
        parentChildMap,
        delegateCreatedAt,
        delegateReplyCount,
        now: () => 1000,
        sessionIdFactory: () => "child-delegate",
      }),
    ).resolves.toEqual({ sessionId: "child-delegate", status: "started" });

    const childSessionPath = join(dir, "child-delegate.jsonl");
    expect(start).toHaveBeenCalledWith("child-delegate", "/project", childSessionPath, {
      forceNewProcess: true,
    });
    expect(setSessionName).toHaveBeenCalledWith("child-delegate", "指派: Inspect");
    expect(send).toHaveBeenCalledWith("child-delegate", expect.stringContaining("inspect repo"));
    expect(send).toHaveBeenCalledWith(
      "child-delegate",
      expect.stringContaining("你的会话 ID: child-delegate"),
    );
    expect(parentChildMap.get("parent")?.has("child-delegate")).toBe(true);
    expect(delegateCreatedAt.get("child-delegate")).toBe(1000);
    expect(delegateReplyCount.get("child-delegate")).toBe(0);
    expect(broadcastEvent).toHaveBeenCalledWith(
      "coordinator.session_created",
      expect.objectContaining({
        parentSessionId: "parent",
        session: expect.objectContaining({
          sessionId: "child-delegate",
          delegateParentSessionId: "parent",
          delegateType: "coordinator",
          name: "指派: Inspect",
          sessionPath: childSessionPath,
          parentSessionPath,
          firstMessage: "inspect repo",
          createdAt: 1000,
          updatedAt: 1000,
        }),
      }),
      { parentSessionId: "parent" },
    );

    const childJsonl = readFileSync(childSessionPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(childJsonl).toEqual([
      expect.objectContaining({
        type: "session",
        id: "child-delegate",
        cwd: "/project",
        delegateParentSessionId: "parent",
      }),
      expect.objectContaining({
        type: "delegate_info",
        delegateParentSessionId: "parent",
        parentSessionPath,
        delegateType: "coordinator",
      }),
    ]);
  });

  it("rejects coordinator delegates when the parent session is missing", async () => {
    await expect(
      handleCoordinatorDelegateOperation({
        parentSessionId: "missing-parent",
        msg: {
          __call: "session_delegate",
          task: "inspect repo",
        },
        getActiveManaged: () => null,
        start: vi.fn(),
        setSessionName: vi.fn(),
        send: vi.fn(),
        broadcastEvent: vi.fn(),
        parentChildMap: new Map(),
        delegateCreatedAt: new Map(),
        delegateReplyCount: new Map(),
      }),
    ).rejects.toThrow("Parent session not found");
  });

  it("forks delegate sessions, strips parent header state, and broadcasts the fork", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-delegate-fork-"));
    const sourcePath = join(dir, "source.jsonl");
    writeFileSync(
      sourcePath,
      [
        JSON.stringify({ type: "session", id: "source", parentSession: "old-parent" }),
        JSON.stringify({ type: "message", role: "assistant" }),
      ].join("\n") + "\n",
      "utf-8",
    );
    const parentChildMap = new Map<string, Set<string>>();
    const start = vi.fn().mockResolvedValue({ status: "started" });
    const setSessionName = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);

    await expect(
      handleCoordinatorDelegateForkOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate_fork",
          sessionId: "source",
          task: "continue from here",
          title: "Forked Task",
        },
        clients: new Map([["source", makeManaged("idle", sourcePath)]]),
        start,
        setSessionName,
        send,
        broadcastEvent,
        parentChildMap,
        sessionIdFactory: () => "forked-child",
      }),
    ).resolves.toEqual({ sessionId: "forked-child", status: "started" });

    const forkedPath = join(dir, "forked-child.jsonl");
    expect(start).toHaveBeenCalledWith("forked-child", "/project", forkedPath, {
      forceNewProcess: true,
    });
    expect(setSessionName).toHaveBeenCalledWith("forked-child", "Forked Task");
    expect(send).toHaveBeenCalledWith("forked-child", "continue from here");
    expect(parentChildMap.get("parent")?.has("forked-child")).toBe(true);
    expect(broadcastEvent).toHaveBeenCalledWith(
      "coordinator.session_created",
      expect.objectContaining({
        session: expect.objectContaining({
          sessionId: "forked-child",
          delegateType: "fork",
          sessionPath: forkedPath,
          parentSessionPath: sourcePath,
          name: "Forked Task",
          firstMessage: "continue from here",
        }),
      }),
      { parentSessionId: "parent" },
    );

    const header = JSON.parse(readFileSync(forkedPath, "utf-8").split("\n")[0]) as Record<
      string,
      unknown
    >;
    expect(header.parentSession).toBeUndefined();
  });

  it("rejects delegate forks when the source session is missing", async () => {
    await expect(
      handleCoordinatorDelegateForkOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate_fork",
          sessionId: "missing",
          task: "continue",
        },
        clients: new Map(),
        start: vi.fn(),
        setSessionName: vi.fn(),
        send: vi.fn(),
        broadcastEvent: vi.fn(),
        parentChildMap: new Map(),
      }),
    ).rejects.toThrow("Session not found: missing");
  });

  it("wraps delegate sends and chooses follow-up when the target is streaming", async () => {
    const clients = new Map([
      ["parent", makeManaged("idle", "/tmp/parent.jsonl")],
      ["child", makeManaged("streaming", "/tmp/child.jsonl")],
    ]);
    const parentChildMap = new Map([["parent", new Set(["child"])]]);
    const followUp = vi.fn();

    await expect(
      handleCoordinatorDelegateSendOperation({
        msg: {
          __call: "session_delegate_send",
          targetSessionId: "child",
          message: "done",
        },
        clients,
        sessionPaths: new Map(),
        sessionProjectPaths: new Map(),
        delegateReplyCount: new Map(),
        delegateCreatedAt: new Map([["child", 1000]]),
        parentChildMap,
        start: vi.fn(),
        send: vi.fn(),
        steer: vi.fn(),
        followUp,
        now: () => 3000,
      }),
    ).resolves.toEqual({ delivered: true, targetStatus: "active" });

    expect(followUp).toHaveBeenCalledWith(
      "child",
      expect.stringContaining('<delegate-reply from="child" title="child" sequence="1"'),
    );
  });

  it("restarts inactive delegate sessions from persisted paths before sending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-delegate-send-"));
    const sessionPath = join(dir, "child.jsonl");
    writeFileSync(sessionPath, '{"type":"session"}\n', "utf-8");
    const clients = new Map<string, ReturnType<typeof makeManaged>>();
    const start = vi.fn().mockImplementation(async () => {
      clients.set("child", makeManaged("idle", sessionPath));
      return { status: "started" };
    });
    const send = vi.fn();

    await expect(
      handleCoordinatorDelegateSendOperation({
        msg: {
          __call: "session_delegate_send",
          targetSessionId: "child",
          message: "hello",
        },
        clients,
        sessionPaths: new Map([["child", sessionPath]]),
        sessionProjectPaths: new Map([["child", dir]]),
        delegateReplyCount: new Map(),
        delegateCreatedAt: new Map(),
        parentChildMap: new Map(),
        start,
        send,
        steer: vi.fn(),
        followUp: vi.fn(),
      }),
    ).resolves.toEqual({ delivered: true, targetStatus: "active" });

    expect(start).toHaveBeenCalledWith("child", dir, sessionPath);
    expect(send).toHaveBeenCalledWith("child", expect.stringContaining("hello"));
  });

  it("reports stopped versus not-found delegate status using persisted records", async () => {
    const base = {
      msg: { __call: "session_delegate_status" as const, sessionId: "child" },
      sessionProjectPaths: new Map<string, string>(),
      getStatus: () => ({ status: "stopped" as const }),
      getState: vi.fn(),
      getContextUsage: vi.fn(),
    };

    await expect(
      handleCoordinatorDelegateStatusOperation({
        ...base,
        sessionPaths: new Map([["child", "/tmp/child.jsonl"]]),
      }),
    ).resolves.toMatchObject({ status: "stopped" });
    await expect(
      handleCoordinatorDelegateStatusOperation({
        ...base,
        sessionPaths: new Map(),
      }),
    ).resolves.toMatchObject({ status: "not_found" });
  });

  it("lists and stops only child delegate sessions", async () => {
    const parentChildMap = new Map([["parent", new Set(["child"])]]);
    const clients = new Map([["child", makeManaged("idle", "/tmp/child.jsonl")]]);

    expect(
      handleCoordinatorDelegateListOperation({ parentSessionId: "parent", parentChildMap, clients }),
    ).toEqual({
      sessions: [{ sessionId: "child", status: "idle", projectPath: "/project" }],
    });
    await expect(
      handleCoordinatorDelegateStopOperation({
        parentSessionId: "parent",
        msg: { __call: "session_delegate_stop", sessionId: "other" },
        parentChildMap,
        stop: vi.fn(),
      }),
    ).resolves.toEqual({ ok: false });
  });

  it("starts sync delegates, broadcasts creation, and cleans parent links after completion", async () => {
    const parentChildMap = new Map<string, Set<string>>();
    const syncDelegateResolvers = new Map();
    const send = vi.fn();
    const stop = vi.fn().mockResolvedValue(true);
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);

    const promise = handleCoordinatorDelegateSyncOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate_sync",
        task: "inspect repo",
        title: "Inspect",
        timeoutMs: 300_000,
      },
      getActiveManaged: () => makeManaged("idle", "/tmp/parent.jsonl"),
      start: vi.fn().mockResolvedValue({ status: "started" }),
      switchAgent: vi.fn(),
      setSessionName: vi.fn(),
      send,
      steer: vi.fn(),
      stop,
      broadcastEvent,
      parentChildMap,
      delegateCreatedAt: new Map(),
      delegateReplyCount: new Map(),
      syncDelegateResolvers,
      subagentSyncChildren: new Set(),
      syncDelegateLastText: new Map(),
      now: () => 1000,
      sessionIdFactory: () => "child-sync",
    });

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith("child-sync", expect.stringContaining("inspect repo"));
      expect(broadcastEvent).toHaveBeenCalledWith(
        "coordinator.session_created",
        expect.objectContaining({
          session: expect.objectContaining({
            sessionId: "child-sync",
            delegateType: "subagent",
          }),
        }),
        { parentSessionId: "parent" },
      );
      expect(broadcastEvent).toHaveBeenCalledWith(
        "subagent.event",
        expect.objectContaining({ subSessionId: "child-sync" }),
        { parentSessionId: "parent" },
      );
    });
    expect(parentChildMap.get("parent")?.has("child-sync")).toBe(true);

    const resolver = syncDelegateResolvers.get("child-sync");
    expect(resolver).toBeDefined();
    clearTimeout(resolver.timeout);
    syncDelegateResolvers.delete("child-sync");
    resolver.resolve({
      sessionId: "child-sync",
      status: "completed",
      exitCode: 0,
      finalText: "done",
    });

    await expect(promise).resolves.toEqual({
      sessionId: "child-sync",
      status: "completed",
      exitCode: 0,
      finalText: "done",
    });
    expect(stop).toHaveBeenCalledWith("child-sync");
    expect(parentChildMap.has("parent")).toBe(false);
  });

  it("times out sync delegates and clears pending state", async () => {
    const syncDelegateResolvers = new Map();
    const subagentSyncChildren = new Set<string>();
    const syncDelegateLastText = new Map([["child-sync", "partial"]]);

    const promise = handleCoordinatorDelegateSyncOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate_sync",
        task: "slow task",
        timeoutMs: 1,
      },
      getActiveManaged: () => makeManaged("idle", "/tmp/parent.jsonl"),
      start: vi.fn().mockResolvedValue({ status: "started" }),
      switchAgent: vi.fn(),
      setSessionName: vi.fn(),
      send: vi.fn(),
      steer: vi.fn(),
      stop: vi.fn().mockResolvedValue(true),
      broadcastEvent: vi.fn().mockResolvedValue(undefined),
      parentChildMap: new Map(),
      delegateCreatedAt: new Map(),
      delegateReplyCount: new Map(),
      syncDelegateResolvers,
      subagentSyncChildren,
      syncDelegateLastText,
      sessionIdFactory: () => "child-sync",
    });

    await expect(promise).resolves.toEqual({
      sessionId: "child-sync",
      status: "timeout",
      exitCode: 1,
      finalText: "partial",
    });
    expect(syncDelegateResolvers.has("child-sync")).toBe(false);
    expect(subagentSyncChildren.has("child-sync")).toBe(false);
    expect(syncDelegateLastText.has("child-sync")).toBe(false);
  });
});

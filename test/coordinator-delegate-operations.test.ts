/**
 * @vitest-environment node
 */
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

import {
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

    await new Promise((resolve) => setTimeout(resolve, 0));
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

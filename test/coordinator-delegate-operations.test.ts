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
});

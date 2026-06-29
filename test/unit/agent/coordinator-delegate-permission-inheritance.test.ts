import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleCoordinatorDelegateOperation,
  handleCoordinatorDelegateSyncOperation,
} from "../../../src/shared/agent/coordinator-delegate-operations";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function makeParentSession(permissionMode = "autopilot") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-permission-"));
  tempDirs.push(dir);
  return {
    info: {
      projectPath: dir,
      sessionPath: path.join(dir, "parent.jsonl"),
      permissionMode,
    },
  };
}

describe("delegate permission inheritance", () => {
  it("applies the parent permission mode to async coordinator delegates before sending the task", async () => {
    const parent = makeParentSession("autopilot");
    const setPermissionMode = vi.fn(async () => ({ mode: "autopilot" }));
    const send = vi.fn();

    await handleCoordinatorDelegateOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate",
        task: "检查权限继承",
        title: "权限继承验证",
      },
      getActiveManaged: (sessionId) => (sessionId === "parent" ? parent : null),
      start: async () => ({ status: "started" }),
      setPermissionMode,
      setSessionName: async () => {},
      send,
      broadcastEvent: async () => {},
      parentChildMap: new Map(),
      delegateCreatedAt: new Map(),
      delegateReplyCount: new Map(),
      sessionIdFactory: () => "child",
    });

    expect(setPermissionMode).toHaveBeenCalledWith("child", "autopilot");
    expect(setPermissionMode.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    );
  });

  it("applies the parent permission mode to sync subagent delegates", async () => {
    const parent = makeParentSession("yolo");
    const setPermissionMode = vi.fn(async () => ({ mode: "yolo" }));
    const send = vi.fn();
    const steer = vi.fn();

    const pending = handleCoordinatorDelegateSyncOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate_sync",
        task: "检查同步权限继承",
        title: "同步权限继承验证",
        timeoutMs: 25,
      },
      getActiveManaged: (sessionId) => (sessionId === "parent" ? parent : null),
      start: async () => ({ status: "started" }),
      switchAgent: async () => {},
      setPermissionMode,
      setSessionName: async () => {},
      send,
      steer,
      stop: async () => true,
      broadcastEvent: async () => {},
      parentChildMap: new Map(),
      delegateCreatedAt: new Map(),
      delegateReplyCount: new Map(),
      syncDelegateResolvers: new Map(),
      subagentSyncChildren: new Set(),
      syncDelegateLastText: new Map(),
      sessionIdFactory: () => "sub-child",
    });

    await expect(pending).resolves.toMatchObject({ sessionId: "sub-child", status: "timeout" });
    expect(setPermissionMode).toHaveBeenCalledWith("sub-child", "yolo");
    expect(setPermissionMode.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    );
  });
});

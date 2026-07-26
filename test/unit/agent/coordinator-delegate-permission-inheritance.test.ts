import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleCoordinatorDelegateForkOperation,
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
      syncDelegateTimedOut: new Set(),
      sessionIdFactory: () => "sub-child",
    });

    await expect(pending).resolves.toMatchObject({ sessionId: "sub-child", status: "timeout" });
    expect(setPermissionMode).toHaveBeenCalledWith("sub-child", "yolo");
    expect(setPermissionMode.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    );
  });

  it("uses agentName alias when switching async coordinator delegates", async () => {
    const parent = makeParentSession("autopilot");
    const switchAgent = vi.fn(async () => ({}));

    await handleCoordinatorDelegateOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate",
        task: "检查 agentName 别名",
        agentName: "frontend-dev",
      },
      getActiveManaged: (sessionId) => (sessionId === "parent" ? parent : null),
      start: async () => ({ status: "started" }),
      switchAgent,
      setSessionName: async () => {},
      send: vi.fn(),
      broadcastEvent: async () => {},
      parentChildMap: new Map(),
      delegateCreatedAt: new Map(),
      delegateReplyCount: new Map(),
      sessionIdFactory: () => "child-agent",
    });

    expect(switchAgent).toHaveBeenCalledWith("child-agent", "frontend-dev");
  });

  it("does not run async coordinator delegates with the default agent when requested agent switching fails", async () => {
    const parent = makeParentSession("autopilot");
    const send = vi.fn();
    const stop = vi.fn(async () => true);
    const parentChildMap = new Map();

    await expect(
      handleCoordinatorDelegateOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate",
          task: "不能静默退回 build",
          agent: "frontend-dev",
        },
        getActiveManaged: (sessionId) => (sessionId === "parent" ? parent : null),
        start: async () => ({ status: "started" }),
        switchAgent: async () => {
          throw new Error('Agent "frontend-dev" not found');
        },
        stop,
        setSessionName: async () => {},
        send,
        broadcastEvent: async () => {},
        parentChildMap,
        delegateCreatedAt: new Map(),
        delegateReplyCount: new Map(),
        sessionIdFactory: () => "child-agent-fail",
      }),
    ).rejects.toThrow(
      'Failed to switch delegated session child-agent-fail to agent "frontend-dev"',
    );

    expect(send).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledWith("child-agent-fail");
    expect(parentChildMap.get("parent")?.has("child-agent-fail")).not.toBe(true);
  });

  it("uses agentName alias when switching sync subagent delegates", async () => {
    const parent = makeParentSession("autopilot");
    const switchAgent = vi.fn(async () => ({}));

    const pending = handleCoordinatorDelegateSyncOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate_sync",
        task: "检查同步 agentName 别名",
        agentName: "frontend-dev",
        timeoutMs: 25,
      },
      getActiveManaged: (sessionId) => (sessionId === "parent" ? parent : null),
      start: async () => ({ status: "started" }),
      switchAgent,
      setSessionName: async () => {},
      send: vi.fn(),
      steer: vi.fn(),
      stop: async () => true,
      broadcastEvent: async () => {},
      parentChildMap: new Map(),
      delegateCreatedAt: new Map(),
      delegateReplyCount: new Map(),
      syncDelegateResolvers: new Map(),
      subagentSyncChildren: new Set(),
      syncDelegateLastText: new Map(),
      syncDelegateTimedOut: new Set(),
      sessionIdFactory: () => "sub-child-agent",
    });

    await expect(pending).resolves.toMatchObject({ sessionId: "sub-child-agent" });
    expect(switchAgent).toHaveBeenCalledWith("sub-child-agent", "frontend-dev");
  });

  it("does not run sync subagent delegates with the default agent when requested agent switching fails", async () => {
    const parent = makeParentSession("autopilot");
    const send = vi.fn();
    const stop = vi.fn(async () => true);
    const parentChildMap = new Map();

    await expect(
      handleCoordinatorDelegateSyncOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate_sync",
          task: "同步子任务也不能静默退回 build",
          agent: "frontend-dev",
          timeoutMs: 25,
        },
        getActiveManaged: (sessionId) => (sessionId === "parent" ? parent : null),
        start: async () => ({ status: "started" }),
        switchAgent: async () => {
          throw new Error('Agent "frontend-dev" not found');
        },
        setSessionName: async () => {},
        send,
        steer: vi.fn(),
        stop,
        broadcastEvent: async () => {},
        parentChildMap,
        delegateCreatedAt: new Map(),
        delegateReplyCount: new Map(),
        syncDelegateResolvers: new Map(),
        subagentSyncChildren: new Set(),
        syncDelegateLastText: new Map(),
        syncDelegateTimedOut: new Set(),
        sessionIdFactory: () => "sub-child-agent-fail",
      }),
    ).rejects.toThrow(
      'Failed to switch delegated session sub-child-agent-fail to agent "frontend-dev"',
    );

    expect(send).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledWith("sub-child-agent-fail");
    expect(parentChildMap.get("parent")?.has("sub-child-agent-fail")).not.toBe(true);
  });

  it("uses agentName alias when switching forked delegates", async () => {
    const parent = makeParentSession("autopilot");
    const baseSessionPath = parent.info.sessionPath;
    fs.writeFileSync(baseSessionPath, JSON.stringify({ type: "session", id: "base" }) + "\n");
    const switchAgent = vi.fn(async () => ({}));

    await handleCoordinatorDelegateForkOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate_fork",
        sessionId: "base",
        task: "检查 fork agentName 别名",
        agentName: "frontend-dev",
      },
      clients: new Map([
        [
          "base",
          {
            info: {
              projectPath: parent.info.projectPath,
              sessionPath: baseSessionPath,
            },
          },
        ],
      ]),
      start: async () => ({ status: "started" }),
      switchAgent,
      setSessionName: async () => {},
      send: vi.fn(),
      broadcastEvent: async () => {},
      parentChildMap: new Map([["parent", new Set(["base"])]]),
      sessionIdFactory: () => "fork-child-agent",
    });

    expect(switchAgent).toHaveBeenCalledWith("fork-child-agent", "frontend-dev");
  });

  it("does not run forked delegates with the default agent when requested agent switching fails", async () => {
    const parent = makeParentSession("autopilot");
    const baseSessionPath = parent.info.sessionPath;
    fs.writeFileSync(baseSessionPath, JSON.stringify({ type: "session", id: "base" }) + "\n");
    const send = vi.fn();
    const stop = vi.fn(async () => true);
    const parentChildMap = new Map([["parent", new Set(["base"])]]);

    await expect(
      handleCoordinatorDelegateForkOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate_fork",
          sessionId: "base",
          task: "fork 也不能静默退回 build",
          agent: "frontend-dev",
        },
        clients: new Map([
          [
            "base",
            {
              info: {
                projectPath: parent.info.projectPath,
                sessionPath: baseSessionPath,
              },
            },
          ],
        ]),
        start: async () => ({ status: "started" }),
        switchAgent: async () => {
          throw new Error('Agent "frontend-dev" not found');
        },
        stop,
        setSessionName: async () => {},
        send,
        broadcastEvent: async () => {},
        parentChildMap,
        sessionIdFactory: () => "fork-child-agent-fail",
      }),
    ).rejects.toThrow(
      'Failed to switch delegated session fork-child-agent-fail to agent "frontend-dev"',
    );

    expect(send).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledWith("fork-child-agent-fail");
    expect(parentChildMap.get("parent")?.has("fork-child-agent-fail")).toBe(false);
  });
});

/**
 * @vitest-environment node
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRemoteProjectByPath: vi.fn(),
}));

vi.mock("../../../src/shared/lib/project-config", () => ({
  getRemoteProjectByPath: mocks.getRemoteProjectByPath,
}));

import {
  handleCoordinatorDelegateOperation,
  handleCoordinatorDelegateForkOperation,
  handleCoordinatorDelegateListOperation,
  handleCoordinatorDelegateSendOperation,
  handleCoordinatorDelegateSyncOperation,
  handleCoordinatorDelegateStatusOperation,
  handleCoordinatorDelegateStopOperation,
} from "../../../src/shared/agent/coordinator-delegate-operations";

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
  beforeEach(() => {
    mocks.getRemoteProjectByPath.mockResolvedValue(null);
  });

  it("starts coordinator delegates, tracks parent child state, sends prompt, and broadcasts creation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-delegate-create-"));
    const parentSessionPath = join(dir, "parent.jsonl");
    writeFileSync(parentSessionPath, '{"type":"session"}\n', "utf-8");
    const parentChildMap = new Map<string, Set<string>>();
    const delegateCreatedAt = new Map<string, number>();
    const delegateReplyCount = new Map<string, number>();
    const delegateReplyMetadata = new Map<string, unknown>();
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
        delegateReplyMetadata,
        now: () => 1000,
        sessionIdFactory: () => "child-delegate",
      }),
    ).resolves.toEqual({ sessionId: "child-delegate", status: "started" });

    const childSessionPath = join(dir, "child-delegate.jsonl");
    expect(start).toHaveBeenCalledWith("child-delegate", "/project", childSessionPath, {
      forceNewProcess: true,
      delegateParentSessionId: "parent",
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
    expect(delegateReplyMetadata.get("child-delegate")).toEqual({
      task: "inspect repo",
      title: "指派: Inspect",
      projectPath: "/project",
      replyMode: "interrupt",
      params: '{"title":"指派: Inspect","projectPath":"/project","replyMode":"interrupt"}',
    });
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

  it("switches coordinator delegates to the requested agent before sending the task", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-delegate-agent-"));
    const parentSessionPath = join(dir, "parent.jsonl");
    writeFileSync(parentSessionPath, '{"type":"session"}\n', "utf-8");
    const delegateReplyMetadata = new Map<string, unknown>();
    const switchAgent = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();

    await expect(
      handleCoordinatorDelegateOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate",
          task: "inspect repo",
          title: "Inspect",
          agent: "frontend-dev",
        },
        getActiveManaged: () => makeManaged("idle", parentSessionPath),
        start: vi.fn().mockResolvedValue({ status: "started" }),
        switchAgent,
        setSessionName: vi.fn().mockResolvedValue(undefined),
        send,
        broadcastEvent: vi.fn().mockResolvedValue(undefined),
        parentChildMap: new Map(),
        delegateCreatedAt: new Map(),
        delegateReplyCount: new Map(),
        delegateReplyMetadata,
        sessionIdFactory: () => "child-agent",
      }),
    ).resolves.toEqual({ sessionId: "child-agent", status: "started" });

    expect(switchAgent).toHaveBeenCalledWith("child-agent", "frontend-dev");
    expect(switchAgent.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(send).toHaveBeenCalledWith(
      "child-agent",
      expect.stringContaining("**Agent 角色:** frontend-dev"),
    );
    expect(delegateReplyMetadata.get("child-agent")).toEqual({
      task: "inspect repo",
      title: "指派: Inspect",
      projectPath: "/project",
      replyMode: "interrupt",
      agent: "frontend-dev",
      params:
        '{"title":"指派: Inspect","agent":"frontend-dev","projectPath":"/project","replyMode":"interrupt"}',
    });
  });

  it("sets coordinator delegate model before sending the task", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-delegate-model-"));
    const parentSessionPath = join(dir, "parent.jsonl");
    writeFileSync(parentSessionPath, '{"type":"session"}\n', "utf-8");
    const setModel = vi.fn().mockResolvedValue({ provider: "openai", id: "gpt-4.1" });
    const send = vi.fn();

    await expect(
      handleCoordinatorDelegateOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate",
          task: "inspect repo",
          title: "Inspect",
          model: "openai/gpt-4.1",
        },
        getActiveManaged: () => makeManaged("idle", parentSessionPath),
        start: vi.fn().mockResolvedValue({ status: "started" }),
        setModel,
        setSessionName: vi.fn().mockResolvedValue(undefined),
        send,
        broadcastEvent: vi.fn().mockResolvedValue(undefined),
        parentChildMap: new Map(),
        delegateCreatedAt: new Map(),
        delegateReplyCount: new Map(),
        sessionIdFactory: () => "child-model",
      }),
    ).resolves.toEqual({ sessionId: "child-model", status: "started" });

    expect(setModel).toHaveBeenCalledWith("child-model", "openai", "gpt-4.1");
    expect(setModel.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  it("starts cross-project coordinator delegates in the target project session directory", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "pi-delegate-cross-parent-"));
    const targetProjectPath = mkdtempSync(join(tmpdir(), "pi-delegate-cross-target-"));
    const parentSessionPath = join(parentDir, "parent.jsonl");
    writeFileSync(parentSessionPath, '{"type":"session"}\n', "utf-8");
    const encodedTarget = "--" + targetProjectPath.replace(/^\//, "").replace(/\//g, "-") + "--";
    const targetSessionDir = join(homedir(), ".pi", "agent", "sessions", encodedTarget);
    const childSessionPath = join(targetSessionDir, "child-cross.jsonl");

    const parentChildMap = new Map<string, Set<string>>();
    const delegateCreatedAt = new Map<string, number>();
    const delegateReplyCount = new Map<string, number>();
    const start = vi.fn().mockResolvedValue({ status: "started" });
    const setSessionName = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);

    try {
      await expect(
        handleCoordinatorDelegateOperation({
          parentSessionId: "parent",
          msg: {
            __call: "session_delegate",
            task: "inspect target project",
            title: "Inspect Target",
            projectPath: targetProjectPath,
          },
          getActiveManaged: () => makeManaged("idle", parentSessionPath),
          start,
          setSessionName,
          send,
          broadcastEvent,
          parentChildMap,
          delegateCreatedAt,
          delegateReplyCount,
          now: () => 2000,
          sessionIdFactory: () => "child-cross",
        }),
      ).resolves.toEqual({ sessionId: "child-cross", status: "started" });

      expect(start).toHaveBeenCalledWith("child-cross", targetProjectPath, childSessionPath, {
        forceNewProcess: true,
        delegateParentSessionId: "parent",
      });
      expect(setSessionName).toHaveBeenCalledWith("child-cross", "指派: Inspect Target");
      expect(send).toHaveBeenCalledWith(
        "child-cross",
        expect.stringContaining(`- 项目路径: ${targetProjectPath}`),
      );
      expect(parentChildMap.get("parent")?.has("child-cross")).toBe(true);
      expect(broadcastEvent).toHaveBeenCalledWith(
        "coordinator.session_created",
        expect.objectContaining({
          parentSessionId: "parent",
          session: expect.objectContaining({
            sessionId: "child-cross",
            projectPath: targetProjectPath,
            sessionPath: childSessionPath,
            parentSessionPath,
            delegateType: "coordinator",
            firstMessage: "inspect target project",
          }),
        }),
        { parentSessionId: "parent" },
      );

      const childJsonl = readFileSync(childSessionPath, "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(childJsonl[0]).toMatchObject({
        type: "session",
        id: "child-cross",
        cwd: targetProjectPath,
        delegateParentSessionId: "parent",
      });
      expect(childJsonl[1]).toMatchObject({
        type: "delegate_info",
        delegateParentSessionId: "parent",
        parentSessionPath,
        delegateType: "coordinator",
      });
    } finally {
      rmSync(targetSessionDir, { recursive: true, force: true });
    }
  });

  it("maps SSH remote project paths back to the local shadow project for delegate sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-delegate-remote-parent-"));
    const parentSessionPath = join(dir, "parent.jsonl");
    writeFileSync(parentSessionPath, '{"type":"session"}\n', "utf-8");
    const localShadowPath = "/Users/me/.pi-agent-chat/remote-projects/ssh-demo";
    const remotePath = "/Users/xyz/Projects/demo1";
    const remoteRecord = {
      id: "remote-demo",
      name: "demo1",
      runtime: "ssh",
      sshRuntimeKind: "remote-agent-child",
      profileId: "profile-1",
      host: "xyz-mac",
      remotePath,
      localPath: localShadowPath,
      createdAt: 1,
      lastOpened: 1,
    };
    mocks.getRemoteProjectByPath.mockImplementation(async (projectPath: string) =>
      projectPath === remotePath || projectPath === localShadowPath ? remoteRecord : null,
    );
    const parentChildMap = new Map<string, Set<string>>();
    const delegateCreatedAt = new Map<string, number>();
    const delegateReplyCount = new Map<string, number>();
    const start = vi.fn().mockResolvedValue({ status: "started" });
    const setSessionName = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();
    const broadcastEvent = vi.fn().mockResolvedValue(undefined);

    await handleCoordinatorDelegateOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate",
        task: "inspect remote repo",
        title: "Inspect Remote",
        projectPath: remotePath,
      },
      getActiveManaged: () => ({
        info: {
          status: "idle",
          sessionPath: parentSessionPath,
          projectPath: localShadowPath,
        },
      }),
      start,
      setSessionName,
      send,
      broadcastEvent,
      parentChildMap,
      delegateCreatedAt,
      delegateReplyCount,
      now: () => 3000,
      sessionIdFactory: () => "child-remote",
    });

    const childSessionPath = join(dir, "child-remote.jsonl");
    expect(start).toHaveBeenCalledWith("child-remote", localShadowPath, childSessionPath, {
      forceNewProcess: true,
      delegateParentSessionId: "parent",
    });
    expect(send).toHaveBeenCalledWith(
      "child-remote",
      expect.stringContaining(`- 项目路径: ${localShadowPath}`),
    );
    expect(broadcastEvent).toHaveBeenCalledWith(
      "coordinator.session_created",
      expect.objectContaining({
        session: expect.objectContaining({
          projectPath: localShadowPath,
          sessionPath: childSessionPath,
        }),
      }),
      { parentSessionId: "parent" },
    );

    const childJsonl = readFileSync(childSessionPath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(childJsonl[0]).toMatchObject({
      type: "session",
      id: "child-remote",
      cwd: localShadowPath,
      delegateParentSessionId: "parent",
    });
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
    const parentChildMap = new Map([["parent", new Set(["source"])]]);
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
      delegateParentSessionId: "parent",
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

  it("switches forked delegate sessions to the requested agent before continuing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-delegate-fork-agent-"));
    const sourcePath = join(dir, "source.jsonl");
    writeFileSync(sourcePath, '{"type":"session","id":"source"}\n', "utf-8");
    const parentChildMap = new Map([["parent", new Set(["source"])]]);
    const switchAgent = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();

    await expect(
      handleCoordinatorDelegateForkOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate_fork",
          sessionId: "source",
          task: "continue from here",
          title: "Forked Task",
          agent: "backend-dev",
        },
        clients: new Map([["source", makeManaged("idle", sourcePath)]]),
        start: vi.fn().mockResolvedValue({ status: "started" }),
        switchAgent,
        setSessionName: vi.fn().mockResolvedValue(undefined),
        send,
        broadcastEvent: vi.fn().mockResolvedValue(undefined),
        parentChildMap,
        sessionIdFactory: () => "forked-agent",
      }),
    ).resolves.toEqual({ sessionId: "forked-agent", status: "started" });

    expect(switchAgent).toHaveBeenCalledWith("forked-agent", "backend-dev");
    expect(switchAgent.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(send).toHaveBeenCalledWith("forked-agent", "continue from here");
  });

  it("sets forked delegate model before continuing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-delegate-fork-model-"));
    const sourcePath = join(dir, "source.jsonl");
    writeFileSync(sourcePath, '{"type":"session","id":"source"}\n', "utf-8");
    const parentChildMap = new Map([["parent", new Set(["source"])]]);
    const setModel = vi.fn().mockResolvedValue({ provider: "openai", id: "gpt-4.1" });
    const send = vi.fn();

    await expect(
      handleCoordinatorDelegateForkOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate_fork",
          sessionId: "source",
          task: "continue from here",
          title: "Forked Task",
          model: "openai/gpt-4.1",
        },
        clients: new Map([["source", makeManaged("idle", sourcePath)]]),
        start: vi.fn().mockResolvedValue({ status: "started" }),
        setModel,
        setSessionName: vi.fn().mockResolvedValue(undefined),
        send,
        broadcastEvent: vi.fn().mockResolvedValue(undefined),
        parentChildMap,
        sessionIdFactory: () => "forked-model",
      }),
    ).resolves.toEqual({ sessionId: "forked-model", status: "started" });

    expect(setModel).toHaveBeenCalledWith("forked-model", "openai", "gpt-4.1");
    expect(setModel.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
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

  it("rejects delegate forks for sessions outside the caller's direct children", async () => {
    const parentChildMap = new Map([["other-parent", new Set(["child"])]]);

    await expect(
      handleCoordinatorDelegateForkOperation({
        parentSessionId: "parent",
        msg: {
          __call: "session_delegate_fork",
          sessionId: "child",
          task: "continue",
        },
        clients: new Map([["child", makeManaged("idle", "/tmp/child.jsonl")]]),
        start: vi.fn(),
        setSessionName: vi.fn(),
        send: vi.fn(),
        broadcastEvent: vi.fn(),
        parentChildMap,
      }),
    ).rejects.toThrow("Session not found: child");
  });

  it("wraps delegate sends and interrupts by default even when the target is streaming", async () => {
    const clients = new Map([
      ["parent", makeManaged("idle", "/tmp/parent.jsonl")],
      ["child", makeManaged("streaming", "/tmp/child.jsonl")],
    ]);
    const parentChildMap = new Map([["parent", new Set(["child"])]]);
    const steer = vi.fn();

    await expect(
      handleCoordinatorDelegateSendOperation({
        sourceSessionId: "parent",
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
        steer,
        followUp: vi.fn(),
        now: () => 3000,
      }),
    ).resolves.toEqual({ delivered: true, targetStatus: "active" });

    expect(steer).toHaveBeenCalledWith(
      "child",
      expect.stringContaining(
        '<delegate-reply from="parent" sessionId="parent" targetSessionId="child" title="child" sequence="1"',
      ),
    );
  });

  it("preserves auto reply mode by queuing follow-up when the target is streaming", async () => {
    const clients = new Map([
      ["parent", makeManaged("idle", "/tmp/parent.jsonl")],
      ["child", makeManaged("streaming", "/tmp/child.jsonl")],
    ]);
    const parentChildMap = new Map([["parent", new Set(["child"])]]);
    const followUp = vi.fn();

    await handleCoordinatorDelegateSendOperation({
      sourceSessionId: "parent",
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
      delegateReplyMode: new Map([["parent", "auto"]]),
      parentChildMap,
      start: vi.fn(),
      send: vi.fn(),
      steer: vi.fn(),
      followUp,
      now: () => 3000,
    });

    expect(followUp).toHaveBeenCalledWith("child", expect.stringContaining("done"));
  });

  it("wraps child-to-parent delegate replies with the child session as the jump target", async () => {
    const clients = new Map([
      ["parent", makeManaged("idle", "/tmp/parent.jsonl")],
      ["child", makeManaged("idle", "/tmp/child.jsonl")],
    ]);
    const parentChildMap = new Map([["parent", new Set(["child"])]]);
    const steer = vi.fn();
    const delegateReplyCount = new Map<string, number>();
    const delegateRepliedSessions = new Set<string>();

    await expect(
      handleCoordinatorDelegateSendOperation({
        sourceSessionId: "child",
        msg: {
          __call: "session_delegate_send",
          targetSessionId: "parent",
          message: "delegate done",
        },
        clients,
        sessionPaths: new Map(),
        sessionProjectPaths: new Map(),
        delegateReplyCount,
        delegateCreatedAt: new Map([["child", 1000]]),
        delegateRepliedSessions,
        parentChildMap,
        start: vi.fn(),
        send: vi.fn(),
        steer,
        followUp: vi.fn(),
        now: () => 3000,
      }),
    ).resolves.toEqual({ delivered: true, targetStatus: "active" });

    expect(steer).toHaveBeenCalledWith(
      "parent",
      expect.stringContaining(
        '<delegate-reply from="child" sessionId="child" targetSessionId="parent"',
      ),
    );
    expect(steer).toHaveBeenCalledWith("parent", expect.stringContaining('elapsed="2s"'));
    expect(delegateReplyCount.get("child")).toBe(1);
    expect(delegateReplyCount.has("parent")).toBe(false);
    expect(delegateRepliedSessions.has("child")).toBe(true);
  });

  it("rejects delegate sends to unrelated sessions", async () => {
    const clients = new Map([
      ["child", makeManaged("idle", "/tmp/child.jsonl")],
      ["other-parent", makeManaged("idle", "/tmp/other-parent.jsonl")],
    ]);
    const parentChildMap = new Map([["parent", new Set(["child"])]]);
    const steer = vi.fn();

    await expect(
      handleCoordinatorDelegateSendOperation({
        sourceSessionId: "child",
        msg: {
          __call: "session_delegate_send",
          targetSessionId: "other-parent",
          message: "should not cross session boundary",
        },
        clients,
        sessionPaths: new Map(),
        sessionProjectPaths: new Map(),
        delegateReplyCount: new Map(),
        delegateCreatedAt: new Map(),
        parentChildMap,
        start: vi.fn(),
        send: vi.fn(),
        steer,
        followUp: vi.fn(),
      }),
    ).resolves.toEqual({
      delivered: false,
      targetStatus: "not_found",
      notFoundReason: "not_a_delegate_child",
    });

    expect(steer).not.toHaveBeenCalled();
  });

  it("reports missing session files separately from removed delegate relationships", async () => {
    const clients = new Map<string, ReturnType<typeof makeManaged>>();
    const parentChildMap = new Map([["parent", new Set(["child"])]]);
    const missingSessionPath = join(tmpdir(), `missing-child-${Date.now()}.jsonl`);

    await expect(
      handleCoordinatorDelegateSendOperation({
        sourceSessionId: "parent",
        msg: {
          __call: "session_delegate_send",
          targetSessionId: "child",
          message: "hello",
        },
        clients,
        sessionPaths: new Map([["child", missingSessionPath]]),
        sessionProjectPaths: new Map([["child", tmpdir()]]),
        delegateReplyCount: new Map(),
        delegateCreatedAt: new Map(),
        parentChildMap,
        start: vi.fn(),
        send: vi.fn(),
        steer: vi.fn(),
        followUp: vi.fn(),
      }),
    ).resolves.toEqual({
      delivered: false,
      targetStatus: "not_found",
      notFoundReason: "session_file_missing",
    });
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
    const steer = vi.fn();

    await expect(
      handleCoordinatorDelegateSendOperation({
        sourceSessionId: "child",
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
        send: vi.fn(),
        steer,
        followUp: vi.fn(),
      }),
    ).resolves.toEqual({ delivered: true, targetStatus: "active" });

    expect(start).toHaveBeenCalledWith("child", dir, sessionPath);
    expect(steer).toHaveBeenCalledWith("child", expect.stringContaining("hello"));
  });

  it("reports stopped versus not-found delegate status using persisted records", async () => {
    const parentChildMap = new Map([["parent", new Set(["child"])]]);
    const base = {
      parentSessionId: "parent",
      msg: { __call: "session_delegate_status" as const, sessionId: "child" },
      parentChildMap,
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

  it("reports completed when an idle delegate session has produced an assistant message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "delegate-status-"));
    const sessionPath = join(dir, "child.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: "child" }),
        JSON.stringify({
          type: "message",
          id: "assistant-1",
          message: { role: "assistant", content: [{ type: "text", text: "done" }] },
        }),
      ].join("\n"),
    );

    await expect(
      handleCoordinatorDelegateStatusOperation({
        parentSessionId: "parent",
        msg: { __call: "session_delegate_status", sessionId: "child" },
        parentChildMap: new Map([["parent", new Set(["child"])]]),
        sessionPaths: new Map([["child", sessionPath]]),
        sessionProjectPaths: new Map([["child", dir]]),
        getStatus: () => ({ status: "idle" as const }),
        getState: vi.fn().mockResolvedValue({ isStreaming: false, isCompacting: false }),
        getContextUsage: vi.fn().mockResolvedValue({
          tokens: null,
          contextWindow: 0,
          percent: null,
        }),
      }),
    ).resolves.toMatchObject({ status: "completed" });

    rmSync(dir, { recursive: true, force: true });
  });

  it("reports not_found after a delegate session is removed from the parent task list", async () => {
    await expect(
      handleCoordinatorDelegateStatusOperation({
        parentSessionId: "parent",
        msg: { __call: "session_delegate_status", sessionId: "child" },
        parentChildMap: new Map([["parent", new Set()]]),
        sessionPaths: new Map([["child", "/tmp/child.jsonl"]]),
        sessionProjectPaths: new Map([["child", "/tmp"]]),
        getStatus: () => ({ status: "idle" as const }),
        getState: vi.fn(),
        getContextUsage: vi.fn(),
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

  it("keeps stopped delegate sessions visible to the parent task list", async () => {
    const parentChildMap = new Map([["parent", new Set(["child"])]]);
    const stop = vi.fn(async () => {
      parentChildMap.get("parent")?.delete("child");
      return true;
    });

    await expect(
      handleCoordinatorDelegateStopOperation({
        parentSessionId: "parent",
        msg: { __call: "session_delegate_stop", sessionId: "child" },
        parentChildMap,
        stop,
      }),
    ).resolves.toEqual({ ok: true });

    expect(stop).toHaveBeenCalledWith("child");
    expect(parentChildMap.get("parent")?.has("child")).toBe(true);
  });

  it("starts sync delegates, broadcasts creation, and cleans parent links after completion", async () => {
    const parentChildMap = new Map<string, Set<string>>();
    const syncDelegateResolvers = new Map();
    const delegateReplyMetadata = new Map<string, unknown>();
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
      delegateReplyMetadata,
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
    expect(delegateReplyMetadata.get("child-sync")).toEqual({
      task: "inspect repo",
      title: "子代理: Inspect",
      projectPath: "/project",
      replyMode: "interrupt",
      agent: undefined,
      params: '{"title":"子代理: Inspect","projectPath":"/project","replyMode":"interrupt"}',
    });

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

  it("records sync delegate agent metadata for later reply cards", async () => {
    const syncDelegateResolvers = new Map();
    const delegateReplyMetadata = new Map<string, unknown>();

    const promise = handleCoordinatorDelegateSyncOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate_sync",
        task: "review the diff",
        title: "Review",
        agent: "reviewer",
        timeoutMs: 300_000,
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
      delegateReplyMetadata,
      syncDelegateResolvers,
      subagentSyncChildren: new Set(),
      syncDelegateLastText: new Map(),
      sessionIdFactory: () => "child-agent-sync",
    });

    const resolver = await vi.waitFor(() => {
      const current = syncDelegateResolvers.get("child-agent-sync");
      expect(current).toBeDefined();
      return current;
    });
    clearTimeout(resolver.timeout);
    syncDelegateResolvers.delete("child-agent-sync");
    resolver.resolve({
      sessionId: "child-agent-sync",
      status: "completed",
      exitCode: 0,
      finalText: "done",
    });

    await expect(promise).resolves.toEqual({
      sessionId: "child-agent-sync",
      status: "completed",
      exitCode: 0,
      finalText: "done",
    });
    expect(delegateReplyMetadata.get("child-agent-sync")).toEqual({
      task: "review the diff",
      title: "子代理: Review",
      projectPath: "/project",
      replyMode: "interrupt",
      agent: "reviewer",
      params:
        '{"title":"子代理: Review","agent":"reviewer","projectPath":"/project","replyMode":"interrupt"}',
    });
  });

  it("sets sync delegate model before sending the task", async () => {
    const syncDelegateResolvers = new Map();
    const setModel = vi.fn().mockResolvedValue({ provider: "openai", id: "gpt-4.1" });
    const send = vi.fn();

    const promise = handleCoordinatorDelegateSyncOperation({
      parentSessionId: "parent",
      msg: {
        __call: "session_delegate_sync",
        task: "review the diff",
        title: "Review",
        model: "openai/gpt-4.1",
        timeoutMs: 300_000,
      },
      getActiveManaged: () => makeManaged("idle", "/tmp/parent.jsonl"),
      start: vi.fn().mockResolvedValue({ status: "started" }),
      switchAgent: vi.fn(),
      setModel,
      setSessionName: vi.fn(),
      send,
      steer: vi.fn(),
      stop: vi.fn().mockResolvedValue(true),
      broadcastEvent: vi.fn().mockResolvedValue(undefined),
      parentChildMap: new Map(),
      delegateCreatedAt: new Map(),
      delegateReplyCount: new Map(),
      syncDelegateResolvers,
      subagentSyncChildren: new Set(),
      syncDelegateLastText: new Map(),
      sessionIdFactory: () => "child-model-sync",
    });

    const resolver = await vi.waitFor(() => {
      const current = syncDelegateResolvers.get("child-model-sync");
      expect(current).toBeDefined();
      return current;
    });
    clearTimeout(resolver.timeout);
    syncDelegateResolvers.delete("child-model-sync");
    resolver.resolve({
      sessionId: "child-model-sync",
      status: "completed",
      exitCode: 0,
      finalText: "done",
    });

    await expect(promise).resolves.toMatchObject({
      sessionId: "child-model-sync",
      status: "completed",
    });
    expect(setModel).toHaveBeenCalledWith("child-model-sync", "openai", "gpt-4.1");
    expect(setModel.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
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

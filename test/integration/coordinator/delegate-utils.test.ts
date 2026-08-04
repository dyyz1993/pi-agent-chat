/**
 * @vitest-environment node
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDelegateReplyParams,
  buildCoordinatorDelegatePrompt,
  buildCoordinatorSessionCreatedEvent,
  buildSyncDelegatePrompt,
  formatDelegateElapsed,
  prepareForkedSession,
  resolveDelegateSessionPaths,
  stripParentSessionFromHeader,
  wrapDelegateReply,
  writeDelegateSessionHeader,
} from "../../../src/shared/agent/coordinator-delegate-utils";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `pi-coordinator-utils-${Date.now()}-${tempDirs.length}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("coordinator delegate utils", () => {
  it("keeps same-project delegate sessions next to the parent session", () => {
    const root = makeTempDir();
    const parentSessionPath = path.join(root, "parent.jsonl");

    const result = resolveDelegateSessionPaths({
      parentProjectPath: "/repo/app",
      parentSessionPath,
      newSessionId: "sess_child",
    });

    expect(result).toEqual({
      projectPath: "/repo/app",
      sessionPath: path.join(root, "sess_child.jsonl"),
      isCrossProject: false,
    });
  });

  it("places cross-project delegate sessions in the global encoded sessions directory", () => {
    const homeDir = makeTempDir();

    const result = resolveDelegateSessionPaths({
      parentProjectPath: "/repo/app",
      parentSessionPath: "/repo/app/.pi/parent.jsonl",
      rawProjectPath: "/other/project",
      newSessionId: "sess_cross",
      homeDir,
    });

    expect(result.projectPath).toBe("/other/project");
    expect(result.isCrossProject).toBe(true);
    expect(result.sessionPath).toBe(
      path.join(homeDir, ".pi", "agent", "sessions", "--other-project--", "sess_cross.jsonl"),
    );
    expect(existsSync(path.dirname(result.sessionPath))).toBe(true);
  });

  it("writes delegate session header and delegate_info entries", async () => {
    const root = makeTempDir();
    const sessionPath = path.join(root, "child.jsonl");

    await writeDelegateSessionHeader({
      sessionPath,
      newSessionId: "sess_child",
      projectPath: "/repo/app",
      parentSessionId: "sess_parent",
      parentSessionPath: path.join(root, "parent.jsonl"),
      delegateType: "subagent",
      createdAt: 123,
      timestamp: "2026-06-05T00:00:00.000Z",
    });

    const [headerLine, delegateLine] = readFileSync(sessionPath, "utf-8").trim().split("\n");
    expect(JSON.parse(headerLine)).toEqual({
      type: "session",
      version: 3,
      id: "sess_child",
      timestamp: "2026-06-05T00:00:00.000Z",
      cwd: "/repo/app",
      delegateParentSessionId: "sess_parent",
    });
    expect(JSON.parse(delegateLine)).toMatchObject({
      type: "delegate_info",
      id: "delegate_info",
      parentId: null,
      timestamp: "2026-06-05T00:00:00.000Z",
      delegateParentSessionId: "sess_parent",
      delegateType: "subagent",
      createdAt: 123,
    });
  });

  it("strips parentSession from only the header entry", () => {
    const root = makeTempDir();
    const sessionPath = path.join(root, "fork.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: "sess", parentSession: "old-parent" }),
        JSON.stringify({ type: "message", parentSession: "message-parent" }),
      ].join("\n") + "\n",
      "utf-8",
    );

    stripParentSessionFromHeader(sessionPath);

    const [headerLine, messageLine] = readFileSync(sessionPath, "utf-8").trim().split("\n");
    expect(JSON.parse(headerLine)).toEqual({ type: "session", id: "sess" });
    expect(JSON.parse(messageLine)).toEqual({
      type: "message",
      parentSession: "message-parent",
    });
  });

  describe("prepareForkedSession", () => {
    const tmpDir = path.join(os.tmpdir(), "pi-test-prepare-fork");
    let forkFilePath: string;
    const forkedSessionId = "sess_fork_1234567890_abcDEF";

    beforeEach(() => {
      mkdirSync(tmpDir, { recursive: true });
      forkFilePath = path.join(tmpDir, `${forkedSessionId}.jsonl`);
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("updates header.id to the forked session id", () => {
      const originalSessionId = "67a17add-197c-4c12-8bd6-13025042d6b6";
      writeFileSync(
        forkFilePath,
        [
          JSON.stringify({ type: "session", version: 3, id: originalSessionId, cwd: "/repo" }),
          JSON.stringify({ type: "message", id: "msg1", role: "user", content: "hi" }),
        ].join("\n") + "\n",
        "utf-8",
      );

      prepareForkedSession(forkFilePath, forkedSessionId);

      const lines = readFileSync(forkFilePath, "utf-8").trim().split("\n");
      const header = JSON.parse(lines[0]);
      expect(header.id).toBe(forkedSessionId);
      expect(header.id).not.toBe(originalSessionId);
    });

    it("removes delegate_info entries that would create false child relationships", () => {
      writeFileSync(
        forkFilePath,
        [
          JSON.stringify({ type: "session", version: 3, id: "orig-123", cwd: "/repo" }),
          JSON.stringify({ type: "delegate_info", delegateParentSessionId: "orig-parent", delegateType: "fork" }),
          JSON.stringify({ type: "message", id: "msg1", role: "user", content: "hello" }),
          JSON.stringify({ type: "delegate_info", delegateParentSessionId: "orig-parent-2", delegateType: "delegate" }),
          JSON.stringify({ type: "message", id: "msg2", role: "assistant", content: "world" }),
        ].join("\n") + "\n",
        "utf-8",
      );

      prepareForkedSession(forkFilePath, forkedSessionId);

      const lines = readFileSync(forkFilePath, "utf-8").trim().split("\n");
      const types = lines.map((l) => JSON.parse(l).type);
      expect(types).not.toContain("delegate_info");
      // Messages should be preserved
      expect(types.filter((t) => t === "message").length).toBe(2);
    });

    it("adds Fork prefix to session_info name", () => {
      writeFileSync(
        forkFilePath,
        [
          JSON.stringify({ type: "session", version: 3, id: "orig-123", cwd: "/repo" }),
          JSON.stringify({ type: "session_info", name: "GLM 模型配置问题分析", cwd: "/repo" }),
          JSON.stringify({ type: "message", id: "msg1", role: "user", content: "hi" }),
        ].join("\n") + "\n",
        "utf-8",
      );

      prepareForkedSession(forkFilePath, forkedSessionId);

      const lines = readFileSync(forkFilePath, "utf-8").trim().split("\n");
      const sessionInfo = lines
        .map((l) => JSON.parse(l))
        .find((e) => e.type === "session_info");
      expect(sessionInfo.name).toContain("Fork");
      expect(sessionInfo.name).toContain("GLM 模型配置问题分析");
    });

    it("handles files with no session_info (no crash, no name change)", () => {
      writeFileSync(
        forkFilePath,
        [
          JSON.stringify({ type: "session", version: 3, id: "orig-123", cwd: "/repo" }),
          JSON.stringify({ type: "message", id: "msg1", role: "user", content: "hi" }),
        ].join("\n") + "\n",
        "utf-8",
      );

      // Should not throw
      expect(() => prepareForkedSession(forkFilePath, forkedSessionId)).not.toThrow();

      const lines = readFileSync(forkFilePath, "utf-8").trim().split("\n");
      const header = JSON.parse(lines[0]);
      expect(header.id).toBe(forkedSessionId);
    });
  });

  it("builds delegate prompts and wrapped replies with stable command text", () => {
    expect(
      buildCoordinatorDelegatePrompt({
        newSessionId: "sess_child",
        parentSessionId: "sess_parent",
        title: "指派: 检查 hooks",
        task: "检查 hooks",
        projectPath: "/repo/pi-agent-chat",
      }),
    ).toContain(`- 你的会话 ID: sess_child`);
    expect(
      buildCoordinatorDelegatePrompt({
        newSessionId: "sess_child",
        parentSessionId: "sess_parent",
        title: "指派: 检查 hooks",
        task: "检查 hooks",
        projectPath: "/repo/pi-agent-chat",
      }),
    ).toContain("委派方不会轮询你的状态");
    expect(
      buildCoordinatorDelegatePrompt({
        newSessionId: "sess_child",
        parentSessionId: "sess_parent",
        title: "指派: 检查 hooks",
        task: "检查 hooks",
        projectPath: "/repo/pi-agent-chat",
      }),
    ).toContain("最终结果发送成功后");

    expect(
      buildSyncDelegatePrompt({
        task: "运行测试",
        rawTitle: "测试",
        agent: "reviewer",
        projectPath: "/repo/pi-agent-chat",
      }),
    ).toContain(`**Agent 角色:** reviewer`);

    expect(
      wrapDelegateReply({
        sourceSessionId: "sess_child",
        targetSessionId: "sess_child",
        title: "子任务",
        sequence: 2,
        createdAt: 123,
        elapsed: "5s",
        message: "完成",
      }),
    ).toBe(
      [
        `<delegate-reply from="sess_child" sessionId="sess_child" targetSessionId="sess_child" title="子任务" sequence="2" createdAt="123" elapsed="5s" historyCount="2">`,
        "完成",
        `</delegate-reply>`,
      ].join("\n"),
    );

    expect(
      wrapDelegateReply({
        sourceSessionId: "sess_child",
        targetSessionId: "sess_parent",
        title: `子任务 "A"`,
        sequence: 1,
        createdAt: 123,
        elapsed: "5s",
        message: "完成",
        task: `检查 "hooks"`,
        agent: "reviewer",
        projectPath: "/repo/pi-agent-chat",
        replyMode: "interrupt",
        params: '{"title":"子任务 \\"A\\"","agent":"reviewer","projectPath":"/repo/pi-agent-chat","replyMode":"interrupt"}',
      }),
    ).toContain(
      `task="检查 &quot;hooks&quot;" agent="reviewer" projectPath="/repo/pi-agent-chat" replyMode="interrupt" params="{&quot;title&quot;:&quot;子任务 \\&quot;A\\&quot;&quot;,&quot;agent&quot;:&quot;reviewer&quot;,&quot;projectPath&quot;:&quot;/repo/pi-agent-chat&quot;,&quot;replyMode&quot;:&quot;interrupt&quot;}"`,
    );
  });

  it("builds a compact delegate params payload for reply cards", () => {
    expect(
      buildDelegateReplyParams({
        title: "指派: 检查 hooks",
        agent: "reviewer",
        projectPath: "/repo/pi-agent-chat",
        replyMode: "interrupt",
      }),
    ).toBe(
      '{"title":"指派: 检查 hooks","agent":"reviewer","projectPath":"/repo/pi-agent-chat","replyMode":"interrupt"}',
    );

    expect(buildDelegateReplyParams({})).toBeUndefined();
  });

  it("builds coordinator session_created events with a stable payload shape", () => {
    expect(
      buildCoordinatorSessionCreatedEvent({
        parentSessionId: "sess_parent",
        sessionId: "sess_child",
        name: "子代理: 测试",
        sessionPath: "/tmp/sess_child.jsonl",
        projectPath: "/repo/app",
        parentSessionPath: "/tmp/sess_parent.jsonl",
        delegateType: "subagent",
        firstMessage: "运行测试",
        createdAt: 456,
      }),
    ).toEqual({
      parentSessionId: "sess_parent",
      session: {
        sessionId: "sess_child",
        name: "子代理: 测试",
        sessionPath: "/tmp/sess_child.jsonl",
        projectPath: "/repo/app",
        parentSessionPath: "/tmp/sess_parent.jsonl",
        delegateParentSessionId: "sess_parent",
        delegateType: "subagent",
        messageCount: 0,
        firstMessage: "运行测试",
        createdAt: 456,
        updatedAt: 456,
        status: "running",
      },
    });
  });

  it("formats delegate reply elapsed time in seconds or minutes", () => {
    expect(formatDelegateElapsed(1_000, 16_000)).toBe("15s");
    expect(formatDelegateElapsed(1_000, 1_200)).toBe("1s");
    expect(formatDelegateElapsed(1_000, 122_000)).toBe("2m");
    expect(formatDelegateElapsed(20_000, 10_000)).toBe("0s");
  });
});

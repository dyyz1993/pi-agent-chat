/**
 * @vitest-environment node
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCoordinatorDelegatePrompt,
  buildCoordinatorSessionCreatedEvent,
  buildSyncDelegatePrompt,
  formatDelegateElapsed,
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

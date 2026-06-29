import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleCoordinatorDelegateStatusOperation } from "../../../src/shared/agent/coordinator-delegate-operations";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function makeSessionFile(entries: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-status-detail-"));
  tempDirs.push(dir);
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n"), "utf-8");
  return file;
}

describe("handleCoordinatorDelegateStatusOperation detail", () => {
  it("returns phase, waiting type, and recent message summaries for active delegates", async () => {
    const sessionPath = makeSessionFile([
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "请检查项目结构" }],
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "我正在查看目录并准备总结。" }],
        },
      },
    ]);

    const result = await handleCoordinatorDelegateStatusOperation({
      parentSessionId: "parent",
      msg: { __call: "session_delegate_status", sessionId: "child" },
      parentChildMap: new Map([["parent", new Set(["child"])]]),
      sessionPaths: new Map([["child", sessionPath]]),
      sessionProjectPaths: new Map([["child", "/tmp/project"]]),
      getStatus: () => ({ status: "streaming" }),
      getState: async () => ({ isStreaming: true, isCompacting: false }),
      getContextUsage: async () => ({ tokens: 12, contextWindow: 100, percent: 12 }),
    });

    expect(result.status).toBe("streaming");
    expect(result.detail).toEqual(
      expect.objectContaining({
        phase: "执行中",
        waitingType: "streaming",
        lastMessages: ["用户: 请检查项目结构", "助手: 我正在查看目录并准备总结。"],
      }),
    );
    expect(result.detail?.waitingSince).toEqual(expect.any(Number));
  });

  it("returns explicit not_found detail when the target is not a delegate child", async () => {
    const result = await handleCoordinatorDelegateStatusOperation({
      parentSessionId: "parent",
      msg: { __call: "session_delegate_status", sessionId: "missing" },
      parentChildMap: new Map([["parent", new Set(["child"])]]),
      sessionPaths: new Map(),
      sessionProjectPaths: new Map(),
      getStatus: () => ({ status: "idle" }),
      getState: async () => null,
      getContextUsage: async () => ({ tokens: null, contextWindow: 0, percent: null }),
    });

    expect(result.status).toBe("not_found");
    expect(result.detail).toMatchObject({
      phase: "未找到会话",
      waitingType: "not_found",
    });
  });
});

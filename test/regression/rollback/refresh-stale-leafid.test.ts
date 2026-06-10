/**
 * @vitest-environment node
 *
 * 复现并验证 "回滚后刷新数据丢失" 问题
 *
 * 场景：
 * 1. 对话有 3 轮 (e1→e2→e3→e4→e5→e6)
 * 2. 用户回滚到 e2，leafId 被设为 "e2"
 * 3. 用户继续聊了 2 轮，JSONL 里新增 e7→e8→e9→e10
 * 4. 用户刷新页面，触发 getFullMessages
 * 5. 此时 leafId 缓存还是 "e2"（旧值）
 *
 * 期望：刷新后能看到回滚点之后的新消息（e7-e10），而不是只有 e1+e2
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { AgentProcessManager } from "../../../src/shared/agent/process-manager";
import type { AgentProcessManager as APM } from "../../../src/shared/agent/process-manager";

interface InternalAPM {
  leafIds: Map<string, string | null>;
  sessionPaths: Map<string, string>;
  clients: Map<string, unknown>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

const TMP_DIR = join("/tmp", "pi-rollback-refresh-test");

function msgEntry(id: string, parentId: string | null, role: string, text: string): string {
  return JSON.stringify({
    id,
    parentId,
    type: "message",
    message: { role, content: text },
    timestamp: new Date().toISOString(),
  });
}

function compactionEntry(id: string, parentId: string | null, summary: string): string {
  return JSON.stringify({
    id,
    parentId,
    type: "message",
    message: { role: "compactionSummary", summary, tokensBefore: 10000 },
    timestamp: new Date().toISOString(),
  });
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

describe("回滚后刷新：leafId 过滤导致新消息丢失", () => {
  let manager: APM;
  let sessionFile: string;

  beforeEach(() => {
    manager = new AgentProcessManager(new MockRPCServer());
    mkdirSync(TMP_DIR, { recursive: true });
    sessionFile = join(TMP_DIR, `session-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("无 managed client 时 stale leafId 会过滤掉新消息（需要 CLI 告知最新 leafId）", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "turn-2"),
        msgEntry("e4", "e3", "assistant", "reply-2"),
        msgEntry("e5", "e4", "user", "turn-3"),
        msgEntry("e6", "e5", "assistant", "reply-3"),
        msgEntry("e7", "e2", "user", "post-rollback-msg"),
        msgEntry("e8", "e7", "assistant", "post-rollback-reply"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    internals(manager).leafIds.set("s1", "e2");

    const result = await manager.getFullMessages("s1", sessionFile);

    const hasPostRollback = result.messages.length > 2;

    if (!hasPostRollback) {
      console.log("CONFIRMED: Without managed client, stale leafId=e2 filters out e7/e8");
    }

    expect(hasPostRollback).toBe(false);
  });

  it("FIX 验证: 更新 leafId 到最新值后能拿到完整数据", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "turn-2"),
        msgEntry("e4", "e3", "assistant", "reply-2"),
        msgEntry("e5", "e4", "user", "turn-3"),
        msgEntry("e6", "e5", "assistant", "reply-3"),
        msgEntry("e7", "e2", "user", "post-rollback-msg"),
        msgEntry("e8", "e7", "assistant", "post-rollback-reply"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    internals(manager).leafIds.set("s1", "e8");

    const result = await manager.getFullMessages("s1", sessionFile);

    expect(result.messages).toHaveLength(4);
    const roles = result.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("压缩后回滚再继续聊，刷新能看到压缩摘要和新消息", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "turn-2"),
        msgEntry("e4", "e3", "assistant", "reply-2"),
        msgEntry("e5", "e4", "user", "turn-3"),
        msgEntry("e6", "e5", "assistant", "reply-3"),
        compactionEntry("e7", "e6", "压缩了前 4 条消息"),
        msgEntry("e8", "e7", "user", "post-compact"),
        msgEntry("e9", "e8", "assistant", "reply"),
        msgEntry("e10", "e7", "user", "post-rollback"),
        msgEntry("e11", "e10", "assistant", "post-rollback-reply"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    internals(manager).leafIds.set("s1", "e11");

    const result = await manager.getFullMessages("s1", sessionFile);

    const roles = result.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toContain("compactionSummary");
    expect(roles).toContain("user");
    expect(result.messages).toHaveLength(9);
    const compactionMsg = result.messages.find(
      (m: Record<string, unknown>) => m.role === "compactionSummary",
    );
    expect(compactionMsg).toBeDefined();
  });

  it("回滚到第一轮，继续聊了 10 条，刷新能看到所有新消息", async () => {
    const entries = [
      msgEntry("e1", null, "user", "first msg"),
      msgEntry("e2", "e1", "assistant", "first reply"),
    ];

    for (let i = 3; i <= 22; i++) {
      const role = i % 2 === 1 ? "user" : "assistant";
      entries.push(msgEntry(`e${i}`, `e${i - 1}`, role, `msg-${i}`));
    }

    writeFileSync(sessionFile, entries.join("\n"));
    internals(manager).sessionPaths.set("s1", sessionFile);

    internals(manager).leafIds.set("s1", "e22");

    const result = await manager.getFullMessages("s1", sessionFile);

    expect(result.messages).toHaveLength(22);
    expect(result.totalCount).toBe(22);
  });
});

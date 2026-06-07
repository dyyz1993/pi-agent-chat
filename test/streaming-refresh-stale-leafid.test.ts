/**
 * @vitest-environment node
 *
 * 复现并验证 "streaming 期间刷新丢失最新用户消息" 问题
 *
 * 场景：
 * 1. 对话有 2 轮: e1(user) → e2(assistant)
 * 2. agent_end 时 leafIds 被设为 "e2"
 * 3. 用户发送新消息 e3(user)，agent 开始 streaming
 * 4. leafIds 仍然是 "e2"（只在 agent_end 才更新）
 * 5. 用户刷新页面，触发 getFullMessages
 * 6. JSONL 已经有 e3，但 leafIds="e2" 是旧的
 *
 * BUG（修复前）：branch filter 从 e2 向上追溯 → path={e2,e1} → e3 被排除
 * FIX（修复后）：streaming 时用 activeJsonlLeafId（最后一条 JSONL entry）→ e3 在 path 中
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
  },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { AgentProcessManager } from "../src/shared/agent/process-manager";
import type { AgentProcessManager as APM } from "../src/shared/agent/process-manager";

interface InternalAPM {
  leafIds: Map<string, string | null>;
  sessionPaths: Map<string, string>;
  clients: Map<string, unknown>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

const TMP_DIR = join("/tmp", "pi-streaming-refresh-test");

function msgEntry(id: string, parentId: string | null, role: string, text: string): string {
  return JSON.stringify({
    id,
    parentId,
    type: "message",
    message: { role, content: text },
    timestamp: new Date().toISOString(),
  });
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

/** Mock a managed client in "streaming" state */
function injectStreamingManagedClient(
  manager: APM,
  sessionId: string,
  sessionPath: string,
  memoryMessages: unknown[],
): void {
  internals(manager).clients.set(sessionId, {
    client: {
      getMessages: vi.fn().mockResolvedValue(memoryMessages),
      getTreeWithLeaf: vi.fn().mockResolvedValue({ entries: [], leafId: null }),
    },
    info: {
      status: "streaming",
      sessionPath,
    },
    unsubscribe: vi.fn(),
    _activeSessionId: sessionId,
    lastActiveAt: Date.now(),
    activeBackgroundTools: new Set<string>(),
  });
}

describe("streaming 期间刷新：leafIds 过期导致最新用户消息丢失", () => {
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

  it("BUG 复现: streaming 时 stale leafIds 过滤掉了最新用户消息（修复前行为）", async () => {
    // JSONL: e1(user) → e2(assistant) → e3(user, just sent)
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi there"),
        msgEntry("e3", "e2", "user", "second question"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    // leafIds points to e2 (set at previous agent_end, NOT updated during streaming)
    internals(manager).leafIds.set("s1", "e2");

    // Mock streaming managed client with partial assistant response in memory
    injectStreamingManagedClient(manager, "s1", sessionFile, [
      { role: "user", content: "hello", entryId: "e1" },
      { role: "assistant", content: "hi there", entryId: "e2" },
      { role: "user", content: "second question", entryId: "e3" },
      { role: "assistant", content: "partial response...", entryId: "e4" },
    ]);

    const result = await manager.getFullMessages("s1", sessionFile);

    // FIX: e3 (latest user message) must be present
    const userTexts = result.messages
      .filter((m: Record<string, unknown>) => m.role === "user")
      .map((m: Record<string, unknown>) => m.content);
    expect(userTexts).toContain("second question");
  });

  it("FIX 验证: streaming 时使用 activeJsonlLeafId，最新用户消息不丢失", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi there"),
        msgEntry("e3", "e2", "user", "second question"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    internals(manager).leafIds.set("s1", "e2");

    injectStreamingManagedClient(manager, "s1", sessionFile, [
      { role: "user", content: "hello", entryId: "e1" },
      { role: "assistant", content: "hi there", entryId: "e2" },
      { role: "user", content: "second question", entryId: "e3" },
      { role: "assistant", content: "partial response...", entryId: "e4" },
    ]);

    const result = await manager.getFullMessages("s1", sessionFile);

    // All three JSONL messages + the streaming partial assistant should be present
    expect(result.messages.length).toBeGreaterThanOrEqual(3);

    const roles = result.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");

    // The latest user message must survive
    const userMessages = result.messages.filter(
      (m: Record<string, unknown>) => m.role === "user",
    );
    expect(userMessages.length).toBe(2);
    expect(
      userMessages.some((m: Record<string, unknown>) => m.content === "second question"),
    ).toBe(true);
  });

  it("非 streaming 时仍使用 leafIds（保持 rollback 功能正确）", async () => {
    // JSONL: e1 → e2 → e3 → e4 → e5(branch from e2) → e6
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "msg-1"),
        msgEntry("e2", "e1", "assistant", "reply-1"),
        msgEntry("e3", "e2", "user", "msg-2"),
        msgEntry("e4", "e3", "assistant", "reply-2"),
        msgEntry("e5", "e2", "user", "branched-msg"),
        msgEntry("e6", "e5", "assistant", "branched-reply"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    // leafIds points to e6 (branched path) — NOT streaming
    internals(manager).leafIds.set("s1", "e6");

    const result = await manager.getFullMessages("s1", sessionFile);

    // Should only see the branched path: e1, e2, e5, e6
    expect(result.messages).toHaveLength(4);
    const contents = result.messages.map((m: Record<string, unknown>) => m.content);
    expect(contents).toContain("msg-1");
    expect(contents).toContain("reply-1");
    expect(contents).toContain("branched-msg");
    expect(contents).toContain("branched-reply");
    // e3 and e4 should NOT be present (they're on a different branch)
    expect(contents).not.toContain("msg-2");
    expect(contents).not.toContain("reply-2");
  });

  it("streaming 时有多轮对话，最新用户消息不丢失", async () => {
    const entries = [
      msgEntry("e1", null, "user", "turn-1"),
      msgEntry("e2", "e1", "assistant", "reply-1"),
      msgEntry("e3", "e2", "user", "turn-2"),
      msgEntry("e4", "e3", "assistant", "reply-2"),
      msgEntry("e5", "e4", "user", "turn-3"),
      msgEntry("e6", "e5", "assistant", "reply-3"),
      msgEntry("e7", "e6", "user", "turn-4-latest"),
    ];
    writeFileSync(sessionFile, entries.join("\n"));

    internals(manager).sessionPaths.set("s1", sessionFile);
    // leafIds points to e6 (stale — agent_end of previous turn)
    internals(manager).leafIds.set("s1", "e6");

    injectStreamingManagedClient(manager, "s1", sessionFile, [
      { role: "user", content: "turn-1", entryId: "e1" },
      { role: "assistant", content: "reply-1", entryId: "e2" },
      { role: "user", content: "turn-2", entryId: "e3" },
      { role: "assistant", content: "reply-2", entryId: "e4" },
      { role: "user", content: "turn-3", entryId: "e5" },
      { role: "assistant", content: "reply-3", entryId: "e6" },
      { role: "user", content: "turn-4-latest", entryId: "e7" },
      { role: "assistant", content: "streaming...", entryId: "e8" },
    ]);

    const result = await manager.getFullMessages("s1", sessionFile);

    const userMessages = result.messages.filter(
      (m: Record<string, unknown>) => m.role === "user",
    );
    expect(userMessages.length).toBe(4);
    const lastUser = userMessages[userMessages.length - 1];
    expect(lastUser.content).toBe("turn-4-latest");
  });

  it("无 managed client 时（进程已死），leafIds 仍正常工作", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    internals(manager).leafIds.set("s1", "e2");

    // No managed client injected — simulates dead process after refresh
    const result = await manager.getFullMessages("s1", sessionFile);

    expect(result.messages).toHaveLength(2);
  });
});

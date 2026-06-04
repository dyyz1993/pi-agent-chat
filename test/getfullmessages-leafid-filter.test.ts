/**
 * TDD 测试：验证 getFullMessages 中 leafId 路径过滤的边界情况
 *
 * 场景 1：switchSession 后旧 leafId 缓存导致消息被错误过滤
 * 场景 2：回滚后继续聊天，新消息应该被正确加载
 * 场景 3：leafId 指向的节点不在 JSONL 中时，不应过滤任何消息
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── 模拟 getFullMessages 的核心过滤逻辑 ──
// 从 process-manager.ts 第 1153-1254 行提取
interface JsonlEntry {
  id: string;
  parentId: string | null;
  type: string;
  message?: { role: string };
  customType?: string;
  data?: unknown;
  timestamp?: string;
}

function parseJsonl(content: string): JsonlEntry[] {
  return content
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/**
 * 模拟 getFullMessages 的核心逻辑：
 * 1. 从 JSONL 读取所有条目
 * 2. 根据 leafId 构建 leaf→root 路径
 * 3. 只保留路径上的消息
 */
function simulateGetFullMessages(
  jsonlContent: string,
  leafId: string | null | undefined,
): {
  totalCount: number;
  filteredCount: number;
  pathFilterApplied: boolean;
  messages: Array<{ entryId: string; role: string }>;
} {
  const entries = parseJsonl(jsonlContent);

  // 收集所有消息和 parentById
  const allMessages: Array<{ entryId: string; role: string }> = [];
  const parentById = new Map<string, string | null>();

  for (const entry of entries) {
    if (entry.id) {
      parentById.set(entry.id, entry.parentId ?? null);
    }
    if (entry.type === "message" && entry.message) {
      allMessages.push({ entryId: entry.id, role: entry.message.role });
    }
  }

  // leafId 路径过滤
  let filteredMessages = allMessages;
  let pathFilterApplied = false;

  if (leafId && parentById.size > 0) {
    const pathIds = new Set<string>();
    let curId: string | null = leafId;
    // 防止循环
    const visited = new Set<string>();
    while (curId) {
      if (visited.has(curId)) break;
      visited.add(curId);
      pathIds.add(curId);
      const parent = parentById.get(curId);
      curId = parent ?? null;
    }
    filteredMessages = allMessages.filter((m) => pathIds.has(m.entryId));
    pathFilterApplied = true;
  }

  return {
    totalCount: allMessages.length,
    filteredCount: filteredMessages.length,
    pathFilterApplied,
    messages: filteredMessages,
  };
}

// ── 辅助：构造 JSONL ──
function makeEntry(
  id: string,
  parentId: string | null,
  type: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({ id, parentId, type, timestamp: new Date().toISOString(), ...extra });
}

function makeSessionHeader(sessionId: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd: "/test",
  });
}

function makeMessage(id: string, parentId: string | null, role: string): string {
  return makeEntry(id, parentId, "message", {
    message: { role, content: [], timestamp: Date.now() },
  });
}

describe("getFullMessages leafId 过滤", () => {
  beforeEach(() => {
    mkdtempSync(join(tmpdir(), "leafid-test-"));
  });

  describe("场景 1：正常加载，路径正确", () => {
    it("leafId 指向最后一条消息，应返回全部消息", () => {
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeEntry("a1", null, "model_change"),
        makeMessage("m1", "a1", "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"),
        makeMessage("m4", "m3", "assistant"),
      ].join("\n");

      const result = simulateGetFullMessages(jsonl, "m4");

      expect(result.totalCount).toBe(4);
      expect(result.filteredCount).toBe(4);
      expect(result.pathFilterApplied).toBe(true);
      expect(result.messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
    });
  });

  describe("场景 2：leafId 指向旧位置（回滚场景）", () => {
    it("leafId 指向回滚点，后续消息应该被过滤掉", () => {
      // JSONL 有分支：m2 后分叉了
      // m1 → m2 → m3 (旧路径)
      //       m2 → m4 → m5 (新路径，回滚后又继续聊)
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"), // 旧路径继续
        makeMessage("m4", "m2", "user"), // 新分支（回滚到 m2 后继续）
        makeMessage("m5", "m4", "assistant"), // 新分支的回复
      ].join("\n");

      // leafId 指向 m3（回滚到旧分支）→ 应该只看到 m1, m2, m3
      const result = simulateGetFullMessages(jsonl, "m3");

      expect(result.totalCount).toBe(5);
      expect(result.filteredCount).toBe(3);
      expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    });

    it("leafId 指向新分支末尾 → 应该只看到新分支的消息", () => {
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"), // 旧路径
        makeMessage("m4", "m2", "user"), // 新分支
        makeMessage("m5", "m4", "assistant"), // 新分支回复
      ].join("\n");

      // leafId 指向 m5（新分支末尾）
      const result = simulateGetFullMessages(jsonl, "m5");

      expect(result.filteredCount).toBe(4); // m1, m2, m4, m5
      expect(result.messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
    });
  });

  describe("场景 3：leafId 不在 JSONL 中（过期缓存）", () => {
    it("leafId 是旧的/不属于当前 JSONL → 路径为空 → 过滤后 0 条消息", () => {
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"),
        makeMessage("m4", "m3", "assistant"),
      ].join("\n");

      // leafId "stale-id" 不在 JSONL 中
      // pathIds = {"stale-id"} (空路径，因为 parentById.get("stale-id") = undefined)
      const result = simulateGetFullMessages(jsonl, "stale-id");

      expect(result.totalCount).toBe(4);
      expect(result.filteredCount).toBe(0); // ← BUG! 所有消息都被过滤掉了
      expect(result.pathFilterApplied).toBe(true);
    });

    it("这模拟了 switchSession 后旧 leafId 缓存的场景", () => {
      // 这个测试直接模拟了你遇到的问题：
      // - 会话 A 有消息 m1-m4
      // - 切到会话 B，leafIds Map 里存了 B 的 leafId
      // - 切回会话 A，但 leafIds 缓存还是 B 的 leafId
      // - getTreeWithLeaf 失败（进程忙），fallback 到旧缓存
      // → 结果：A 的消息被 B 的 leafId 过滤，全部丢失

      const jsonlA = [
        makeSessionHeader("sess-A"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
      ].join("\n");

      // 模拟：leafId 是从会话 B 缓存来的，不在 A 的 JSONL 中
      const result = simulateGetFullMessages(jsonlA, "from-session-B-leafid");

      expect(result.totalCount).toBe(2); // JSONL 确实有 2 条消息
      expect(result.filteredCount).toBe(0); // 但被错误过滤掉了！
    });
  });

  describe("场景 4：leafId 为 null/undefined 时不过滤", () => {
    it("leafId = null → 不过滤，返回全部消息", () => {
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
      ].join("\n");

      const result = simulateGetFullMessages(jsonl, null);

      expect(result.filteredCount).toBe(2);
      expect(result.pathFilterApplied).toBe(false);
    });

    it("leafId = undefined → 不过滤，返回全部消息", () => {
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
      ].join("\n");

      const result = simulateGetFullMessages(jsonl, undefined);

      expect(result.filteredCount).toBe(2);
      expect(result.pathFilterApplied).toBe(false);
    });
  });

  describe("场景 5：回滚后继续聊天，新消息的 leafId 是否正确", () => {
    it("回滚到 m2，继续聊产生 m4/m5，leafId 应指向 m5", () => {
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeMessage("m1", null, "user"), // root
        makeMessage("m2", "m1", "assistant"), // turn 1
        makeMessage("m3", "m2", "user"), // turn 2 (旧分支)
        // --- 回滚到 m2 ---
        makeMessage("m4", "m2", "user"), // 新分支 turn 2
        makeMessage("m5", "m4", "assistant"), // 新分支 turn 2 回复
      ].join("\n");

      // 正确的 leafId = m5
      const result = simulateGetFullMessages(jsonl, "m5");

      expect(result.filteredCount).toBe(4); // m1, m2, m4, m5
      expect(result.messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      expect(result.messages.map((m) => m.entryId)).toEqual(["m1", "m2", "m4", "m5"]);
    });

    it("但如果 leafId 还是旧的 m3（缓存没更新）→ 看不到新消息 m4/m5", () => {
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"), // 旧分支
        makeMessage("m4", "m2", "user"), // 新分支
        makeMessage("m5", "m4", "assistant"),
      ].join("\n");

      // leafId 过期，还是旧的 m3
      const result = simulateGetFullMessages(jsonl, "m3");

      expect(result.totalCount).toBe(5);
      expect(result.filteredCount).toBe(3); // 只看到 m1, m2, m3
      // m4 和 m5 被过滤掉了！
      expect(result.messages.map((m) => m.entryId)).toEqual(["m1", "m2", "m3"]);
    });
  });
});

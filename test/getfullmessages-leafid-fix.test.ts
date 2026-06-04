/**
 * TDD 测试：getFullMessages leafId 过滤修复验证
 *
 * Bug：当 leafId 不在 JSONL 中时（过期缓存/来自其他会话），
 *      路径过滤会把所有消息都过滤掉，返回 0 条。
 *
 * Fix：先检查 leafId 是否在 parentById 中，不在则跳过过滤。
 */
import { describe, it, expect } from "vitest";

// ── JSONL 条目 ──
interface Entry {
  id: string;
  parentId: string | null;
  type: string;
  message?: { role: string };
}

// ── 模拟修复后的过滤逻辑 ──
function filterMessagesFixed(
  jsonlLines: string[],
  leafId: string | null | undefined,
): {
  totalCount: number;
  filteredCount: number;
  pathFilterApplied: boolean;
  filteredIds: string[];
  skippedReason: string | null;
} {
  const allMessages: Array<{ entryId: string; role: string }> = [];
  const parentById = new Map<string, string | null>();

  for (const line of jsonlLines) {
    if (!line.trim()) continue;
    const entry: Entry = JSON.parse(line);
    if (entry.id) parentById.set(entry.id, entry.parentId ?? null);
    if (entry.type === "message" && entry.message) {
      allMessages.push({ entryId: entry.id, role: entry.message.role });
    }
  }

  let pathFilterApplied = false;
  let filtered = allMessages;
  let skippedReason: string | null = null;

  if (leafId && parentById.size > 0) {
    if (parentById.has(leafId)) {
      // leafId 在 JSONL 中 → 正常过滤
      const pathIds = new Set<string>();
      let curId: string | null = leafId;
      const visited = new Set<string>();
      while (curId) {
        if (visited.has(curId)) break;
        visited.add(curId);
        pathIds.add(curId);
        curId = parentById.get(curId) ?? null;
      }
      filtered = allMessages.filter((m) => pathIds.has(m.entryId));
      pathFilterApplied = true;
    } else {
      // leafId 不在 JSONL 中 → 跳过过滤，返回全部消息
      skippedReason = "leafId_not_in_jsonl";
    }
  }

  return {
    totalCount: allMessages.length,
    filteredCount: filtered.length,
    pathFilterApplied,
    filteredIds: filtered.map((m) => m.entryId),
    skippedReason,
  };
}

// ── 辅助函数 ──
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

describe("getFullMessages leafId 过滤修复", () => {
  describe("✅ 正常场景：leafId 在 JSONL 中", () => {
    it("leafId 指向最后一条 → 正确过滤，只显示当前分支", () => {
      const jsonl = [
        makeSessionHeader("s1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"),
        makeMessage("m4", "m3", "assistant"),
      ];

      const r = filterMessagesFixed(jsonl, "m4");

      expect(r.pathFilterApplied).toBe(true);
      expect(r.filteredCount).toBe(4);
      expect(r.skippedReason).toBeNull();
    });

    it("回滚场景：leafId 指向中间节点 → 只显示该分支", () => {
      const jsonl = [
        makeSessionHeader("s1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"), // 旧分支
        makeMessage("m4", "m2", "user"), // 新分支
        makeMessage("m5", "m4", "assistant"),
      ];

      // leafId = m3（回滚到旧分支）
      const r = filterMessagesFixed(jsonl, "m3");

      expect(r.pathFilterApplied).toBe(true);
      expect(r.filteredCount).toBe(3); // m1, m2, m3
      expect(r.filteredIds).toEqual(["m1", "m2", "m3"]);
    });
  });

  describe("🐛 修复：leafId 不在 JSONL 中 → 跳过过滤，返回全部消息", () => {
    it("过期缓存的 leafId → 不应该过滤掉所有消息", () => {
      const jsonl = [
        makeSessionHeader("s1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"),
        makeMessage("m4", "m3", "assistant"),
      ];

      // leafId "stale-id" 不在 JSONL 中
      const r = filterMessagesFixed(jsonl, "stale-id");

      expect(r.totalCount).toBe(4);
      expect(r.filteredCount).toBe(4); // ← 修复后：返回全部消息，不再返回 0
      expect(r.pathFilterApplied).toBe(false);
      expect(r.skippedReason).toBe("leafId_not_in_jsonl");
    });

    it("来自另一个会话的 leafId → 返回全部消息", () => {
      const jsonlA = [
        makeSessionHeader("sess-A"),
        makeMessage("a1", null, "user"),
        makeMessage("a2", "a1", "assistant"),
      ];

      // leafId 来自会话 B
      const r = filterMessagesFixed(jsonlA, "from-session-B-leafid");

      expect(r.totalCount).toBe(2);
      expect(r.filteredCount).toBe(2); // ← 修复后：不再丢失
      expect(r.skippedReason).toBe("leafId_not_in_jsonl");
    });
  });

  describe("✅ 边界情况", () => {
    it("leafId = null → 不过滤", () => {
      const jsonl = [
        makeSessionHeader("s1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
      ];

      const r = filterMessagesFixed(jsonl, null);
      expect(r.filteredCount).toBe(2);
      expect(r.pathFilterApplied).toBe(false);
      expect(r.skippedReason).toBeNull();
    });

    it("leafId = undefined → 不过滤", () => {
      const jsonl = [makeSessionHeader("s1"), makeMessage("m1", null, "user")];

      const r = filterMessagesFixed(jsonl, undefined);
      expect(r.filteredCount).toBe(1);
      expect(r.pathFilterApplied).toBe(false);
    });

    it("空 JSONL（只有 header）→ totalCount=0", () => {
      const jsonl = [makeSessionHeader("s1")];

      const r = filterMessagesFixed(jsonl, "any-id");
      expect(r.totalCount).toBe(0);
      expect(r.filteredCount).toBe(0);
    });

    it("parentById 为空 → 不过滤", () => {
      const jsonl = [makeSessionHeader("s1")];

      const r = filterMessagesFixed(jsonl, "some-id");
      expect(r.filteredCount).toBe(0);
      expect(r.pathFilterApplied).toBe(false);
    });
  });

  describe("🔄 你遇到的 14e10553 场景", () => {
    it("真实 JSONL 数据 + 过期 leafId → 修复后返回全部消息", () => {
      const jsonl = [
        makeSessionHeader("14e10553"),
        makeEntry("c41dbfa3", null, "model_change"),
        makeEntry("90cb409a", "c41dbfa3", "thinking_level_change"),
        makeEntry("4f261538", "90cb409a", "custom"),
        makeMessage("97a0f23d", "4f261538", "user"),
        makeMessage("9c10ec5b", "97a0f23d", "assistant"),
        makeMessage("af5717a8", "9c10ec5b", "toolResult"),
        makeMessage("5c80959c", "af5717a8", "assistant"),
        makeMessage("480f837f", "5c80959c", "user"),
        makeMessage("1036cf79", "480f837f", "assistant"),
        makeMessage("f8779d7b", "1036cf79", "toolResult"),
        makeMessage("a31b3e03", "f8779d7b", "assistant"),
      ];

      // 情况 1：过期 leafId "91a70c75"（不在 JSONL 中）
      const r1 = filterMessagesFixed(jsonl, "91a70c75");
      expect(r1.totalCount).toBe(8);
      expect(r1.filteredCount).toBe(8); // ← 修复前是 0，修复后是 8
      expect(r1.skippedReason).toBe("leafId_not_in_jsonl");

      // 情况 2：过期 leafId "37af4f75"（也不在 JSONL 中）
      const r2 = filterMessagesFixed(jsonl, "37af4f75");
      expect(r2.totalCount).toBe(8);
      expect(r2.filteredCount).toBe(8); // ← 修复后正确返回全部

      // 情况 3：正确的 leafId
      const r3 = filterMessagesFixed(jsonl, "a31b3e03");
      expect(r3.filteredCount).toBe(8);
      expect(r3.pathFilterApplied).toBe(true);
    });
  });
});

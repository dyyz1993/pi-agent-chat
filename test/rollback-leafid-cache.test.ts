/**
 * TDD 测试：回滚后继续聊天，getFullMessages 的 leafId 过滤行为
 *
 * 核心问题：
 *   1. navigateTree(rollback) 设置 leafIds = targetId ✅
 *   2. 继续聊天，CLI 内部 leafId 移动到新消息 ❌ 但 process-manager 的 leafIds 缓存没更新
 *   3. getFullMessages 从 CLI 拿 getTreeWithLeaf() 更新缓存 ✅
 *   4. 但如果 getTreeWithLeaf() 失败 → fallback 到旧缓存 → 新消息丢失 ❌
 *
 * 还测试了 switchSession 后 leafId 缓存的问题
 */
import { describe, it, expect, beforeEach } from "vitest";

// ── JSONL 条目 ──
interface Entry {
  id: string;
  parentId: string | null;
  type: string;
  message?: { role: string; content?: unknown[] };
  customType?: string;
  data?: unknown;
  timestamp?: string;
}

// ── 模拟 JSONL 文件内容 ──
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
    message: { role, content: [{ type: "text", text: "test" }] },
  });
}

// ── 模拟 process-manager 的 leafId 缓存 ──
class LeafIdCache {
  private cache = new Map<string, string | null>();

  // navigateTree（回滚）时调用
  onRollback(sessionId: string, targetId: string): void {
    this.cache.set(sessionId, targetId);
  }

  // switchSession 成功后 — 清除旧会话的缓存
  onSwitchSession(oldSessionId: string, newSessionId: string, newLeafId: string): void {
    // 模拟 process-manager 第 411-416 行：
    // this.clients.delete(oldSid) + this.clients.set(newSid, pooled)
    // 但注意：leafIds 没有被清理！
    // 只有 getFullMessages 调 getTreeWithLeaf 才会更新
    this.cache.set(newSessionId, newLeafId);
    // oldSessionId 的 leafId 保留了！可能是 CLI 返回的旧 leafId
  }

  // getTreeWithLeaf 成功时调用
  onGetTreeWithLeaf(sessionId: string, leafId: string): void {
    this.cache.set(sessionId, leafId);
  }

  // getTreeWithLeaf 失败时 → fallback 到缓存
  getCached(sessionId: string): string | null | undefined {
    return this.cache.get(sessionId);
  }

  // 清除
  delete(sessionId: string): void {
    this.cache.delete(sessionId);
  }
}

// ── 模拟 getFullMessages 的路径过滤 ──
function filterMessagesByLeafId(
  jsonlLines: string[],
  leafId: string | null | undefined,
): {
  totalCount: number;
  filteredCount: number;
  pathFilterApplied: boolean;
  filteredIds: string[];
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

  if (leafId && parentById.size > 0) {
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
  }

  return {
    totalCount: allMessages.length,
    filteredCount: filtered.length,
    pathFilterApplied,
    filteredIds: filtered.map((m) => m.entryId),
  };
}

describe("回滚 + 继续聊天 的 leafId 过滤问题", () => {
  let cache: LeafIdCache;

  beforeEach(() => {
    cache = new LeafIdCache();
  });

  describe("场景 A：正常回滚 → 继续聊天 → getFullMessages", () => {
    it("回滚到 m2，继续聊天产生 m4/m5，getTreeWithLeaf 正常时能看到新消息", () => {
      // JSONL: m1 → m2 → m3（旧分支）
      //              m2 → m4 → m5（回滚后新分支）
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"), // 旧分支
        makeMessage("m4", "m2", "user"), // 回滚后新消息
        makeMessage("m5", "m4", "assistant"), // 新分支回复
      ];

      // Step 1: 回滚到 m2
      cache.onRollback("sess-1", "m2");
      expect(cache.getCached("sess-1")).toBe("m2");

      // Step 2: 继续聊天，CLI 产生 m4, m5
      // process-manager 没有更新 leafIds！（代码里确实没有这个逻辑）
      // 缓存仍然是 "m2"

      // Step 3: getFullMessages 被调用
      // getTreeWithLeaf 成功 → 返回 CLI 的最新 leafId = "m5"
      cache.onGetTreeWithLeaf("sess-1", "m5");

      // 用正确的 leafId 过滤
      const result = filterMessagesByLeafId(jsonl, cache.getCached("sess-1"));
      expect(result.totalCount).toBe(5);
      expect(result.filteredCount).toBe(4); // m1, m2, m4, m5
      expect(result.filteredIds).toEqual(["m1", "m2", "m4", "m5"]);
    });

    it("回滚到 m2，继续聊天，但 getTreeWithLeaf 失败 → 缓存是旧的 m2 → 只能看到 m1, m2", () => {
      const jsonl = [
        makeSessionHeader("sess-1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"),
        makeMessage("m4", "m2", "user"), // 回滚后新消息
        makeMessage("m5", "m4", "assistant"), // 新回复
      ];

      // Step 1: 回滚到 m2
      cache.onRollback("sess-1", "m2");

      // Step 2: 继续聊天产生 m4, m5
      // 但 leafIds 缓存没有更新（仍然是 m2）

      // Step 3: getTreeWithLeaf 失败 → fallback 到缓存 (m2)
      const cachedLeafId = cache.getCached("sess-1"); // "m2"

      // 用过期的 leafId "m2" 过滤
      const result = filterMessagesByLeafId(jsonl, cachedLeafId);

      expect(result.totalCount).toBe(5);
      expect(result.filteredCount).toBe(2); // ← 只看到 m1, m2！m4/m5 丢了
      expect(result.filteredIds).toEqual(["m1", "m2"]);
      // ← BUG! 新消息 m4, m5 不可见
    });
  });

  describe("场景 B：switchSession 后旧 leafId 污染", () => {
    it("从会话 A 切到会话 B，切回 A 时用 B 的 leafId 过滤 A 的消息 → 全部丢失", () => {
      // 会话 A 初始结构: a1→a2→a3→a4，会话 B 初始结构: b1→b2
      // 回滚后 A 新增了 a5→a6（挂在 a2 下），旧分支 a3→a4 仍在 JSONL 中

      // Step 1: 会话 A 初始加载，leafId = a4
      cache.onGetTreeWithLeaf("sess-A", "a4");

      // Step 2: 切到会话 B，switchSession
      // process-manager 的 clients.delete("sess-A") + clients.set("sess-B", pooled)
      // leafId 从 CLI 的 getTreeWithLeaf 获取
      cache.onGetTreeWithLeaf("sess-B", "b2");

      // 此时 leafIds 缓存：{ "sess-A": "a4", "sess-B": "b2" }

      // Step 3: 切回会话 A，switchSession
      // clients.delete("sess-B") + clients.set("sess-A", pooled)
      // leafIds 缓存：{ "sess-A": "a4", "sess-B": "b2" }
      // "sess-A" 还是 "a4"，看起来没问题？

      // 但是！如果中间 A 的 JSONL 发生了变化（比如回滚后又追加），
      // 而且 getTreeWithLeaf 返回了新的 leafId → 更新了
      // 但如果 getTreeWithLeaf 失败了 → fallback 到 "a4"

      // 假设 A 回滚到了 a2，继续聊了 a5
      const jsonlAUpdated = [
        makeSessionHeader("sess-A"),
        makeMessage("a1", null, "user"),
        makeMessage("a2", "a1", "assistant"),
        makeMessage("a3", "a2", "user"), // 旧分支
        makeMessage("a4", "a3", "assistant"), // 旧分支
        makeMessage("a5", "a2", "user"), // 回滚后新消息
        makeMessage("a6", "a5", "assistant"), // 回滚后新回复
      ];

      // 如果 getTreeWithLeaf 失败，leafId 还是 "a4"
      const result = filterMessagesByLeafId(jsonlAUpdated, "a4");

      expect(result.totalCount).toBe(6);
      expect(result.filteredCount).toBe(4); // a1, a2, a3, a4（旧分支）
      // a5, a6 被过滤掉了！
      expect(result.filteredIds).toEqual(["a1", "a2", "a3", "a4"]);
      // ← BUG! 回滚后新消息 a5, a6 丢失
    });

    it("更糟的情况：leafId 来自另一个会话 → 0 条消息", () => {
      const jsonlA = [
        makeSessionHeader("sess-A"),
        makeMessage("a1", null, "user"),
        makeMessage("a2", "a1", "assistant"),
      ];

      // 假设因为某种 bug，leafIds["sess-A"] 被设为了 B 的 leafId
      cache.onSwitchSession("sess-A", "sess-B", "b2");
      // sess-A 的 leafId 没有被清理，但也没有被设为 B 的值
      // 实际上 switchSession 后 sess-A 的 leafId 保持不变

      // 真正的问题是：如果 sess-A 之前被 delete 了
      cache.delete("sess-A");
      // 现在 getCached("sess-A") = undefined

      // undefined 不过滤
      const result = filterMessagesByLeafId(jsonlA, undefined);
      expect(result.filteredCount).toBe(2);
      expect(result.pathFilterApplied).toBe(false);
      // 这种情况反而没问题！undefined 不会触发过滤
    });
  });

  describe("场景 C：模拟你遇到的 14e10553 会话问题", () => {
    it("首次加载 JSONL 为空 → totalCount=0 是正常的", () => {
      // 只有 session header，没有消息
      const jsonl = [makeSessionHeader("14e10553")];

      // leafId 来自 CLI 初始化（model_change 等非消息条目）
      const result = filterMessagesByLeafId(jsonl, "91a70c75");

      expect(result.totalCount).toBe(0);
      expect(result.filteredCount).toBe(0);
      // 这是正常的——JSONL 确实没有消息
    });

    it("JSONL 有消息，但 leafId 是旧的/过期的 → 所有消息丢失", () => {
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

      // 情况 1：leafId 来自另一个会话（不在 JSONL 中）
      let result = filterMessagesByLeafId(jsonl, "91a70c75");
      expect(result.totalCount).toBe(8);
      expect(result.filteredCount).toBe(0); // ← 全部丢失

      // 情况 2：leafId 是正确的
      result = filterMessagesByLeafId(jsonl, "a31b3e03");
      expect(result.totalCount).toBe(8);
      expect(result.filteredCount).toBe(8); // ← 全部正确

      // 情况 3：leafId 指向 JSONL 中存在的非消息节点
      result = filterMessagesByLeafId(jsonl, "37af4f75"); // 假设这个 ID 在路径中
      // 如果 37af4f75 不在 jsonl 中 → 0 条
      expect(result.filteredCount).toBe(0);
    });
  });

  describe("场景 D：回滚后的 leafId 更新时机", () => {
    it("回滚后 leafId=targetId，继续聊一条，leafIds 缓存应该更新但实际没有", () => {
      // 模拟完整的 rollback → chat → getFullMessages 流程

      // 初始 JSONL
      const jsonlBefore = [
        makeSessionHeader("s1"),
        makeMessage("m1", null, "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"),
        makeMessage("m4", "m3", "assistant"),
      ];

      // 1. 回滚到 m2
      cache.onRollback("s1", "m2");
      expect(cache.getCached("s1")).toBe("m2");

      // 2. 继续聊天，产生新消息
      const jsonlAfter = [
        ...jsonlBefore,
        makeMessage("m5", "m2", "user"), // 回滚后新用户消息
        makeMessage("m6", "m5", "assistant"), // 回滚后新 assistant 回复
      ];

      // 3. 此时 process-manager 的 leafIds 还是 "m2"
      // 没有任何代码在新消息写入时更新 leafIds！

      // 验证：用过期 leafId 过滤
      const resultWithStale = filterMessagesByLeafId(jsonlAfter, cache.getCached("s1"));
      expect(resultWithStale.totalCount).toBe(6);
      expect(resultWithStale.filteredCount).toBe(2); // 只看到 m1, m2
      // m5, m6 丢失！← 这是 BUG 的根源

      // 4. getFullMessages 调用 getTreeWithLeaf → 拿到正确的 leafId "m6"
      // 这时候才能正确过滤
      cache.onGetTreeWithLeaf("s1", "m6");
      const resultWithCorrect = filterMessagesByLeafId(jsonlAfter, cache.getCached("s1"));
      expect(resultWithCorrect.filteredCount).toBe(4); // m1, m2, m5, m6
    });
  });
});

/**
 * @vitest-environment node
 *
 * 回滚端到端回测系统
 *
 * 完整模拟：写入 JSONL → getFullMessages → 回滚 → 继续聊 → getFullMessages → 验证
 * 不依赖 LLM，不依赖 CLI 进程，不依赖 WebSocket
 *
 * 测试的核心链路：
 *   JSONL 文件 → process-manager.getFullMessages() → leafId 过滤 → 返回消息
 *   前端 store → loadSessionMessages → apiClient.call → 上述后端链路
 */
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
  },
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(() => Promise.resolve(undefined)),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch", "memory_prefetch_result"]),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { AgentProcessManager } from "../../../src/shared/agent/process-manager";

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  const useSessionStore = vi.importActual<
    typeof import("../../../src/mainview/stores/use-session-store")
  >("../../../src/mainview/stores/use-session-store");
  return { useSessionStore: (useSessionStore as { create: unknown }).create };
});

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: vi.fn(() => ({ startRetry: vi.fn(), endRetry: vi.fn() })) },
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

const TMP_DIR = join("/tmp", "pi-rollback-e2e-backtest");

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

class SessionBuilder {
  private entries: string[] = [];
  private lastId: string | null = null;

  user(text: string): this {
    const id = `e${this.entries.length + 1}`;
    this.entries.push(msgEntry(id, this.lastId, "user", text));
    this.lastId = id;
    return this;
  }

  assistant(text: string): this {
    const id = `e${this.entries.length + 1}`;
    this.entries.push(msgEntry(id, this.lastId, "assistant", text));
    this.lastId = id;
    return this;
  }

  forkFrom(parentEntryIndex: number, role: string, text: string): this {
    const parentId = `e${parentEntryIndex}`;
    const id = `e${this.entries.length + 1}`;
    this.entries.push(msgEntry(id, parentId, role, text));
    this.lastId = id;
    return this;
  }

  get leafId(): string {
    return this.lastId ?? "e1";
  }

  write(filePath: string): string {
    writeFileSync(filePath, this.entries.join("\n"));
    return this.lastId ?? "e1";
  }

  get entryCount(): number {
    return this.entries.length;
  }
}

describe("回滚端到端回测", () => {
  let manager: APM;
  let sessionFile: string;
  const sessionId = "backtest-session";

  beforeEach(() => {
    manager = new AgentProcessManager(new MockRPCServer());
    mkdirSync(TMP_DIR, { recursive: true });
    sessionFile = join(TMP_DIR, `session-${Date.now()}.jsonl`);
    internals(manager).sessionPaths.set(sessionId, sessionFile);
  });

  afterEach(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ============================================================
  // 测试 1: 正常对话 → 回滚 → 重新加载
  // ============================================================
  it("3 轮对话 → 回滚到第 1 轮 → getFullMessages 只返回前 2 条", async () => {
    const builder = new SessionBuilder()
      .user("你好")
      .assistant("你好！")
      .user("帮我写个函数")
      .assistant("好的")
      .user("优化一下")
      .assistant("已优化");

    builder.write(sessionFile);

    const beforeRollback = await manager.getFullMessages(sessionId, sessionFile);
    expect(beforeRollback.messages).toHaveLength(6);
    expect(beforeRollback.totalCount).toBe(6);

    internals(manager).leafIds.set(sessionId, "e2");

    const afterRollback = await manager.getFullMessages(sessionId, sessionFile);
    expect(afterRollback.messages).toHaveLength(2);
    expect(afterRollback.totalCount).toBe(2);
  });

  // ============================================================
  // 测试 2: 回滚后继续聊（新分支），leafId 更新后数据完整
  // ============================================================
  it("回滚 → 新增 2 条 → leafId 更新 → 看到完整新分支", async () => {
    const builder = new SessionBuilder()
      .user("你好")
      .assistant("你好！")
      .user("帮我写代码")
      .assistant("好的")
      .user("优化")
      .assistant("已优化")
      .forkFrom(2, "user", "换个需求")
      .forkFrom(7, "assistant", "好的，重新来");

    builder.write(sessionFile);

    internals(manager).leafIds.set(sessionId, "e8");

    const result = await manager.getFullMessages(sessionId, sessionFile);
    expect(result.messages).toHaveLength(4);
    expect(result.totalCount).toBe(4);
  });

  // ============================================================
  // 测试 3: 回滚后的 stale leafId（这是用户遇到的问题）
  // ============================================================
  it("stale leafId 只返回回滚点数据，新分支消息丢失", async () => {
    const builder = new SessionBuilder()
      .user("你好")
      .assistant("你好！")
      .user("帮我写代码")
      .assistant("好的")
      .user("优化")
      .assistant("已优化");

    builder.write(sessionFile);

    internals(manager).leafIds.set(sessionId, "e2");

    const result = await manager.getFullMessages(sessionId, sessionFile);
    expect(result.messages).toHaveLength(2);
    expect(result.totalCount).toBe(2);

    // 新增分支
    appendFileSync(sessionFile, "\n" + msgEntry("e7", "e2", "user", "新需求"));
    appendFileSync(sessionFile, "\n" + msgEntry("e8", "e7", "assistant", "新回复"));

    const staleResult = await manager.getFullMessages(sessionId, sessionFile);
    expect(staleResult.messages).toHaveLength(2);

    internals(manager).leafIds.set(sessionId, "e8");

    const freshResult = await manager.getFullMessages(sessionId, sessionFile);
    expect(freshResult.messages).toHaveLength(4);
    expect(freshResult.totalCount).toBe(4);
  });

  // ============================================================
  // 测试 4: 不存在 JSONL 中的 leafId（stale guard）
  // ============================================================
  it("不存在的 leafId 不过滤，返回全部消息", async () => {
    new SessionBuilder()
      .user("你好")
      .assistant("你好！")
      .user("写代码")
      .assistant("好的")
      .write(sessionFile);

    internals(manager).leafIds.set(sessionId, "nonexistent-id");

    const result = await manager.getFullMessages(sessionId, sessionFile);
    expect(result.messages).toHaveLength(4);
    expect(result.totalCount).toBe(4);
  });

  // ============================================================
  // 测试 5: 分页 + 回滚
  // ============================================================
  it("回滚后分页正确", async () => {
    const builder = new SessionBuilder();
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) builder.user(`msg-${i}`);
      else builder.assistant(`reply-${i}`);
    }
    builder.write(sessionFile);

    internals(manager).leafIds.set(sessionId, "e10");

    const result = await manager.getFullMessages(sessionId, sessionFile, { limit: 3 });
    expect(result.messages).toHaveLength(3);
    expect(result.totalCount).toBe(10);
    expect(result.hasMore).toBe(true);
  });

  // ============================================================
  // 测试 6: 多次来回回滚
  // ============================================================
  it("来回回滚 3 次数据始终正确", async () => {
    new SessionBuilder()
      .user("msg-1")
      .assistant("reply-1")
      .user("msg-2")
      .assistant("reply-2")
      .user("msg-3")
      .assistant("reply-3")
      .write(sessionFile);

    internals(manager).leafIds.set(sessionId, "e2");
    let r = await manager.getFullMessages(sessionId, sessionFile);
    expect(r.totalCount).toBe(2);

    internals(manager).leafIds.set(sessionId, "e4");
    r = await manager.getFullMessages(sessionId, sessionFile);
    expect(r.totalCount).toBe(4);

    internals(manager).leafIds.set(sessionId, "e6");
    r = await manager.getFullMessages(sessionId, sessionFile);
    expect(r.totalCount).toBe(6);

    internals(manager).leafIds.set(sessionId, "e2");
    r = await manager.getFullMessages(sessionId, sessionFile);
    expect(r.totalCount).toBe(2);
  });

  // ============================================================
  // 测试 7: 空会话
  // ============================================================
  it("空 JSONL 返回空消息", async () => {
    writeFileSync(sessionFile, "");

    internals(manager).leafIds.set(sessionId, null);

    const result = await manager.getFullMessages(sessionId, sessionFile);
    expect(result.messages).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  // ============================================================
  // 测试 8: 单条消息回滚
  // ============================================================
  it("只有 1 条消息时回滚到它，返回 1 条", async () => {
    new SessionBuilder().user("hello").write(sessionFile);

    internals(manager).leafIds.set(sessionId, "e1");

    const result = await manager.getFullMessages(sessionId, sessionFile);
    expect(result.messages).toHaveLength(1);
    expect(result.totalCount).toBe(1);
  });
});

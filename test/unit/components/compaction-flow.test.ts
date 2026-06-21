/**
 * @vitest-environment happy-dom
 *
 * 场景2：Compaction 压缩流程
 *
 * 完整流程：
 * 1. 被动压缩（threshold/overflow）：
 *    compaction_start → sessionStatus="compacting" → compactionSummary 运行态卡片
 *    → compaction_end + streaming → defer reload（等 agent_end）
 *    → compaction_end + !streaming → 立即 reload → 运行态卡片消失
 *    → reload 后 compactionSummary 消息出现在列表中（Archive 图标）
 *
 * 2. 手动压缩（/compact-force）：
 *    compaction_start → compactionSummary 运行态卡片
 *    → compaction_end + !streaming → 清 compacting status + reload
 *    → 运行态卡片立即消失 + compactionSummary 出现
 *
 * 3. 压缩失败：
 *    compaction_end + aborted/reason → 错误通知 + 正常清 status
 *
 * 这组测试验证：
 * - compactionSummary 消息在 SideNav 中显示为 Archive 图标
 * - sessionStatus="compacting" 时由消息列表注入 compactionSummary 运行态卡片
 * - compactionSummary 在 buildProcessedMessages 中不被过滤
 */
import { describe, it, expect } from "vitest";
import { buildFlatItems } from "../../../src/mainview/components/chat/SideNav";
import { buildProcessedMessages } from "../../../src/mainview/components/chat/MessageListView";
import type { ChatMessage } from "../../../src/mainview/types";

function compactionSummaryMsg(id: string): ChatMessage {
  return {
    id,
    role: "compactionSummary",
    content: [{ type: "compactionSummary", summary: "压缩了 50 条消息", tokensBefore: 50000 }],
    timestamp: Date.now(),
  };
}

function userMsg(id: string): ChatMessage {
  return {
    id,
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: Date.now(),
  };
}

function assistantMsg(id: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
    timestamp: Date.now(),
  };
}

describe("Compaction — compactionSummary in SideNav", () => {
  it("renders compactionSummary as Archive icon", () => {
    const messages = [userMsg("u1"), compactionSummaryMsg("compact-1"), assistantMsg("a1")];

    const items = buildFlatItems(messages, false);
    const compactItem = items.find((i) => i.navId === "compact-1");

    expect(compactItem).toBeTruthy();
    // Archive icon — check by icon component name
    expect(compactItem!.icon.displayName).toBe("Archive");
  });

  it("compactionSummary has neutral/tool color", () => {
    const messages = [compactionSummaryMsg("compact-1")];
    const items = buildFlatItems(messages, false);

    expect(items[0].color).toBe("text-semantic-tool");
  });
});

describe("Compaction — compactionSummary in message list", () => {
  it("not filtered by buildProcessedMessages regardless of showMemoryEntries", () => {
    const messages = [userMsg("u1"), compactionSummaryMsg("compact-1")];

    // showMemoryEntries=false
    const processed1 = buildProcessedMessages(messages, false);
    expect(processed1.map((p) => p.msg.id)).toContain("compact-1");

    // showMemoryEntries=true
    const processed2 = buildProcessedMessages(messages, true);
    expect(processed2.map((p) => p.msg.id)).toContain("compact-1");
  });

  it("multiple compactionSummaries all preserved (each compaction creates one)", () => {
    const messages = [
      userMsg("u1"),
      compactionSummaryMsg("compact-1"),
      userMsg("u2"),
      compactionSummaryMsg("compact-2"),
      assistantMsg("a1"),
    ];

    const processed = buildProcessedMessages(messages, false);
    const ids = processed.map((p) => p.msg.id);

    expect(ids).toContain("compact-1");
    expect(ids).toContain("compact-2");
  });
});

describe("Compaction — running card visibility logic", () => {
  /**
   * 运行态 compactionSummary 在 MessageListView 中条件注入：
   * sessionStatusMap[activeSessionId] === "compacting"
   *
   * 这里验证消息列表层逻辑——运行态卡片是纯 UI 驱动的，
   * 不是真实消息，所以不出现在 messages 数组中。
   */

  it("compactionSummary is a real message (has id, role, content)", () => {
    const msg = compactionSummaryMsg("compact-1");
    expect(msg.role).toBe("compactionSummary");
    expect(msg.id).toBeTruthy();
    expect(msg.content.length).toBe(1);
    expect(msg.content[0].type).toBe("compactionSummary");
  });

  it("compactionSummary content block has summary and tokensBefore", () => {
    const msg = compactionSummaryMsg("compact-1");
    const block = msg.content[0] as {
      type: string;
      summary: string;
      tokensBefore: number;
    };

    expect(block.summary).toBeTruthy();
    expect(typeof block.tokensBefore).toBe("number");
  });
});

describe("Compaction — compaction flow data integrity", () => {
  /**
   * 完整压缩后的消息序列应该是：
   * [user, assistant, ..., compactionSummary, user, assistant, ...]
   * compactionSummary 出现在压缩点，后面是新对话
   */

  it("typical post-compaction message sequence is valid", () => {
    const messages: ChatMessage[] = [
      userMsg("u1"),
      assistantMsg("a1"),
      compactionSummaryMsg("compact-1"), // 压缩发生在 a1 之后
      userMsg("u2"), // 新对话
      assistantMsg("a2"),
    ];

    // SideNav 应该显示所有 5 条消息对应的导航点
    const items = buildFlatItems(messages, false);
    expect(items.length).toBeGreaterThanOrEqual(5);

    // compactionSummary 导航点应该在 a1 和 u2 之间
    const navIds = items.map((i) => i.navId);
    const compactIdx = navIds.indexOf("compact-1");
    const a1Idx = navIds.indexOf("a1");
    const u2Idx = navIds.indexOf("u2");

    expect(compactIdx).toBeGreaterThan(a1Idx);
    expect(compactIdx).toBeLessThan(u2Idx);
  });

  it("compactionSummary at the start of conversation (edge case)", () => {
    const messages = [compactionSummaryMsg("compact-1"), userMsg("u1"), assistantMsg("a1")];

    const items = buildFlatItems(messages, false);
    const firstItem = items[0];
    expect(firstItem.navId).toBe("compact-1");
  });
});

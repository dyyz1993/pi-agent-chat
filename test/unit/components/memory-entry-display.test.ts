/**
 * @vitest-environment happy-dom
 *
 * 场景1：Memory entry 展示逻辑
 *
 * 核心规则（3 层控制）：
 * 1. buildProcessedMessages(showMemoryEntries=false) → memory 消息从消息列表中过滤掉
 * 2. buildProcessedMessages(showMemoryEntries=true)  → memory 消息保留，在 MessageBubble 中渲染为 MemoryCard
 * 3. buildFlatItems（SideNav）→ 当前是无条件过滤，不读 setting（潜在不一致）
 *
 * 这组测试验证：
 * - setting=false 时 memory 消息不出现在处理后的消息列表
 * - setting=true 时 memory 消息保留
 * - 不同 memory 类型（prefetch/extract/dream）的过滤行为一致
 * - 非 memory 的 custom 消息（step_snapshot/lsp_diagnostics）不受 setting 控制
 * - SideNav 当前行为：无条件过滤 memory（记录为已知行为，后续需修复一致性）
 */
import { describe, it, expect } from "vitest";
import { buildProcessedMessages } from "../../../src/mainview/components/chat/MessageListView";
import { buildFlatItems } from "../../../src/mainview/components/chat/SideNav";
import { ALL_MEMORY_TYPE_KEYS } from "../../../src/mainview/components/chat/memory-config";
import type { ChatMessage } from "../../../src/mainview/types";

function memoryMsg(id: string, customType: string): ChatMessage {
  return {
    id,
    role: "custom",
    content: [{ type: "custom", customType, data: {} }],
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

function stepSnapshotMsg(id: string): ChatMessage {
  return {
    id,
    role: "custom",
    content: [{ type: "custom", customType: "step_snapshot", data: {} }],
    timestamp: Date.now(),
  };
}

function lspMsg(id: string): ChatMessage {
  return {
    id,
    role: "custom",
    content: [{ type: "custom", customType: "lsp_diagnostics", data: {} }],
    timestamp: Date.now(),
  };
}

const ALL_MEMORY_TYPES = Array.from(ALL_MEMORY_TYPE_KEYS);

describe("Memory entry display — showMemoryEntries=false (default)", () => {
  it("filters out all memory custom messages from processed list", () => {
    const messages = [
      userMsg("u1"),
      memoryMsg("mem-1", "memory_prefetch_result"),
      assistantMsg("a1"),
      memoryMsg("mem-2", "memory_extract"),
    ];

    const processed = buildProcessedMessages(messages, false);
    const ids = processed.map((p) => p.msg.id);

    expect(ids).toContain("u1");
    expect(ids).toContain("a1");
    expect(ids).not.toContain("mem-1");
    expect(ids).not.toContain("mem-2");
  });

  it("filters out EVERY memory type defined in ALL_MEMORY_TYPE_KEYS", () => {
    const messages = ALL_MEMORY_TYPES.map((ct, i) => memoryMsg(`mem-${i}`, ct));

    const processed = buildProcessedMessages(messages, false);
    expect(processed.length).toBe(0);
  });

  it("does NOT filter non-memory custom messages (step_snapshot, lsp_diagnostics)", () => {
    const messages = [
      userMsg("u1"),
      stepSnapshotMsg("snap-1"),
      lspMsg("lsp-1"),
      memoryMsg("mem-1", "memory_prefetch"),
    ];

    const processed = buildProcessedMessages(messages, false);
    const ids = processed.map((p) => p.msg.id);

    expect(ids).toContain("u1");
    expect(ids).toContain("snap-1");
    expect(ids).toContain("lsp-1");
    expect(ids).not.toContain("mem-1");
  });
});

describe("Memory entry display — showMemoryEntries=true (debug mode)", () => {
  it("includes memory custom messages in processed list", () => {
    const messages = [
      userMsg("u1"),
      memoryMsg("mem-1", "memory_prefetch_result"),
      memoryMsg("mem-2", "memory_extract"),
      memoryMsg("mem-3", "memory_dream"),
      assistantMsg("a1"),
    ];

    const processed = buildProcessedMessages(messages, true);
    const ids = processed.map((p) => p.msg.id);

    expect(ids).toContain("u1");
    expect(ids).toContain("a1");
    expect(ids).toContain("mem-1");
    expect(ids).toContain("mem-2");
    expect(ids).toContain("mem-3");
  });

  it("includes ALL memory types when setting is on", () => {
    const messages = ALL_MEMORY_TYPES.map((ct, i) => memoryMsg(`mem-${i}`, ct));
    const processed = buildProcessedMessages(messages, true);
    expect(processed.length).toBe(ALL_MEMORY_TYPES.length);
  });
});

describe("Memory entry display — SideNav behavior (known inconsistency)", () => {
  /**
   * 已知行为：SideNav 的 buildFlatItems 无条件过滤 memory 类型（第 65 行），
   * 不读 showMemoryEntries setting。这意味着当用户在 Settings 中开启了
   * "显示记忆卡片"后，消息列表会显示 memory 卡片，但 SideNav 中没有
   * 对应的导航图标——这是一个一致性 bug。
   *
   * 这个测试记录当前行为，后续修复时需要更新。
   */

  it("SideNav filters memory even when showMemoryEntries would be true", () => {
    const messages = [
      userMsg("u1"),
      memoryMsg("mem-1", "memory_prefetch_result"),
      assistantMsg("a1"),
    ];

    // buildFlatItems 不接受 showMemoryEntries 参数 — 无条件过滤
    const items = buildFlatItems(messages, false);
    const navIds = items.map((i) => i.navId);

    expect(navIds).toContain("u1");
    expect(navIds).toContain("a1");
    expect(navIds).not.toContain("mem-1");
  });

  it("SideNav includes non-memory custom messages", () => {
    const messages = [
      userMsg("u1"),
      stepSnapshotMsg("snap-1"),
      lspMsg("lsp-1"),
    ];

    const items = buildFlatItems(messages, false);
    const navIds = items.map((i) => i.navId);

    expect(navIds).toContain("u1");
    expect(navIds).toContain("snap-1");
    expect(navIds).toContain("lsp-1");
  });
});

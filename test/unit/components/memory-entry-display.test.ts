/**
 * @vitest-environment happy-dom
 *
 * 场景1：Memory entry 展示逻辑
 *
 * 核心规则（3 层控制）：
 * 1. buildProcessedMessages(showMemoryEntries=false) → memory 消息从消息列表中过滤掉
 * 2. buildProcessedMessages(showMemoryEntries=true)  → memory 消息保留，在 MessageBubble 中渲染为 MemoryCard
 * 3. buildFlatItems(showMemoryEntries=true) → SideNav 显示 memory 导航图标
 *
 * 这组测试验证：
 * - setting=false 时 memory 消息不出现在处理后的消息列表
 * - setting=true 时 memory 消息保留
 * - 不同 memory 类型（prefetch/extract/dream）的过滤行为一致
 * - 非 memory 的 custom 消息（step_snapshot/lsp_diagnostics）不受 setting 控制
 * - SideNav 与消息列表使用相同的 showMemoryEntries 开关
 */
import { describe, it, expect } from "vitest";
import { buildProcessedMessages } from "../../../src/mainview/components/chat/MessageListView";
import { buildFlatItems } from "../../../src/mainview/components/chat/SideNav";
import {
  ALL_MEMORY_TYPE_KEYS,
  ENTRY_TYPE_KEYS,
} from "../../../src/mainview/components/chat/memory-config";
import type { ChatMessage } from "../../../src/mainview/types";

function memoryMsg(id: string, customType: string): ChatMessage {
  return {
    id,
    role: "custom",
    content: [{ type: "custom", customType, data: {} }],
    timestamp: Date.now(),
  };
}

function memoryInjectMsg(id: string): ChatMessage {
  return {
    id,
    role: "custom",
    content: [
      {
        type: "custom",
        customType: "memory_inject",
        data: {
          operationId: "memory-prefetch-1",
          fingerprint: "feedback.md|435",
          selectedFiles: ["feedback.md"],
          injectedBytes: 435,
        },
      },
    ],
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
const RENDERABLE_MEMORY_TYPES = Array.from(ENTRY_TYPE_KEYS);

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
    const messages = RENDERABLE_MEMORY_TYPES.map((ct, i) => memoryMsg(`mem-${i}`, ct));
    const processed = buildProcessedMessages(messages, true);
    expect(processed.length).toBe(RENDERABLE_MEMORY_TYPES.length);
  });

  it("deduplicates repeated memory injection cards even when memory entries are visible", () => {
    const messages = [
      assistantMsg("assistant-1"),
      memoryInjectMsg("inject-1"),
      memoryMsg("save-memory", "memory_extract"),
      memoryInjectMsg("inject-2"),
      assistantMsg("assistant-2"),
    ];

    const processed = buildProcessedMessages(messages, true);
    expect(processed.map((p) => p.msg.id)).toEqual([
      "assistant-1",
      "inject-1",
      "save-memory",
      "assistant-2",
    ]);
  });
});

describe("Memory entry display — SideNav behavior", () => {
  it("SideNav filters memory when showMemoryEntries is false", () => {
    const messages = [
      userMsg("u1"),
      memoryMsg("mem-1", "memory_prefetch_result"),
      assistantMsg("a1"),
    ];

    const items = buildFlatItems(messages, false);
    const navIds = items.map((i) => i.navId);

    expect(navIds).toContain("u1");
    expect(navIds).toContain("a1");
    expect(navIds).not.toContain("mem-1");
  });

  it("SideNav includes memory when showMemoryEntries is true", () => {
    const messages = [
      userMsg("u1"),
      memoryMsg("mem-1", "memory_prefetch_result"),
      assistantMsg("a1"),
    ];

    const items = buildFlatItems(messages, false, true);
    const navIds = items.map((i) => i.navId);

    expect(navIds).toContain("u1");
    expect(navIds).toContain("mem-1");
    expect(navIds).toContain("a1");
  });

  it("SideNav deduplicates repeated memory injection icons", () => {
    const items = buildFlatItems(
      [
        assistantMsg("assistant-1"),
        memoryInjectMsg("inject-1"),
        memoryMsg("save-memory", "memory_extract"),
        memoryInjectMsg("inject-2"),
        assistantMsg("assistant-2"),
      ],
      false,
      true,
    );

    const navIds = items.map((i) => i.navId);
    expect(navIds).toContain("inject-1");
    expect(navIds).toContain("save-memory");
    expect(navIds).not.toContain("inject-2");
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

  it("SideNav ignores unknown custom messages instead of rendering them as thinking", () => {
    const messages: ChatMessage[] = [
      userMsg("u1"),
      {
        id: "internal-1",
        role: "custom",
        content: [{ type: "custom", customType: "internal_unmapped_event", data: {} }],
        timestamp: Date.now(),
      },
      assistantMsg("a1"),
    ];

    const items = buildFlatItems(messages, true);
    const navIds = items.map((i) => i.navId);

    expect(navIds).toContain("u1");
    expect(navIds).toContain("a1");
    expect(navIds).not.toContain("internal-1");
  });
});

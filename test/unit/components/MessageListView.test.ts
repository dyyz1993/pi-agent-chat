import { describe, expect, it } from "vitest";

import { buildProcessedMessages } from "../../../src/mainview/components/chat/MessageListView";
import { buildFlatItems } from "../../../src/mainview/components/chat/SideNav";
import type { ChatMessage } from "../../../src/mainview/types";

function customMessage(id: string, customType: string): ChatMessage {
  return {
    id,
    role: "custom",
    content: [{ type: "custom", customType, data: {} }],
    timestamp: 1000,
  };
}

function userMessage(id: string): ChatMessage {
  return {
    id,
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: 1000,
  };
}

describe("MessageListView message processing", () => {
  it("filters memory custom entries from the main chat list", () => {
    const processed = buildProcessedMessages(
      [
        customMessage("mem-search", "memory_prefetch_result"),
        customMessage("mem-save", "memory_extract"),
        customMessage("mem-organize", "memory_dream"),
        customMessage("mem-created", "memory_created"),
        customMessage("mem-failed", "memory_failed"),
        userMessage("visible"),
      ],
      false,
    );

    expect(processed.map((item) => item.msg.id)).toEqual(["visible"]);
  });

  it("filters memory custom entries from side navigation when disabled", () => {
    const items = buildFlatItems(
      [
        customMessage("mem-search", "memory_prefetch_result"),
        customMessage("mem-save", "memory_extract"),
        userMessage("visible"),
      ],
      true,
    );

    expect(items.map((item) => item.navId)).toEqual(["visible"]);
  });

  it("shows memory custom entries in side navigation when enabled", () => {
    const items = buildFlatItems(
      [
        customMessage("mem-search", "memory_prefetch_result"),
        customMessage("mem-save", "memory_extract"),
        userMessage("visible"),
      ],
      true,
      true,
    );

    expect(items.map((item) => item.navId)).toEqual(["mem-search", "mem-save", "visible"]);
  });

  it("hides leading orphan memory custom entries while loading older history", () => {
    const processed = buildProcessedMessages(
      [
        customMessage("mem-search", "memory_prefetch_result"),
        customMessage("mem-save", "memory_extract"),
        userMessage("visible"),
        customMessage("mem-after-user", "memory_inject"),
      ],
      true,
      { hideLeadingOrphanMemoryEntries: true },
    );

    expect(processed.map((item) => item.msg.id)).toEqual(["visible", "mem-after-user"]);
  });

  it("keeps memory search under the user turn and pushes memory inject after the assistant turn", () => {
    const processed = buildProcessedMessages(
      [
        userMessage("u1"),
        customMessage("mem-search", "memory_prefetch_result"),
        {
          id: "a1",
          role: "assistant",
          content: [{ type: "text", text: "我来处理。" }],
          timestamp: 1001,
        },
        customMessage("mem-inject", "memory_inject"),
      ],
      true,
    );

    expect(processed.map((item) => item.msg.id)).toEqual(["u1", "mem-search", "a1", "mem-inject"]);
  });

  it("reanchors memory search ahead of the assistant reply even if it arrived later in the raw stream", () => {
    const processed = buildProcessedMessages(
      [
        userMessage("u1"),
        {
          id: "a1",
          role: "assistant",
          content: [{ type: "text", text: "我来处理。" }],
          timestamp: 1001,
        },
        customMessage("mem-search", "memory_prefetch_result"),
        customMessage("mem-reuse", "memory_inject"),
      ],
      true,
    );

    expect(processed.map((item) => item.msg.id)).toEqual(["u1", "mem-search", "a1", "mem-reuse"]);
  });

  it("hides the weaker duplicate memory search operation for the same query in the same turn", () => {
    const processed = buildProcessedMessages(
      [
        userMessage("u1"),
        {
          id: "mem-search-rich",
          role: "custom",
          content: [
            {
              type: "custom",
              customType: "memory_prefetch_result",
              data: {
                operationId: "op-rich",
                _prefetchQuery: "请创建一个子会话来完成任务",
                occurredAt: 1_100,
                layer: "llm",
                injectedBytes: 11 * 1024,
                selectedFiles: Array.from({ length: 16 }, (_, i) => `f-${i}.md`),
              },
            },
          ],
          timestamp: 1_200,
        },
        {
          id: "mem-search-thin",
          role: "custom",
          content: [
            {
              type: "custom",
              customType: "memory_prefetch_result",
              data: {
                operationId: "op-thin",
                _prefetchQuery: "请创建一个子会话来完成任务",
                occurredAt: 1_180,
                layer: "auto",
                injectedBytes: 0,
                selectedFiles: ["thin.md"],
              },
            },
          ],
          timestamp: 1_250,
        },
        {
          id: "mem-inject-thin",
          role: "custom",
          content: [
            {
              type: "custom",
              customType: "memory_inject",
              data: {
                operationId: "op-thin",
                fingerprint: "thin.md|70",
                occurredAt: 1_210,
                skipped: true,
                alreadyInjected: true,
              },
            },
          ],
          timestamp: 1_260,
        },
        {
          id: "a1",
          role: "assistant",
          content: [{ type: "text", text: "我来处理。" }],
          timestamp: 2_000,
        },
      ],
      true,
    );

    expect(processed.map((item) => item.msg.id)).toEqual(["u1", "mem-search-rich", "a1"]);
  });
});

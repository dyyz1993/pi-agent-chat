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
});

import { describe, expect, it } from "vitest";

import { buildProcessedMessages } from "../src/mainview/components/chat/MessageListView";
import { buildFlatItems } from "../src/mainview/components/chat/SideNav";
import type { ChatMessage } from "../src/mainview/types";

function customMessage(id: string, customType: string): ChatMessage {
  return {
    id,
    role: "custom",
    content: [{ type: "custom", customType, data: {} }],
    timestamp: 1000,
  };
}

describe("MessageListView message processing", () => {
  it("filters memory custom entries from the main chat list", () => {
    const processed = buildProcessedMessages([
      customMessage("mem-search", "memory_prefetch_result"),
      customMessage("mem-save", "memory_extract"),
      customMessage("mem-organize", "memory_dream"),
      customMessage("visible", "bash_background_exit"),
    ]);

    expect(processed.map((item) => item.msg.id)).toEqual(["visible"]);
  });

  it("filters memory custom entries from side navigation", () => {
    const items = buildFlatItems(
      [
        customMessage("mem-search", "memory_prefetch_result"),
        customMessage("mem-save", "memory_extract"),
        customMessage("visible", "bash_background_exit"),
      ],
      true,
    );

    expect(items.map((item) => item.navId)).toEqual(["visible"]);
  });
});

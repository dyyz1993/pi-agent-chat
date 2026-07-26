import { describe, expect, it } from "vitest";

import { messageToChatMessage } from "../../../src/mainview/lib/message-mapper";

describe("messageToChatMessage stable ids", () => {
  it("uses entryId as the frontend id when raw id is absent", () => {
    const raw = {
      role: "user",
      entryId: "entry-1",
      content: [{ type: "text", text: "repeatable history message" }],
      timestamp: 1,
    };

    const first = messageToChatMessage(raw as never);
    const second = messageToChatMessage(raw as never);

    expect(first?.id).toBe("entry-1");
    expect(second?.id).toBe("entry-1");
    expect(first?.entryId).toBe("entry-1");
  });

  it("keeps explicit raw ids when they are provided by the backend", () => {
    const raw = {
      role: "assistant",
      id: "message-1",
      entryId: "entry-1",
      content: [{ type: "text", text: "assistant message" }],
      timestamp: 1,
    };

    const mapped = messageToChatMessage(raw as never, raw.id);

    expect(mapped?.id).toBe("message-1");
    expect(mapped?.entryId).toBe("entry-1");
  });
});

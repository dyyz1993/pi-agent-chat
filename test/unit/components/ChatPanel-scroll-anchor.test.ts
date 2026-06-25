import { describe, expect, it } from "vitest";
import { computeTopLoadRestoredScrollTop } from "../../../src/mainview/components/chat/ChatPanel";

describe("ChatPanel top-load scroll anchor", () => {
  it("keeps the viewport anchored after older messages are prepended", () => {
    expect(
      computeTopLoadRestoredScrollTop(
        { sessionId: "sess-1", scrollHeight: 1_000, scrollTop: 40 },
        1_650,
      ),
    ).toBe(690);
  });

  it("does not move upward when the measured height shrinks", () => {
    expect(
      computeTopLoadRestoredScrollTop(
        { sessionId: "sess-1", scrollHeight: 1_000, scrollTop: 40 },
        980,
      ),
    ).toBe(40);
  });
});

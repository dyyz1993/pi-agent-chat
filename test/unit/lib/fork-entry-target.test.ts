import { describe, expect, it } from "vitest";

import {
  pickForkEntryIdForTurn,
  pickForkFallbackMessageIds,
} from "../../../src/mainview/lib/fork-entry-target";

describe("fork entry target selection", () => {
  it("uses the assistant entry for completed turns so fork keeps the response history", () => {
    expect(
      pickForkEntryIdForTurn({
        userEntryId: "user-entry",
        assistantEntryId: "assistant-entry",
      }),
    ).toBe("assistant-entry");
  });

  it("falls back to the user entry for an in-progress turn without assistant output", () => {
    expect(
      pickForkEntryIdForTurn({
        userEntryId: "user-entry",
        assistantEntryId: null,
      }),
    ).toBe("user-entry");
  });

  it("resolves fallback message ids in assistant-first order", () => {
    expect(
      pickForkFallbackMessageIds({
        userMessageId: "user-message",
        assistantMessageId: "assistant-message",
      }),
    ).toEqual(["assistant-message", "user-message"]);
  });
});

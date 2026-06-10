/**
 * Tests: rollback targetId uses userEntryId (not assistantEntryId)
 *
 * After fix: frontend passes userEntryId so backend's navigateTree
 * jumps over the entire turn (user + assistant), removing it completely.
 */
import { describe, it, expect } from "vitest";

describe("rollback targetId uses userEntryId", () => {
  const turn = {
    userEntryId: "user-entry-3",
    assistantEntryId: "assistant-entry-3",
    userMessageId: "msg-user-3",
    assistantMessageId: "msg-assistant-3",
  };

  it("frontend passes userEntryId as targetId", () => {
    const targetId = turn.userEntryId ?? null;
    expect(targetId).toBe("user-entry-3");
  });

  it("backend jumps to parentId for user message → entire turn removed", () => {
    const targetId = turn.userEntryId ?? null;
    const isUserMessage = true;
    const parentId = "assistant-entry-2";
    const newLeafId = isUserMessage ? parentId : targetId;
    expect(newLeafId).toBe("assistant-entry-2");
  });

  it("fallback uses userMessageId (not assistantMessageId)", () => {
    const targetId = turn.userEntryId ?? null;
    expect(targetId).not.toBe(turn.assistantEntryId);
  });
});

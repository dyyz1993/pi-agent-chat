import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../src/mainview/types";
import { getDisplayedMessagesForChatPanel } from "../../../src/mainview/components/chat/ChatPanel";

function msg(id: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content: [{ type: "text", text: id }],
    timestamp: 1,
  };
}

describe("ChatPanel displayed message source", () => {
  it("prefers the active subagent session messages from messagesBySession", () => {
    const main = [msg("main-1")];
    const sub = [msg("sub-1")];

    expect(
      getDisplayedMessagesForChatPanel({
        activeSessionId: "main-session",
        activeSubsessionId: "sub-session",
        messagesBySession: {
          "main-session": main,
          "sub-session": sub,
        },
      }),
    ).toBe(sub);
  });

  it("falls back to the active main session when no subagent is open", () => {
    const main = [msg("main-1")];

    expect(
      getDisplayedMessagesForChatPanel({
        activeSessionId: "main-session",
        activeSubsessionId: null,
        messagesBySession: {
          "main-session": main,
        },
      }),
    ).toBe(main);
  });

  it("returns an empty list when the target session has no loaded history yet", () => {
    expect(
      getDisplayedMessagesForChatPanel({
        activeSessionId: "main-session",
        activeSubsessionId: "sub-session",
        messagesBySession: {},
      }),
    ).toEqual([]);
  });
});

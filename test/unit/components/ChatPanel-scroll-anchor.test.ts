import { describe, expect, it } from "vitest";
import {
  computeTopLoadRestoredScrollTop,
  shouldHideMessageSurfaceUntilInitialBottom,
  shouldStartTopLoad,
} from "../../../src/mainview/components/chat/ChatPanel";

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

describe("ChatPanel initial bottom-first surface", () => {
  it("hides the message surface until the active session reaches its initial bottom position", () => {
    expect(
      shouldHideMessageSurfaceUntilInitialBottom({
        effectiveSessionId: "sess-1",
        messageCount: 3,
        initialScrollCompleteSessionId: null,
      }),
    ).toBe(true);

    expect(
      shouldHideMessageSurfaceUntilInitialBottom({
        effectiveSessionId: "sess-1",
        messageCount: 3,
        initialScrollCompleteSessionId: "sess-1",
      }),
    ).toBe(false);
  });

  it("does not hide empty or unbound message surfaces", () => {
    expect(
      shouldHideMessageSurfaceUntilInitialBottom({
        effectiveSessionId: "sess-1",
        messageCount: 0,
        initialScrollCompleteSessionId: null,
      }),
    ).toBe(false);

    expect(
      shouldHideMessageSurfaceUntilInitialBottom({
        effectiveSessionId: null,
        messageCount: 3,
        initialScrollCompleteSessionId: null,
      }),
    ).toBe(false);
  });
});

describe("ChatPanel top-load trigger guard", () => {
  it("loads only once while the viewport remains at the top", () => {
    expect(
      shouldStartTopLoad({
        activeSessionId: "sess-1",
        isAtTop: true,
        hasMoreMessages: true,
        isLoadingMore: false,
        isViewingSubagent: false,
        initialScrollComplete: true,
        lockedSessionId: null,
      }),
    ).toBe(true);

    expect(
      shouldStartTopLoad({
        activeSessionId: "sess-1",
        isAtTop: true,
        hasMoreMessages: true,
        isLoadingMore: false,
        isViewingSubagent: false,
        initialScrollComplete: true,
        lockedSessionId: "sess-1",
      }),
    ).toBe(false);
  });

  it("does not load older messages before the initial bottom scroll completes", () => {
    expect(
      shouldStartTopLoad({
        activeSessionId: "sess-1",
        isAtTop: true,
        hasMoreMessages: true,
        isLoadingMore: false,
        isViewingSubagent: false,
        initialScrollComplete: false,
        lockedSessionId: null,
      }),
    ).toBe(false);
  });

  it("does not load while already loading or in subagent view", () => {
    expect(
      shouldStartTopLoad({
        activeSessionId: "sess-1",
        isAtTop: true,
        hasMoreMessages: true,
        isLoadingMore: true,
        isViewingSubagent: false,
        initialScrollComplete: true,
        lockedSessionId: null,
      }),
    ).toBe(false);

    expect(
      shouldStartTopLoad({
        activeSessionId: "sess-1",
        isAtTop: true,
        hasMoreMessages: true,
        isLoadingMore: false,
        isViewingSubagent: true,
        initialScrollComplete: true,
        lockedSessionId: null,
      }),
    ).toBe(false);
  });
});

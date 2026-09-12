import { describe, expect, it } from "vitest";
import {
  shouldBlockComposerForRemoteDisconnect,
  shouldClearTopLoadLock,
  shouldHideMessageSurfaceUntilInitialBottom,
  shouldStartFocusedTopLoad,
  shouldStartTopLoad,
} from "../../../src/mainview/components/chat/ChatPanel";

describe("ChatPanel top-load scroll anchoring", () => {
  // Prepend anchoring moved into the virtualizer (virtua `shift` prop,
  // derived in MessageListView): the manual capture/restore chain was
  // removed because its multi-frame corrections caused visible jumps.
  // Structural guard: none of the removed machinery may creep back in
  // alongside the shift-based anchoring.
  it("no longer contains the manual capture/restore scroll chain", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/mainview/components/chat/ChatPanel.tsx", "utf-8"),
    );
    expect(source).not.toContain("captureTopLoadScrollAnchor");
    expect(source).not.toContain("restoreTopLoadScrollAnchor");
    expect(source).not.toContain("correctTopLoadAnchorAfterRender");
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

  it("reveals the message surface after the initial-scroll grace fallback", () => {
    expect(
      shouldHideMessageSurfaceUntilInitialBottom({
        effectiveSessionId: "sess-1",
        messageCount: 3,
        initialScrollCompleteSessionId: null,
        revealFallbackSessionId: "sess-1",
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

describe("ChatPanel top-load lock release", () => {
  // Regression: the lock used to clear only when content shifted the viewport
  // away from the top. A duplicate/no-shift page left the viewport at the top
  // forever, permanently blocking the next page-up.
  it("releases the lock once the load finishes, even if still at the top", () => {
    expect(
      shouldClearTopLoadLock({
        activeSessionId: "sess-1",
        lockedSessionId: "sess-1",
        isAtTop: true,
        hasMoreMessages: true,
        isLoadingMore: false,
        isViewingSubagent: false,
        messageViewMode: "tail",
      }),
    ).toBe(true);
  });

  it("keeps the lock while the load is in flight", () => {
    expect(
      shouldClearTopLoadLock({
        activeSessionId: "sess-1",
        lockedSessionId: "sess-1",
        isAtTop: true,
        hasMoreMessages: true,
        isLoadingMore: true,
        isViewingSubagent: false,
        messageViewMode: "tail",
      }),
    ).toBe(false);
  });

  it("releases the lock when the viewport leaves the top", () => {
    expect(
      shouldClearTopLoadLock({
        activeSessionId: "sess-1",
        lockedSessionId: "sess-1",
        isAtTop: false,
        hasMoreMessages: true,
        isLoadingMore: true,
        isViewingSubagent: false,
        messageViewMode: "tail",
      }),
    ).toBe(true);
  });

  it("releases a stale lock from another session", () => {
    expect(
      shouldClearTopLoadLock({
        activeSessionId: "sess-2",
        lockedSessionId: "sess-1",
        isAtTop: true,
        hasMoreMessages: true,
        isLoadingMore: true,
        isViewingSubagent: false,
        messageViewMode: "tail",
      }),
    ).toBe(true);
  });
});

describe("ChatPanel focused-window top load", () => {
  it("continues loading older pages in focus mode when scrolled to the top", () => {
    expect(
      shouldStartFocusedTopLoad({
        messageViewMode: "focus",
        isAtTop: true,
        isViewingSubagent: false,
        hasMoreBefore: true,
        isLoadingMore: false,
      }),
    ).toBe(true);
  });

  it("does not continue while loading or without an older page", () => {
    expect(
      shouldStartFocusedTopLoad({
        messageViewMode: "focus",
        isAtTop: true,
        isViewingSubagent: false,
        hasMoreBefore: true,
        isLoadingMore: true,
      }),
    ).toBe(false);

    expect(
      shouldStartFocusedTopLoad({
        messageViewMode: "focus",
        isAtTop: true,
        isViewingSubagent: false,
        hasMoreBefore: false,
        isLoadingMore: false,
      }),
    ).toBe(false);
  });

  it("does not trigger outside the top edge, in tail mode, or in subagent view", () => {
    expect(
      shouldStartFocusedTopLoad({
        messageViewMode: "focus",
        isAtTop: false,
        isViewingSubagent: false,
        hasMoreBefore: true,
        isLoadingMore: false,
      }),
    ).toBe(false);

    expect(
      shouldStartFocusedTopLoad({
        messageViewMode: "tail",
        isAtTop: true,
        isViewingSubagent: false,
        hasMoreBefore: true,
        isLoadingMore: false,
      }),
    ).toBe(false);

    expect(
      shouldStartFocusedTopLoad({
        messageViewMode: "focus",
        isAtTop: true,
        isViewingSubagent: true,
        hasMoreBefore: true,
        isLoadingMore: false,
      }),
    ).toBe(false);
  });
});

describe("ChatPanel remote disconnect guard", () => {
  it("blocks composer input for disconnected remote projects", () => {
    expect(
      shouldBlockComposerForRemoteDisconnect({
        projectRuntime: "ssh",
        projectConnected: false,
      }),
    ).toBe(true);

    expect(
      shouldBlockComposerForRemoteDisconnect({
        hasRemoteProjectRef: true,
        remoteConnectionStatus: "error",
      }),
    ).toBe(true);
  });

  it("does not block local projects or remote projects that are still connecting", () => {
    expect(
      shouldBlockComposerForRemoteDisconnect({
        projectRuntime: undefined,
        remoteConnectionStatus: "error",
      }),
    ).toBe(false);

    expect(
      shouldBlockComposerForRemoteDisconnect({
        projectRuntime: "ssh",
        remoteConnectionStatus: "connecting",
      }),
    ).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeTopLoadRestoredScrollTop,
  computeTopLoadRestoredVirtualOffset,
  hasTopLoadAnchorContentShifted,
  shouldBlockComposerForRemoteDisconnect,
  shouldHideMessageSurfaceUntilInitialBottom,
  shouldStartTopLoad,
} from "../../../src/mainview/components/chat/ChatPanel";

const root = process.cwd();

function readSource(path: string) {
  return readFileSync(join(root, path), "utf-8");
}

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

  it("can restore by message item offset instead of total scroll height", () => {
    expect(computeTopLoadRestoredVirtualOffset({ messageTop: 24 }, 650)).toBe(626);
  });

  it("waits for prepended content instead of clearing the anchor on loading state alone", () => {
    const anchor = {
      sessionId: "sess-1",
      scrollHeight: 1_000,
      scrollTop: 0,
      messageId: "m10",
      messageIndex: 0,
      messageTop: 0,
    };

    expect(hasTopLoadAnchorContentShifted(anchor, ["m10", "m11"], 1_020)).toBe(false);
    expect(hasTopLoadAnchorContentShifted(anchor, ["m8", "m9", "m10", "m11"], 1_500)).toBe(true);
  });

  it("restores top-load scroll position from a message anchor and settles after render", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");
    const restoreEffectSection = source.slice(
      source.indexOf("const captureTopLoadScrollAnchor"),
      source.indexOf("const seekToAbsoluteTop"),
    );

    expect(restoreEffectSection).toContain("getTopVisibleMessageAnchor");
    expect(restoreEffectSection).toContain("hasTopLoadAnchorContentShifted");
    expect(restoreEffectSection).toContain("computeTopLoadRestoredVirtualOffset");
    expect(restoreEffectSection).toContain("computeTopLoadRestoredScrollTop");
    expect(restoreEffectSection).toContain("correctTopLoadAnchorAfterRender");
    expect(restoreEffectSection).toContain("requestAnimationFrame");
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

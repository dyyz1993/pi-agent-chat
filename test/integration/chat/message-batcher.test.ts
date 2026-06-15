import { afterEach, describe, expect, it, vi } from "vitest";
import { batchMessageUpdate, flushNow } from "../../../src/mainview/lib/message-batcher";

afterEach(() => {
  flushNow();
  vi.useRealTimers();
});

describe("message-batcher", () => {
  it("batches visible message updates through animation frames", () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    const originalDocument = globalThis.document;
    let rafCallback: FrameRequestCallback | null = null;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCallback = cb;
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { visibilityState: "visible" },
    });

    try {
      const calls: string[] = [];

      batchMessageUpdate("sess-1", () => calls.push("first"));
      batchMessageUpdate("sess-1", () => calls.push("second"));
      batchMessageUpdate("sess-2", () => calls.push("third"));

      expect(calls).toEqual([]);
      expect(rafCallback).not.toBeNull();
      rafCallback?.(performance.now());
      expect(calls).toEqual(["second", "third"]);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("flushes hidden-tab updates through a timer fallback", () => {
    vi.useFakeTimers();
    const originalRaf = globalThis.requestAnimationFrame;
    const originalDocument = globalThis.document;
    globalThis.requestAnimationFrame = (() => {
      throw new Error("hidden tabs should not wait for requestAnimationFrame");
    }) as typeof requestAnimationFrame;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { visibilityState: "hidden" },
    });

    try {
      const calls: string[] = [];
      batchMessageUpdate("sess-1", () => calls.push("first"));
      expect(calls).toEqual([]);
      vi.advanceTimersByTime(16);
      expect(calls).toEqual(["first"]);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("flushNow drains the scheduled batch once", async () => {
    const calls: string[] = [];

    batchMessageUpdate("sess-1", () => calls.push("first"));
    flushNow();
    await Promise.resolve();

    expect(calls).toEqual(["first"]);
  });
});

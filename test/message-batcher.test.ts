import { afterEach, describe, expect, it } from "vitest";
import { batchMessageUpdate, flushNow } from "../src/mainview/stores/message-batcher";

afterEach(() => {
  flushNow();
});

describe("message-batcher", () => {
  it("flushes message updates through microtasks instead of animation frames", async () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => {
      throw new Error("requestAnimationFrame should not be used for message state flushing");
    }) as typeof requestAnimationFrame;

    try {
      const calls: string[] = [];

      batchMessageUpdate("sess-1", () => calls.push("first"));
      batchMessageUpdate("sess-1", () => calls.push("second"));

      expect(calls).toEqual([]);
      await Promise.resolve();
      expect(calls).toEqual(["first", "second"]);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCancelRaf;
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

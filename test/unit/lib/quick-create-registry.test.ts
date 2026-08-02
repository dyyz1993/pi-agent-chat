import { describe, expect, it } from "vitest";
import { abortPreviousAndTrack } from "../../../src/mainview/lib/quick-create-registry";

describe("quick create abort registry", () => {
  it("creates a fresh controller when ref is empty", () => {
    const ref = { current: null as AbortController | null };
    const controller = abortPreviousAndTrack(ref);

    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal.aborted).toBe(false);
    expect(ref.current).toBe(controller);
  });

  it("aborts the previous controller when a new one is requested", () => {
    const ref = { current: null as AbortController | null };
    const first = abortPreviousAndTrack(ref);
    const second = abortPreviousAndTrack(ref);

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(ref.current).toBe(second);
  });

  it("aborts across multiple consecutive starts", () => {
    const ref = { current: null as AbortController | null };
    const a = abortPreviousAndTrack(ref);
    const b = abortPreviousAndTrack(ref);
    const c = abortPreviousAndTrack(ref);

    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    expect(c.signal.aborted).toBe(false);
    expect(ref.current).toBe(c);
  });
});

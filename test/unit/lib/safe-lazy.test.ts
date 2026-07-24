import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLazyReloadFlag,
  isChunkLoadError,
  maybeReloadForChunkError,
} from "../../../src/mainview/lib/safe-lazy";

describe("safe-lazy chunk reload helpers", () => {
  beforeEach(() => {
    clearLazyReloadFlag();
    vi.useRealTimers();
  });

  it("should identify common dynamic import chunk load failures", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 42 failed"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk styles failed"))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("ordinary render error"))).toBe(false);
    expect(isChunkLoadError("Loading chunk 42 failed")).toBe(false);
  });

  it("should reload once for a chunk error and respect the cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const reload = vi.fn();
    const err = new Error("Loading chunk 42 failed");

    expect(maybeReloadForChunkError(err, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    expect(maybeReloadForChunkError(err, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    vi.setSystemTime(111_000);
    expect(maybeReloadForChunkError(err, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("should not reload for non chunk errors", () => {
    const reload = vi.fn();

    expect(maybeReloadForChunkError(new Error("ordinary render error"), reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

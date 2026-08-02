import { describe, expect, it, vi } from "vitest";
import { bootstrapGoalSetupWithRetry } from "../../../src/mainview/lib/goal-setup";

describe("bootstrapGoalSetupWithRetry", () => {
  it("returns immediately when startSetup succeeds on first try", async () => {
    const startSetup = vi.fn().mockResolvedValue({ started: true });
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await bootstrapGoalSetupWithRetry("session-1", "做一个 todo 应用", {
      startSetup,
      waitMs,
    });

    expect(result).toEqual({ started: true });
    expect(startSetup).toHaveBeenCalledTimes(1);
    expect(waitMs).toHaveBeenCalledTimes(1);
  });

  it("retries until startSetup succeeds", async () => {
    const startSetup = vi
      .fn()
      .mockResolvedValueOnce({ started: false, error: "channel not ready" })
      .mockResolvedValueOnce({ started: false, error: "channel not ready" })
      .mockResolvedValueOnce({ started: true });
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await bootstrapGoalSetupWithRetry("session-1", "做一个 todo 应用", {
      startSetup,
      waitMs,
    });

    expect(result).toEqual({ started: true });
    expect(startSetup).toHaveBeenCalledTimes(3);
    expect(waitMs).toHaveBeenCalledTimes(3);
  });

  it("returns the last error when all attempts fail", async () => {
    const startSetup = vi
      .fn()
      .mockResolvedValue({ started: false, error: "channel not ready" });
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await bootstrapGoalSetupWithRetry("session-1", "做一个 todo 应用", {
      startSetup,
      waitMs,
      maxAttempts: 5,
    });

    expect(result.started).toBe(false);
    expect(result.error).toBe("channel not ready");
    expect(startSetup).toHaveBeenCalledTimes(5);
  });

  it("returns a clear message when startSetup never reports an error", async () => {
    const startSetup = vi.fn().mockResolvedValue({ started: false });
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await bootstrapGoalSetupWithRetry("session-1", "做一个 todo 应用", {
      startSetup,
      waitMs,
      maxAttempts: 3,
    });

    expect(result.started).toBe(false);
    expect(result.error).toMatch(/did not become ready/i);
  });
});

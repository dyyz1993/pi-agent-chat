/**
 * @vitest-environment node
 *
 * Tests for Channel call timeout optimization.
 * Validates:
 * 1. change-review channel timeout is <= 5s (was 15s)
 * 2. callChannel wait loop is <= 1.6s total (was 3s)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC_ROOT = join(__dirname, "../../../src");

describe("Channel timeout configuration", () => {
  it("change-review CHANNEL_TIMEOUT_MS should be <= 5s (was 15s)", () => {
    const source = readFileSync(join(SRC_ROOT, "shared/handlers/change-review.ts"), "utf-8");
    const match = source.match(/CHANNEL_TIMEOUT_MS\s*=\s*([\d_]+)/);
    expect(match).not.toBeNull();
    const timeoutMs = parseInt(match![1].replace(/_/g, ""), 10);
    expect(timeoutMs).toBeLessThanOrEqual(5_000);
  });

  it("callChannel wait loop should be <= 1.6s total (was 3s)", () => {
    const source = readFileSync(join(SRC_ROOT, "shared/agent/process-manager.ts"), "utf-8");

    // Find the wait loop near callChannel
    const callChannelMatch = source.match(
      /async callChannel[\s\S]*?for\s*\(\s*let\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(\d+)\s*;\s*\w+\+\+\s*\)[\s\S]*?setTimeout\s*\(\s*\w+\s*,\s*(\d+)\s*\)/,
    );

    expect(callChannelMatch).not.toBeNull();
    const iterations = parseInt(callChannelMatch![1], 10);
    const intervalMs = parseInt(callChannelMatch![2], 10);
    const totalWaitMs = iterations * intervalMs;

    expect(totalWaitMs).toBeLessThanOrEqual(1600);
  });
});

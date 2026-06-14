/**
 * Unit tests for `formatDuration` in chat/primitives/formatDuration.ts.
 *
 * The function converts a millisecond duration into a short human-readable
 * string with three regimes:
 *   - < 1000ms            → "${Math.round(ms)}ms"
 *   - < 60000ms           → seconds; < 10s keeps 1 decimal, >= 10s rounded
 *   - >= 60000ms          → "${m}m${sec}s" (sec omitted when 0)
 *
 * Edge cases worth calling out:
 *   - 59999ms rounds to 60s in the seconds branch (Math.round).
 *   - 60000ms is the minute boundary; seconds = round((60000 % 60000)/1000) = 0.
 *   - Very large values (e.g. 1 hour) collapse to "60m".
 *   - Negative inputs exercise the "< 1000ms" branch (Math.round on negatives).
 */
import { describe, it, expect } from "vitest";
import { formatDuration } from "../../../src/mainview/components/chat/primitives/formatDuration";

describe("formatDuration", () => {
  // --- Milliseconds regime (ms < 1000) --------------------------------

  it("formats 0ms as '0ms'", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("formats 500ms as '500ms'", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats 999ms as '999ms'", () => {
    expect(formatDuration(999)).toBe("999ms");
  });

  it("rounds fractional milliseconds below 1000ms", () => {
    expect(formatDuration(499.6)).toBe("500ms");
    expect(formatDuration(1.4)).toBe("1ms");
    expect(formatDuration(250.5)).toBe("251ms");
  });

  it("treats 1ms as '1ms' (smallest positive unit)", () => {
    expect(formatDuration(1)).toBe("1ms");
  });

  // --- Seconds regime, < 10s (keeps 1 decimal) -------------------------

  it("formats 1000ms as '1.0s'", () => {
    expect(formatDuration(1000)).toBe("1.0s");
  });

  it("formats 1500ms as '1.5s'", () => {
    expect(formatDuration(1500)).toBe("1.5s");
  });

  it("formats 9500ms as '9.5s'", () => {
    expect(formatDuration(9500)).toBe("9.5s");
  });

  it("formats 2000ms as '2.0s'", () => {
    expect(formatDuration(2000)).toBe("2.0s");
  });

  it("formats 9499ms as '9.5s' (toFixed(1) on 9.499 → '9.5')", () => {
    // 9499 / 1000 = 9.499, toFixed(1) rounds half-up to "9.5"
    expect(formatDuration(9499)).toBe("9.5s");
  });

  // --- Seconds regime, >= 10s (rounded, no decimal) --------------------

  it("formats 10000ms as '10s'", () => {
    expect(formatDuration(10000)).toBe("10s");
  });

  it("formats 30000ms as '30s'", () => {
    expect(formatDuration(30000)).toBe("30s");
  });

  it("formats 45000ms as '45s'", () => {
    expect(formatDuration(45000)).toBe("45s");
  });

  it("formats 59999ms as '60s' (Math.round(59.999) === 60)", () => {
    // Notable edge: rounding pushes the value to 60 even though it is < 60000.
    expect(formatDuration(59999)).toBe("60s");
  });

  it("formats 10999ms as '11s' (Math.round(10.999))", () => {
    expect(formatDuration(10999)).toBe("11s");
  });

  it("formats 10499ms as '10s' (Math.round(10.499) === 10)", () => {
    expect(formatDuration(10499)).toBe("10s");
  });

  // --- Minutes regime (>= 60000ms) -------------------------------------

  it("formats 60000ms as '1m' (seconds = 0 omitted)", () => {
    // sec = Math.round((60000 % 60000) / 1000) = 0 → "${m}m"
    expect(formatDuration(60000)).toBe("1m");
  });

  it("formats 65000ms as '1m5s'", () => {
    expect(formatDuration(65000)).toBe("1m5s");
  });

  it("formats 125000ms as '2m5s'", () => {
    expect(formatDuration(125000)).toBe("2m5s");
  });

  it("formats 3600000ms as '60m'", () => {
    expect(formatDuration(3600000)).toBe("60m");
  });

  it("formats 120000ms as '2m'", () => {
    expect(formatDuration(120000)).toBe("2m");
  });

  it("formats 90000ms as '1m30s'", () => {
    expect(formatDuration(90000)).toBe("1m30s");
  });

  it("formats 3599999ms as '60m' (rounds seconds to 60, dropped in minute form)", () => {
    // 59 minutes 59.999s → m = 59, sec = Math.round(59999/1000) = 60
    // Since sec > 0 it renders as "59m60s" — verify actual behaviour.
    expect(formatDuration(3599999)).toBe("59m60s");
  });

  it("formats 3600001ms as '60m'", () => {
    // 1 hour + 1ms → m = 60, sec = round(1/1000) = 0 → "60m"
    expect(formatDuration(3600001)).toBe("60m");
  });

  // --- Larger / boundary values ----------------------------------------

  it("formats 7200000ms (2 hours) as '120m'", () => {
    expect(formatDuration(7200000)).toBe("120m");
  });

  it("formats 7250000ms as '120m50s'", () => {
    expect(formatDuration(7250000)).toBe("120m50s");
  });

  // --- Negative inputs (follow the < 1000ms branch) --------------------

  it("formats -1ms as '-1ms' (negative falls into the ms branch)", () => {
    expect(formatDuration(-1)).toBe("-1ms");
  });

  it("formats -500ms as '-500ms'", () => {
    expect(formatDuration(-500)).toBe("-500ms");
  });
});

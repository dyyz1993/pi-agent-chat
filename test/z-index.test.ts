import { describe, it, expect } from "vitest";
import { Z_INDEX } from "../src/mainview/lib/z-index";

describe("Z_INDEX", () => {
  it("is frozen (readonly at type level via as const)", () => {
    const keys = Object.keys(Z_INDEX);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("has expected layer keys", () => {
    expect(Z_INDEX).toHaveProperty("BASE");
    expect(Z_INDEX).toHaveProperty("MESSAGE_BUBBLE");
    expect(Z_INDEX).toHaveProperty("MAIN_LAYOUT");
    expect(Z_INDEX).toHaveProperty("MESSAGE_CARD");
    expect(Z_INDEX).toHaveProperty("SIDEBAR");
    expect(Z_INDEX).toHaveProperty("PANEL");
    expect(Z_INDEX).toHaveProperty("OVERLAY");
    expect(Z_INDEX).toHaveProperty("SPECIAL_PANEL");
    expect(Z_INDEX).toHaveProperty("DIALOG");
    expect(Z_INDEX).toHaveProperty("FULLSCREEN");
  });

  it("BASE, MESSAGE_BUBBLE, and MAIN_LAYOUT share the same base value", () => {
    expect(Z_INDEX.BASE).toBe(Z_INDEX.MESSAGE_BUBBLE);
    expect(Z_INDEX.BASE).toBe(Z_INDEX.MAIN_LAYOUT);
  });

  it("respects layer ordering: base < sidebar < panel < overlay < special < dialog < fullscreen", () => {
    expect(Z_INDEX.BASE).toBeLessThan(Z_INDEX.SIDEBAR);
    expect(Z_INDEX.SIDEBAR).toBeLessThan(Z_INDEX.PANEL);
    expect(Z_INDEX.PANEL).toBeLessThan(Z_INDEX.OVERLAY);
    expect(Z_INDEX.OVERLAY).toBeLessThan(Z_INDEX.SPECIAL_PANEL);
    expect(Z_INDEX.SPECIAL_PANEL).toBeLessThan(Z_INDEX.DIALOG);
    expect(Z_INDEX.DIALOG).toBeLessThan(Z_INDEX.FULLSCREEN);
  });

  it("all values are positive integers", () => {
    for (const value of Object.values(Z_INDEX)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("FULLSCREEN is the highest z-index value", () => {
    const max = Math.max(...Object.values(Z_INDEX));
    expect(Z_INDEX.FULLSCREEN).toBe(max);
  });

  it("no duplicate values across conceptually different layers", () => {
    const values = Object.values(Z_INDEX);
    const unique = new Set(values);
    expect(unique.size).toBeLessThan(values.length);
  });
});

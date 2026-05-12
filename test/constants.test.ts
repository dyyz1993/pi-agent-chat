import { describe, it, expect } from "vitest";
import { MAX_PREVIEW_SIZE } from "../src/mainview/utils/constants";

describe("MAX_PREVIEW_SIZE", () => {
  it("equals 500 * 1024 = 512000", () => {
    expect(MAX_PREVIEW_SIZE).toBe(512000);
  });
});

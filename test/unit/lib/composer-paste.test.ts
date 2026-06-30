import { describe, expect, it } from "vitest";
import { shouldPasteTextAsPlaceholder } from "../../../src/mainview/lib/composer-paste";

describe("shouldPasteTextAsPlaceholder", () => {
  it("keeps short text paste as regular textarea input", () => {
    expect(shouldPasteTextAsPlaceholder("hello world")).toBe(false);
    expect(shouldPasteTextAsPlaceholder("https://example.com")).toBe(false);
  });

  it("converts long text paste into a composer placeholder", () => {
    expect(shouldPasteTextAsPlaceholder("x".repeat(1_999))).toBe(false);
    expect(shouldPasteTextAsPlaceholder("x".repeat(2_000))).toBe(true);
  });

  it("converts multiline text paste into a composer placeholder", () => {
    expect(
      shouldPasteTextAsPlaceholder(Array.from({ length: 21 }, (_, i) => `line ${i}`).join("\n")),
    ).toBe(true);
  });

  it("converts fenced code paste into a composer placeholder", () => {
    expect(shouldPasteTextAsPlaceholder("```ts\nconst value = 1;\n```")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { shouldPasteTextAsPlaceholder } from "../../../src/mainview/lib/composer-paste";

describe("shouldPasteTextAsPlaceholder", () => {
  it("keeps short text paste as regular textarea input", () => {
    expect(shouldPasteTextAsPlaceholder("hello world")).toBe(false);
    expect(shouldPasteTextAsPlaceholder("https://example.com")).toBe(false);
  });

  it("converts long text paste into a composer placeholder", () => {
    expect(shouldPasteTextAsPlaceholder("x".repeat(240))).toBe(true);
  });

  it("converts multiline text paste into a composer placeholder", () => {
    expect(shouldPasteTextAsPlaceholder("line one\nline two\nline three")).toBe(true);
  });

  it("converts fenced code paste into a composer placeholder", () => {
    expect(shouldPasteTextAsPlaceholder("```ts\nconst value = 1;\n```")).toBe(true);
  });
});

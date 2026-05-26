import { describe, it, expect } from "vitest";
import { isVisionModel, getVisionModels } from "../src/mainview/lib/vision-detection";

describe("isVisionModel", () => {
  it("returns true when input array includes 'image'", () => {
    expect(isVisionModel({ provider: "test", id: "any", input: ["text", "image"] })).toBe(true);
  });

  it("returns false when input array does not include 'image'", () => {
    expect(isVisionModel({ provider: "test", id: "any", input: ["text"] })).toBe(false);
  });

  it("returns false when input array is empty", () => {
    expect(isVisionModel({ provider: "test", id: "any", input: [] })).toBe(false);
  });

  it("detects qwen3.5-plus by name pattern", () => {
    expect(isVisionModel({ provider: "opencode-go", id: "qwen3.5-plus" })).toBe(true);
  });

  it("detects qwen3.6-plus by name pattern", () => {
    expect(isVisionModel({ provider: "opencode-go", id: "qwen3.6-plus" })).toBe(true);
  });

  it("detects gpt-4o by name pattern", () => {
    expect(isVisionModel({ provider: "openai", id: "gpt-4o-2024-05-13" })).toBe(true);
  });

  it("detects claude models by name pattern", () => {
    expect(isVisionModel({ provider: "anthropic", id: "claude-3-opus" })).toBe(true);
    expect(isVisionModel({ provider: "anthropic", id: "claude-4-sonnet" })).toBe(true);
  });

  it("detects gemini models by name pattern", () => {
    expect(isVisionModel({ provider: "google", id: "gemini-2.0-flash" })).toBe(true);
  });

  it("detects glm vision models", () => {
    expect(isVisionModel({ provider: "zhipuai", id: "glm-4v-plus" })).toBe(true);
    expect(isVisionModel({ provider: "zhipuai", id: "glm-5v-turbo" })).toBe(true);
  });

  it("returns false for text-only models", () => {
    expect(isVisionModel({ provider: "openai", id: "gpt-3.5-turbo" })).toBe(false);
    expect(isVisionModel({ provider: "anthropic", id: "claude-instant" })).toBe(false);
    expect(isVisionModel({ provider: "deepseek", id: "deepseek-chat" })).toBe(false);
  });

  it("prefers explicit input array over name pattern", () => {
    // Model name matches a vision pattern, but input says text-only
    expect(isVisionModel({ provider: "test", id: "gpt-4o", input: ["text"] })).toBe(false);
  });
});

describe("getVisionModels", () => {
  it("filters to only vision-capable models", () => {
    const models = [
      { provider: "opencode-go", id: "qwen3.5-plus" },
      { provider: "openai", id: "gpt-4o" },
      { provider: "deepseek", id: "deepseek-chat" },
      { provider: "openai", id: "gpt-3.5-turbo" },
    ];

    const result = getVisionModels(models);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("qwen3.5-plus");
    expect(result[1].id).toBe("gpt-4o");
  });

  it("returns empty array for no vision models", () => {
    const models = [
      { provider: "deepseek", id: "deepseek-chat" },
      { provider: "openai", id: "gpt-3.5-turbo" },
    ];

    expect(getVisionModels(models)).toHaveLength(0);
  });

  it("respects explicit input field", () => {
    const models = [
      { provider: "test", id: "custom-vision", input: ["text", "image"] },
      { provider: "test", id: "custom-text", input: ["text"] },
    ];

    const result = getVisionModels(models);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("custom-vision");
  });
});

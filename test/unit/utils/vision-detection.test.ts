import { describe, it, expect } from "vitest";
import { isVisionModel, getVisionModels } from "../../../src/mainview/lib/vision-detection";

describe("isVisionModel", () => {
  it("returns true when input array includes 'image'", () => {
    expect(isVisionModel({ input: ["text", "image"] })).toBe(true);
  });

  it("returns false when input array does not include 'image'", () => {
    expect(isVisionModel({ input: ["text"] })).toBe(false);
  });

  it("returns false when input array is empty", () => {
    expect(isVisionModel({ input: [] })).toBe(false);
  });

  it("returns false when input is undefined", () => {
    expect(isVisionModel({})).toBe(false);
    expect(isVisionModel({ input: undefined })).toBe(false);
  });

  it("returns true for vision-only models", () => {
    expect(isVisionModel({ input: ["text", "image"] })).toBe(true);
  });
});

describe("getVisionModels", () => {
  it("filters to only vision-capable models", () => {
    const models = [
      { provider: "opencode-go", id: "qwen3.5-plus", input: ["text", "image"] as const },
      { provider: "openai", id: "gpt-4o", input: ["text", "image"] as const },
      { provider: "deepseek", id: "deepseek-chat", input: ["text"] as const },
      { provider: "openai", id: "gpt-3.5-turbo", input: ["text"] as const },
    ];

    const result = getVisionModels(models);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("qwen3.5-plus");
    expect(result[1].id).toBe("gpt-4o");
  });

  it("returns empty array for no vision models", () => {
    const models = [
      { provider: "deepseek", id: "deepseek-chat", input: ["text"] as const },
      { provider: "openai", id: "gpt-3.5-turbo", input: ["text"] as const },
    ];

    expect(getVisionModels(models)).toHaveLength(0);
  });

  it("handles models without input field", () => {
    const models = [
      { provider: "test", id: "unknown" },
      { provider: "test", id: "vision-model", input: ["text", "image"] as const },
    ];

    const result = getVisionModels(models);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("vision-model");
  });

  it("preserves extra properties on model objects", () => {
    const models = [
      {
        provider: "opencode-go",
        id: "qwen3.5-plus",
        name: "Qwen 3.5 Plus",
        contextWindow: 131072,
        reasoning: true,
        input: ["text", "image"] as const,
      },
    ];

    const result = getVisionModels(models);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Qwen 3.5 Plus");
    expect(result[0].contextWindow).toBe(131072);
  });
});

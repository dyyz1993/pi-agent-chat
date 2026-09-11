import { describe, expect, it } from "vitest";

import { parseJsonlFromText } from "../../../src/shared/agent/session-jsonl-parser";

function modelChangeLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "model_change",
    id: "entry-mc-1",
    parentId: "entry-msg-1",
    timestamp: "2026-09-11T06:00:00.000Z",
    provider: "opencode-go",
    modelId: "deepseek-v4-flash",
    previousProvider: "google",
    previousModelId: "gemini-2.5-pro",
    source: "set",
    ...overrides,
  });
}

function parseLines(lines: string[]) {
  return parseJsonlFromText(lines.join("\n"));
}

describe("session-jsonl-parser — model_change entries", () => {
  it("surfaces a switch entry as a model_changed chat message", () => {
    const result = parseLines([modelChangeLine()]);
    expect(result.messages).toHaveLength(1);
    const message = result.messages[0]?.message as Record<string, unknown>;
    expect(message.role).toBe("custom");
    expect(message.customType).toBe("model_changed");
    expect(message.display).toBe(true);
    expect(message.details).toEqual({
      provider: "opencode-go",
      modelId: "deepseek-v4-flash",
      previousProvider: "google",
      previousModelId: "gemini-2.5-pro",
      source: "set",
    });
  });

  it("skips init entries (session starting model, not a switch)", () => {
    const result = parseLines([modelChangeLine({ source: "init", previousProvider: undefined, previousModelId: undefined })]);
    expect(result.messages).toHaveLength(0);
  });

  it("skips legacy entries without previous model info", () => {
    const result = parseLines([
      modelChangeLine({ previousProvider: undefined, previousModelId: undefined, source: undefined }),
    ]);
    expect(result.messages).toHaveLength(0);
  });

  it("skips same-model switches", () => {
    const result = parseLines([
      modelChangeLine({
        provider: "google",
        modelId: "gemini-2.5-pro",
        previousProvider: "google",
        previousModelId: "gemini-2.5-pro",
      }),
    ]);
    expect(result.messages).toHaveLength(0);
  });

  it("indexes model_change entries into parentById for branch filtering", () => {
    const result = parseLines([
      JSON.stringify({
        type: "message",
        id: "entry-msg-1",
        parentId: null,
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
      modelChangeLine(),
    ]);
    expect(result.parentById.get("entry-mc-1")).toBe("entry-msg-1");
    expect(result.activeJsonlLeafId).toBe("entry-mc-1");
  });
});

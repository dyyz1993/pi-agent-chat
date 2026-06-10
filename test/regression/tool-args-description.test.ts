import { describe, it, expect } from "vitest";
import { getToolArgsDescription } from "../../src/mainview/lib/tool-args-description";

describe("getToolArgsDescription", () => {
  // --- Specific tool extraction ---

  it("extracts pattern for grep tool", () => {
    expect(
      getToolArgsDescription("grep", JSON.stringify({ pattern: "TODO", path: "/src" })),
    ).toBe("TODO  (/src)");
  });

  it("extracts pattern for glob tool", () => {
    expect(
      getToolArgsDescription("glob", JSON.stringify({ glob: "**/*.ts" })),
    ).toBe("**/*.ts");
  });

  it("extracts query for web_search tool", () => {
    expect(
      getToolArgsDescription("web_search", JSON.stringify({ query: "Rust async" })),
    ).toBe("Rust async");
  });

  it("extracts url for fetch tool", () => {
    expect(
      getToolArgsDescription("fetch", JSON.stringify({ url: "https://example.com" })),
    ).toBe("https://example.com");
  });

  // --- Explicit description wins ---

  it("prefers explicit description field over other fields", () => {
    expect(
      getToolArgsDescription(
        "grep",
        JSON.stringify({ description: "search todos", pattern: "TODO", path: "/src" }),
      ),
    ).toBe("search todos");
  });

  // --- Generic fallbacks ---

  it("extracts command as generic fallback", () => {
    expect(
      getToolArgsDescription("some_tool", JSON.stringify({ command: "ls -la" })),
    ).toBe("ls -la");
  });

  it("extracts path as generic fallback", () => {
    expect(
      getToolArgsDescription("some_tool", JSON.stringify({ path: "/home/user/file.txt" })),
    ).toBe("/home/user/file.txt");
  });

  it("extracts query from generic pattern extractor", () => {
    expect(
      getToolArgsDescription(
        "mcp__websearch",
        JSON.stringify({ query: "Rust 浏览器引擎 headless 爬虫", limit: 5 }),
      ),
    ).toBe("Rust 浏览器引擎 headless 爬虫");
  });

  // --- Broken / incomplete JSON args ---

  it("falls back to toolName when args is incomplete JSON '{'", () => {
    expect(getToolArgsDescription("mcp__websearch", "{")).toBe("mcp__websearch");
  });

  it("falls back to toolName when args is incomplete JSON '['", () => {
    expect(getToolArgsDescription("some_tool", "[")).toBe("some_tool");
  });

  it("falls back to toolName when args is empty string", () => {
    expect(getToolArgsDescription("some_tool", "")).toBe("some_tool");
  });

  it("falls back to toolName when args is undefined", () => {
    expect(getToolArgsDescription("some_tool", undefined)).toBe("some_tool");
  });

  it("falls back to toolName when parsed JSON has no extractable fields", () => {
    expect(getToolArgsDescription("some_tool", JSON.stringify({ foo: 123 }))).toBe(
      "some_tool",
    );
  });

  // --- Non-JSON plain text args ---

  it("uses first line for plain text args", () => {
    expect(getToolArgsDescription("bash", "ls -la\ncd /tmp")).toBe("ls -la");
  });

  // --- Truncation ---

  it("truncates long values", () => {
    const long = "a".repeat(200);
    const result = getToolArgsDescription(
      "grep",
      JSON.stringify({ pattern: long }),
    );
    expect(result!.endsWith("…")).toBe(true);
    expect(result!.length).toBeLessThanOrEqual(121); // 120 + "…"
  });
});

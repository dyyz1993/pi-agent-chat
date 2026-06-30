import { describe, it, expect } from "vitest";
import { findFilePaths, resolveFilePath } from "../../../src/mainview/components/chat/clickable-file-paths";

describe("findFilePaths", () => {
  it("detects simple relative file paths", () => {
    const text = "Check out src/mainview/Xxx.tsx for details.";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("src/mainview/Xxx.tsx");
  });

  it("detects paths with ./ prefix", () => {
    const text = "See ./foo/bar.ts";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("./foo/bar.ts");
  });

  it("detects paths with ../ prefix", () => {
    const text = "Import from ../parent/file.jsx";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("../parent/file.jsx");
  });

  it("detects image paths", () => {
    const text = "Screenshot at images/screenshot.png";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("images/screenshot.png");
  });

  it("detects multiple paths in one text", () => {
    const text = "Modify src/a.ts and src/b.tsx";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(2);
    expect(matches[0].path).toBe("src/a.ts");
    expect(matches[1].path).toBe("src/b.tsx");
  });

  it("does NOT match URLs", () => {
    const text = "See https://example.com/file.ts for info";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(0);
  });

  it("does NOT match URLs with different protocols", () => {
    const text = "View at ftp://files.example.com/some/path.ts";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(0);
  });

  it("does NOT match bare filenames without directory", () => {
    const text = "Check file.ts for details";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(0);
  });

  it("matches paths found inside markdown link hrefs at raw-text level", () => {
    // After remark parsing, [link](foo/bar.ts) becomes <a> element,
    // so the HAST transform correctly skips it (SKIP_TAGS includes "a").
    // The raw-text helper finds it; filtering happens at the HAST level.
    const text = "[link](foo/bar.ts)";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("foo/bar.ts");
  });

  it("matches paths in parentheses", () => {
    const text = "(src/mainview/Xxx.tsx)";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("src/mainview/Xxx.tsx");
  });

  it("matches paths in backticks only if path-like", () => {
    // In the source text of Markdown, backticks are handled by the parser.
    // The HAST tree will have these as inline code (not traversed).
    // Our unit test tests raw text content after Markdown parsing.
    const text = "`src/mainview/Xxx.tsx`";
    // Without the backticks: the path inside `code` is not traversed because
    // our transform skips <code> elements. But this is raw text, so
    // the path detection will still match.
    // The actual filtering happens at the HAST level, not in findFilePaths.
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
  });

  it("returns empty array for empty text", () => {
    expect(findFilePaths("")).toHaveLength(0);
  });

  it("returns empty array for unrelated text", () => {
    expect(findFilePaths("Hello world, how are you?")).toHaveLength(0);
  });

  it("detects paths with hyphens and underscores", () => {
    const text = "Edit my-component/_helper.ts";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("my-component/_helper.ts");
  });

  it("detects camelCase filenames in paths", () => {
    const text = "Update MyComponent.tsx";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(0); // MyComponent.tsx is a standalone filename without directory
  });

  it("detects paths with deep nesting", () => {
    const text = "See src/a/b/c/d/e/f/g/file.ts";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("src/a/b/c/d/e/f/g/file.ts");
  });

  it("detects paths with numbers", () => {
    const text = "Check out v2/components/button-1.tsx renders differently";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe("v2/components/button-1.tsx");
  });

  it("reports correct index and end positions", () => {
    const text = "prefix src/x.ts suffix";
    const matches = findFilePaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].index).toBe(7);
    expect(matches[0].end).toBe(15);
    expect(text.slice(matches[0].index, matches[0].end)).toBe("src/x.ts");
  });
});

describe("resolveFilePath", () => {
  it("resolves relative path against project root", () => {
    const result = resolveFilePath("/Users/me/project", "src/mainview/Xxx.tsx");
    expect(result).toBe("/Users/me/project/src/mainview/Xxx.tsx");
  });

  it("handles ./ prefix", () => {
    const result = resolveFilePath("/project", "./src/file.ts");
    expect(result).toBe("/project/src/file.ts");
  });

  it("handles ../ prefix", () => {
    const result = resolveFilePath("/project/subdir", "../file.ts");
    expect(result).toBe("/project/file.ts");
  });

  it("handles deep ../", () => {
    const result = resolveFilePath("/project/a/b/c", "../../d/file.ts");
    expect(result).toBe("/project/a/d/file.ts");
  });

  it("returns absolute paths unchanged", () => {
    const result = resolveFilePath("/project", "/absolute/path/file.ts");
    expect(result).toBe("/absolute/path/file.ts");
  });

  it("handles project root with trailing slash", () => {
    const result = resolveFilePath("/Users/me/project/", "src/file.ts");
    expect(result).toBe("/Users/me/project/src/file.ts");
  });
});

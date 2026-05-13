import { describe, it, expect } from "vitest";
import { getMemorySummary } from "../src/mainview/components/chat/memory-config";

describe("getMemorySummary - memory_extract", () => {
  it("returns non-null when created=0 and updated=0 (zero counts)", () => {
    const result = getMemorySummary("memory_extract", { created: 0, updated: 0 });
    expect(result).not.toBeNull();
  });

  it("returns non-null when no data fields at all", () => {
    const result = getMemorySummary("memory_extract", {});
    expect(result).not.toBeNull();
  });

  it("returns created count summary", () => {
    expect(getMemorySummary("memory_extract", { created: 3, updated: 0 })).toBe("新建 3 条");
  });

  it("returns updated count summary", () => {
    expect(getMemorySummary("memory_extract", { created: 0, updated: 2 })).toBe("更新 2 条");
  });

  it("returns combined summary", () => {
    expect(getMemorySummary("memory_extract", { created: 1, updated: 2 })).toBe(
      "新建 1 条，更新 2 条",
    );
  });
});

describe("getMemorySummary - memory_dream", () => {
  it("returns non-null when all counts are 0", () => {
    const result = getMemorySummary("memory_dream", { merges: 0, deletions: 0, updates: 0 });
    expect(result).not.toBeNull();
  });

  it("returns non-null when no data fields", () => {
    const result = getMemorySummary("memory_dream", {});
    expect(result).not.toBeNull();
  });

  it("returns merge count", () => {
    expect(getMemorySummary("memory_dream", { merges: 2 })).toBe("合并 2");
  });

  it("returns combined summary", () => {
    expect(getMemorySummary("memory_dream", { merges: 1, deletions: 2, updates: 3 })).toBe(
      "合并 1，删除 2，更新 3",
    );
  });
});

describe("getMemorySummary - regression for other types", () => {
  it("memory_prefetch with skipped=true returns skipped message", () => {
    expect(getMemorySummary("memory_prefetch", { skipped: true })).toBe("跳过搜索，复用上次结果");
  });

  it("memory_prefetch with query returns query summary", () => {
    const result = getMemorySummary("memory_prefetch", {
      query: "React hooks",
      availableFiles: 10,
    });
    expect(result).toContain("React hooks");
  });

  it("memory_prefetch with no query and not skipped returns null", () => {
    expect(getMemorySummary("memory_prefetch", { availableFiles: 5 })).toBeNull();
  });

  it("bookmark_creating returns null (loading state)", () => {
    expect(getMemorySummary("bookmark_creating", {})).toBeNull();
  });

  it("unknown type returns null", () => {
    expect(getMemorySummary("unknown_type", {})).toBeNull();
  });

  it("memory_updated with filename returns filename", () => {
    expect(getMemorySummary("memory_updated", { filename: "test.md" })).toBe("test.md");
  });

  it("memory_updated with files array returns count", () => {
    expect(getMemorySummary("memory_updated", { files: [{}, {}] })).toBe("2 个文件");
  });

  it("memory_update_failed with reason returns reason", () => {
    expect(getMemorySummary("memory_update_failed", { reason: "disk full" })).toBe("disk full");
  });
});

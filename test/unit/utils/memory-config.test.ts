import { describe, it, expect } from "vitest";
import { ThumbsDown } from "lucide-react";
import {
  getMemorySummary,
  LEGACY_ENTRY_TYPES,
  ALL_MEMORY_TYPE_KEYS,
  ENTRY_TYPE_KEYS,
} from "../../../src/mainview/components/chat/memory-config";

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

  it("returns enriched summary with file names for created entries", () => {
    const result = getMemorySummary("memory_extract", {
      created: [{ filename: "test.md", name: "Testing Policy", description: "Use real DBs" }],
      updated: [],
    });
    expect(result).toBe("新建「Testing Policy」");
  });

  it("returns enriched summary with file names for both created and updated", () => {
    const result = getMemorySummary("memory_extract", {
      created: [{ filename: "a.md", name: "Alpha", description: "desc a" }],
      updated: [{ filename: "b.md", name: "Beta", description: "desc b" }],
    });
    expect(result).toBe("新建「Alpha」，更新「Beta」");
  });

  it("returns enriched summary with multiple files", () => {
    const result = getMemorySummary("memory_extract", {
      created: [
        { filename: "a.md", name: "Alpha", description: "desc a" },
        { filename: "b.md", name: "Beta", description: "desc b" },
      ],
      updated: [{ filename: "c.md", name: "Gamma", description: "desc c" }],
    });
    expect(result).toBe("新建「Alpha」，新建「Beta」，更新「Gamma」");
  });

  it("returns enriched summary even when mixed with empty arrays", () => {
    const result = getMemorySummary("memory_extract", {
      created: [],
      updated: [{ filename: "c.md", name: "Config", description: "project settings" }],
    });
    expect(result).toBe("更新「Config」");
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

  it("memory_inject with alreadyInjected=true returns reuse summary", () => {
    expect(
      getMemorySummary("memory_inject", {
        alreadyInjected: true,
        skipped: true,
        selectedFiles: ["a.md", "b.md"],
        injectedBytes: 0,
        originalBytes: 435,
      }),
    ).toBe("已识别 Memory，本会话已注入过 · 2个文件 · 约109 tokens");
  });

  it("memory_update_failed with reason returns reason", () => {
    expect(getMemorySummary("memory_update_failed", { reason: "disk full" })).toBe("disk full");
  });
});

describe("memory_irrelevant_marked - config registration", () => {
  it("LEGACY_ENTRY_TYPES has memory_irrelevant_marked with correct icon, color, label", () => {
    const entry = LEGACY_ENTRY_TYPES["memory_irrelevant_marked"];
    expect(entry).toBeDefined();
    expect(entry.icon).toBe(ThumbsDown);
    expect(entry.color).toBe("text-semantic-tool");
    expect(entry.label).toBe("已标记不相关");
  });

  it("ALL_MEMORY_TYPE_KEYS includes memory_irrelevant_marked", () => {
    expect(ALL_MEMORY_TYPE_KEYS.has("memory_irrelevant_marked")).toBe(true);
  });

  it("ENTRY_TYPE_KEYS includes memory_irrelevant_marked (it is a LEGACY type)", () => {
    expect(ENTRY_TYPE_KEYS.has("memory_irrelevant_marked")).toBe(true);
  });
});

describe("getMemorySummary - memory_irrelevant_marked", () => {
  it("returns correct summary for single file", () => {
    expect(getMemorySummary("memory_irrelevant_marked", { selectedFiles: ["a.md"] })).toBe(
      "已标记 1 个文件为不相关",
    );
  });

  it("returns correct count for multiple files", () => {
    expect(
      getMemorySummary("memory_irrelevant_marked", {
        selectedFiles: ["a.md", "b.md", "c.md"],
      }),
    ).toBe("已标记 3 个文件为不相关");
  });

  it("returns 0 count when data has no selectedFiles", () => {
    expect(getMemorySummary("memory_irrelevant_marked", {})).toBe("已标记 0 个文件为不相关");
  });

  it("returns 0 count when selectedFiles is empty array", () => {
    expect(getMemorySummary("memory_irrelevant_marked", { selectedFiles: [] })).toBe(
      "已标记 0 个文件为不相关",
    );
  });

  it("returns 0 count when data is null", () => {
    expect(getMemorySummary("memory_irrelevant_marked", null)).toBeNull();
  });
});

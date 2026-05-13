import { describe, it, expect } from "vitest";
import {
  getCustomEntryMeta,
  registerCustomEntryType,
  getAllCustomEntryTypes,
} from "../src/mainview/lib/custom-entry-registry";
import type { CustomEntryMeta } from "../src/mainview/lib/custom-entry-registry";

describe("custom-entry-registry", () => {
  it("returns builtin entry: memory_prefetch_result", () => {
    const meta = getCustomEntryMeta("memory_prefetch_result");
    expect(meta).toBeDefined();
    expect(meta!.icon).toBe("Brain");
    expect(meta!.standalone).toBe(true);
    expect(meta!.priority).toBe("high");
  });

  it("returns builtin entry: memory_inject", () => {
    const meta = getCustomEntryMeta("memory_inject");
    expect(meta).toBeDefined();
    expect(meta!.icon).toBe("ArrowDownToLine");
    expect(meta!.priority).toBe("medium");
  });

  it("returns builtin entry: bash_background_exit", () => {
    const meta = getCustomEntryMeta("bash_background_exit");
    expect(meta).toBeDefined();
    expect(meta!.standalone).toBe(false);
    expect(meta!.priority).toBe("low");
  });

  it("returns undefined for unknown type", () => {
    expect(getCustomEntryMeta("nonexistent_type")).toBeUndefined();
  });

  it("registers and retrieves a custom entry type", () => {
    const meta: CustomEntryMeta = {
      icon: "TestIcon",
      label: "Test Label",
      color: "text-red-500",
      standalone: true,
      priority: "high",
    };
    registerCustomEntryType("test_type", meta);
    const retrieved = getCustomEntryMeta("test_type");
    expect(retrieved).toEqual(meta);
  });

  it("overwrites existing entry on re-registration", () => {
    const updated: CustomEntryMeta = {
      icon: "UpdatedIcon",
      label: "Updated",
      color: "text-blue-500",
      standalone: false,
      priority: "low",
    };
    registerCustomEntryType("bash_background_exit", updated);
    const result = getCustomEntryMeta("bash_background_exit");
    expect(result!.icon).toBe("UpdatedIcon");
    expect(result!.label).toBe("Updated");
  });

  it("getAllCustomEntryTypes includes builtin types", () => {
    const types = getAllCustomEntryTypes();
    expect(types).toContain("memory_prefetch_result");
    expect(types).toContain("memory_inject");
    expect(types).toContain("lsp_diagnostics");
    expect(types).toContain("step_snapshot");
    expect(types).toContain("compaction");
  });

  it("getAllCustomEntryTypes includes registered custom types", () => {
    registerCustomEntryType("my_custom", {
      icon: "X",
      label: "X",
      color: "text-white",
      standalone: true,
      priority: "medium",
    });
    const types = getAllCustomEntryTypes();
    expect(types).toContain("my_custom");
  });
});

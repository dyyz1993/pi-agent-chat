/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  addToProcessPool,
  countProcessPoolEntries,
  makeProcessPoolKey,
  removeFromProcessPool,
  selectLruEvictionCandidate,
  type ProcessPoolEntry,
} from "../../../src/shared/agent/agent-process-pool";

function entry(
  sessionId: string,
  lastActiveAt: number,
  options: { status?: string; backgroundTools?: string[] } = {},
): ProcessPoolEntry {
  return {
    _activeSessionId: sessionId,
    lastActiveAt,
    activeBackgroundTools: new Set(options.backgroundTools ?? []),
    info: { status: options.status ?? "idle" },
  };
}

describe("agent process pool helpers", () => {
  it("builds sandbox-aware pool keys", () => {
    expect(makeProcessPoolKey("/repo/app", "user-1", true)).toBe("/repo/app::user-1");
    expect(makeProcessPoolKey("/repo/app", undefined, true)).toBe("/repo/app");
    expect(makeProcessPoolKey("/repo/app", "user-1", false)).toBe("/repo/app");
  });

  it("adds, counts, and removes process pool entries", () => {
    const pools = new Map<string, Set<ProcessPoolEntry>>();
    const managed = entry("sess-1", 1);

    addToProcessPool(pools, "/repo/app", managed);
    expect(countProcessPoolEntries(pools)).toBe(1);
    expect(pools.get("/repo/app")?.has(managed)).toBe(true);

    removeFromProcessPool(pools, "/repo/app", managed);
    expect(countProcessPoolEntries(pools)).toBe(0);
    expect(pools.has("/repo/app")).toBe(false);
  });

  it("does not evict before the pool reaches the configured limit", () => {
    const pools = new Map<string, Set<ProcessPoolEntry>>([
      ["/repo/a", new Set([entry("a", 1)])],
      ["/repo/b", new Set([entry("b", 2)])],
    ]);

    expect(selectLruEvictionCandidate(pools, "/repo/a", 3)).toBeNull();
  });

  it("skips streaming and background processes when selecting an eviction candidate", () => {
    const idle = entry("idle", 30);
    const pools = new Map<string, Set<ProcessPoolEntry>>([
      ["/repo/a", new Set([entry("streaming", 1, { status: "streaming" })])],
      ["/repo/b", new Set([entry("background", 2, { backgroundTools: ["tool-1"] })])],
      ["/repo/c", new Set([idle])],
    ]);

    expect(selectLruEvictionCandidate(pools, "/repo/current", 3)).toEqual({
      poolKey: "/repo/c",
      managed: idle,
      totalProcesses: 3,
    });
  });

  it("prefers evicting another project before the current project", () => {
    const currentOldest = entry("current-oldest", 1);
    const other = entry("other-newer", 10);
    const pools = new Map<string, Set<ProcessPoolEntry>>([
      ["/repo/current", new Set([currentOldest, entry("current-newer", 20)])],
      ["/repo/other", new Set([other])],
    ]);

    expect(selectLruEvictionCandidate(pools, "/repo/current", 3)).toEqual({
      poolKey: "/repo/other",
      managed: other,
      totalProcesses: 3,
    });
  });

  it("does not evict the only process in the current project", () => {
    const other = entry("other", 10);
    const pools = new Map<string, Set<ProcessPoolEntry>>([
      ["/repo/current", new Set([entry("current", 1)])],
      ["/repo/other", new Set([other])],
    ]);

    expect(selectLruEvictionCandidate(pools, "/repo/current", 2)).toEqual({
      poolKey: "/repo/other",
      managed: other,
      totalProcesses: 2,
    });
  });
});

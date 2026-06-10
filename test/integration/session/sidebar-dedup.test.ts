import { describe, it, expect } from "vitest";
import { groupSessions } from "../../../src/mainview/components/session-sidebar/SessionSidebar";
import type { SessionMeta } from "../../../src/mainview/types";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: "sess-1",
    name: "",
    sessionPath: "/sessions/sess-1",
    projectPath: "/project-a",
    parentSessionPath: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    ...overrides,
  };
}

describe("groupSessions", () => {
  it("returns empty results for empty input", () => {
    const result = groupSessions([], "");
    expect(result.rootSessions).toEqual([]);
    expect(result.childMap).toEqual({});
  });

  it("groups root sessions (no parentSessionPath)", () => {
    const s1 = makeSession({ sessionId: "a", sessionPath: "/a" });
    const s2 = makeSession({ sessionId: "b", sessionPath: "/b" });
    const result = groupSessions([s1, s2], "");
    expect(result.rootSessions).toHaveLength(2);
    expect(result.childMap).toEqual({});
  });

  it("groups child sessions by parentSessionPath", () => {
    const parent = makeSession({ sessionId: "p", sessionPath: "/p" });
    const child = makeSession({
      sessionId: "c",
      sessionPath: "/c",
      parentSessionPath: "/p",
    });
    const result = groupSessions([parent, child], "");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("p");
    expect(result.childMap["/p"]).toHaveLength(1);
    expect(result.childMap["/p"][0].sessionId).toBe("c");
  });

  it("deduplicates sessions with the same sessionId", () => {
    const s1 = makeSession({ sessionId: "dup", sessionPath: "/dup-1", name: "first" });
    const s2 = makeSession({ sessionId: "dup", sessionPath: "/dup-2", name: "second" });
    const s3 = makeSession({ sessionId: "unique", sessionPath: "/unique" });
    const result = groupSessions([s1, s2, s3], "");
    expect(result.rootSessions).toHaveLength(2);
    expect(result.rootSessions.find((s) => s.sessionId === "dup")?.name).toBe("first");
    expect(result.rootSessions.find((s) => s.sessionId === "unique")).toBeDefined();
  });

  it("deduplicates when same sessionId appears as both root and child", () => {
    const parent = makeSession({ sessionId: "p", sessionPath: "/p" });
    const dupAsRoot = makeSession({ sessionId: "dup", sessionPath: "/dup-root" });
    const dupAsChild = makeSession({
      sessionId: "dup",
      sessionPath: "/dup-child",
      parentSessionPath: "/p",
      name: "child version",
    });
    const result = groupSessions([dupAsRoot, parent, dupAsChild], "");
    const allSessionIds = [
      ...result.rootSessions.map((s) => s.sessionId),
      ...Object.values(result.childMap).flatMap((arr) => arr.map((s) => s.sessionId)),
    ];
    const dupCount = allSessionIds.filter((id) => id === "dup").length;
    expect(dupCount).toBe(1);
  });

  it("deduplicates during search filtering", () => {
    const s1 = makeSession({ sessionId: "dup", sessionPath: "/dup-1", name: "alpha match" });
    const s2 = makeSession({ sessionId: "dup", sessionPath: "/dup-2", name: "alpha other" });
    const s3 = makeSession({ sessionId: "unique", sessionPath: "/unique", name: "bravo" });
    const result = groupSessions([s1, s2, s3], "alpha");
    const allSessionIds = [
      ...result.rootSessions.map((s) => s.sessionId),
      ...Object.values(result.childMap).flatMap((arr) => arr.map((s) => s.sessionId)),
    ];
    const dupCount = allSessionIds.filter((id) => id === "dup").length;
    expect(dupCount).toBeLessThanOrEqual(1);
  });

  it("sorts pinned sessions first", () => {
    const s1 = makeSession({ sessionId: "a", sessionPath: "/a", updatedAt: 100 });
    const s2 = makeSession({
      sessionId: "b",
      sessionPath: "/b",
      updatedAt: 200,
      pinned: true,
    });
    const result = groupSessions([s1, s2], "");
    expect(result.rootSessions[0].sessionId).toBe("b");
    expect(result.rootSessions[1].sessionId).toBe("a");
  });

  it("filters roots and children by search query", () => {
    const parent = makeSession({
      sessionId: "p",
      sessionPath: "/p",
      name: "matching parent",
    });
    const matchingChild = makeSession({
      sessionId: "c1",
      sessionPath: "/c1",
      parentSessionPath: "/p",
      name: "matching child",
    });
    const nonMatchingChild = makeSession({
      sessionId: "c2",
      sessionPath: "/c2",
      parentSessionPath: "/p",
      name: "other",
    });
    const result = groupSessions([parent, matchingChild, nonMatchingChild], "matching");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.childMap["/p"]).toHaveLength(1);
    expect(result.childMap["/p"][0].sessionId).toBe("c1");
  });

  it("preserves children when parent matches but children do not", () => {
    const parent = makeSession({
      sessionId: "p",
      sessionPath: "/p",
      name: "target parent",
    });
    const child = makeSession({
      sessionId: "c1",
      sessionPath: "/c1",
      parentSessionPath: "/p",
      name: "irrelevant child",
    });
    const result = groupSessions([parent, child], "target");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.childMap["/p"]).toHaveLength(0);
  });

  it("handles triple duplicate sessionId keeping only first", () => {
    const s1 = makeSession({ sessionId: "triple", sessionPath: "/t1" });
    const s2 = makeSession({ sessionId: "triple", sessionPath: "/t2" });
    const s3 = makeSession({ sessionId: "triple", sessionPath: "/t3" });
    const result = groupSessions([s1, s2, s3], "");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionPath).toBe("/t1");
  });
});

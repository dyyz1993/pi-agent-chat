/**
 * @vitest-environment happy-dom
 *
 * groupSessions tests:
 * 1. Sessions with parentSessionPath (no delegateParentSessionId) -> nested under parent (forked children)
 * 2. Sessions with delegateType="subagent" -> NESTED under parent (via idToPath lookup)
 * 3. Sessions with delegateType="coordinator" -> ROOT (colleague level, not nested)
 * 4. Sessions with delegateParentSessionId but no delegateType -> ROOT (legacy/fallback)
 * 5. Orphan subagent (parent not in list) -> root (not lost)
 */
import { describe, it, expect } from "vitest";
import { groupSessions } from "../src/mainview/components/session-sidebar/SessionSidebar";
import type { SessionMeta } from "../src/mainview/types";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: "sess-1",
    name: "",
    sessionPath: "/sessions/sess-1",
    projectPath: "/project-a",
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    ...overrides,
  };
}

describe("groupSessions: nesting rules", () => {
  it("nests forked child (parentSessionPath) under parent", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const forked = makeSession({
      sessionId: "fork-1",
      sessionPath: "/s/fork-1.jsonl",
      parentSessionPath: "/s/parent-1.jsonl",
    });

    const result = groupSessions([parent, forked], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("parent-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(1);
    expect(result.childMap["/s/parent-1.jsonl"][0].sessionId).toBe("fork-1");
  });

  it("nests subagent (delegateType=subagent) under parent", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const subagent = makeSession({
      sessionId: "sub-1",
      sessionPath: "/s/sub-1.jsonl",
      delegateParentSessionId: "parent-1",
      delegateType: "subagent",
    });

    const result = groupSessions([parent, subagent], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("parent-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(1);
    expect(result.childMap["/s/parent-1.jsonl"][0].sessionId).toBe("sub-1");
  });

  it("shows coordinator delegate as ROOT (colleague level)", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const delegate = makeSession({
      sessionId: "coord-1",
      sessionPath: "/s/coord-1.jsonl",
      delegateParentSessionId: "parent-1",
      delegateType: "coordinator",
    });

    const result = groupSessions([parent, delegate], "");

    expect(result.rootSessions).toHaveLength(2);
    const ids = result.rootSessions.map((s) => s.sessionId);
    expect(ids).toContain("parent-1");
    expect(ids).toContain("coord-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toBeUndefined();
  });

  it("shows legacy delegate (no delegateType) as ROOT", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const delegate = makeSession({
      sessionId: "delegate-1",
      sessionPath: "/s/delegate-1.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, delegate], "");

    expect(result.rootSessions).toHaveLength(2);
    const ids = result.rootSessions.map((s) => s.sessionId);
    expect(ids).toContain("parent-1");
    expect(ids).toContain("delegate-1");
  });

  it("places orphan subagent as root when parent not in list", () => {
    const orphan = makeSession({
      sessionId: "sub-orphan",
      sessionPath: "/s/sub-orphan.jsonl",
      delegateParentSessionId: "non-existent-parent",
      delegateType: "subagent",
    });

    const result = groupSessions([orphan], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("sub-orphan");
    expect(Object.keys(result.childMap)).toHaveLength(0);
  });

  it("mixed: forked + subagent nested, coordinator as root", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const forked = makeSession({
      sessionId: "fork-1",
      sessionPath: "/s/fork-1.jsonl",
      parentSessionPath: "/s/parent-1.jsonl",
    });
    const subagent = makeSession({
      sessionId: "sub-1",
      sessionPath: "/s/sub-1.jsonl",
      delegateParentSessionId: "parent-1",
      delegateType: "subagent",
    });
    const coordinator = makeSession({
      sessionId: "coord-1",
      sessionPath: "/s/coord-1.jsonl",
      delegateParentSessionId: "parent-1",
      delegateType: "coordinator",
    });

    const result = groupSessions([parent, forked, subagent, coordinator], "");

    expect(result.rootSessions).toHaveLength(2);
    const rootIds = result.rootSessions.map((s) => s.sessionId);
    expect(rootIds).toContain("parent-1");
    expect(rootIds).toContain("coord-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(2);
    const childIds = result.childMap["/s/parent-1.jsonl"].map((s) => s.sessionId);
    expect(childIds).toContain("fork-1");
    expect(childIds).toContain("sub-1");
  });

  it("multiple subagents all nested under same parent", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const s1 = makeSession({
      sessionId: "sub-1",
      sessionPath: "/s/sub-1.jsonl",
      delegateParentSessionId: "parent-1",
      delegateType: "subagent",
    });
    const s2 = makeSession({
      sessionId: "sub-2",
      sessionPath: "/s/sub-2.jsonl",
      delegateParentSessionId: "parent-1",
      delegateType: "subagent",
    });

    const result = groupSessions([parent, s1, s2], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("parent-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(2);
  });
});

describe("groupSessions: filter modes", () => {
  it("filter=delegate returns only coordinator delegates", () => {
    const normal = makeSession({ sessionId: "normal-1" });
    const coordinator = makeSession({
      sessionId: "coord-1",
      delegateParentSessionId: "parent-1",
      delegateType: "coordinator",
    });

    const result = groupSessions([normal, coordinator], "", "delegate");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("coord-1");
  });

  it("filter=delegate includes legacy delegates without delegateType", () => {
    const normal = makeSession({ sessionId: "normal-1" });
    const legacy = makeSession({
      sessionId: "legacy-1",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([normal, legacy], "", "delegate");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("legacy-1");
  });

  it("filter=normal excludes all delegates", () => {
    const normal = makeSession({ sessionId: "normal-1" });
    const coordinator = makeSession({
      sessionId: "coord-1",
      delegateParentSessionId: "parent-1",
      delegateType: "coordinator",
    });

    const result = groupSessions([normal, coordinator], "", "normal");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("normal-1");
  });
});

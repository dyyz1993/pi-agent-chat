/**
 * @vitest-environment happy-dom
 *
 * groupSessions tests:
 * - subagent (sess_sub_ prefix) → nested under parent
 * - coordinator (sess_coord_ prefix) → root (colleague level)
 * - forked (parentSessionPath) → nested under parent
 * - normal → root
 */
import { describe, it, expect } from "vitest";
import { groupSessions } from "../src/mainview/components/session-sidebar/SessionSidebar";
import type { SessionMeta } from "../src/mainview/types";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: "uuid-default",
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

  it("nests subagent (sess_sub_ prefix) under parent", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const subagent = makeSession({
      sessionId: "sess_sub_1234_abcd",
      sessionPath: "/s/sess_sub_1234_abcd.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, subagent], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("parent-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(1);
    expect(result.childMap["/s/parent-1.jsonl"][0].sessionId).toBe("sess_sub_1234_abcd");
  });

  it("shows coordinator delegate (sess_coord_ prefix) as ROOT", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const delegate = makeSession({
      sessionId: "sess_coord_5678_efgh",
      sessionPath: "/s/sess_coord_5678_efgh.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, delegate], "");

    expect(result.rootSessions).toHaveLength(2);
    const ids = result.rootSessions.map((s) => s.sessionId);
    expect(ids).toContain("parent-1");
    expect(ids).toContain("sess_coord_5678_efgh");
    expect(result.childMap["/s/parent-1.jsonl"]).toBeUndefined();
  });

  it("places orphan subagent as root when parent not in list", () => {
    const orphan = makeSession({
      sessionId: "sess_sub_9999_orphan",
      sessionPath: "/s/sess_sub_9999_orphan.jsonl",
      delegateParentSessionId: "non-existent-parent",
    });

    const result = groupSessions([orphan], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("sess_sub_9999_orphan");
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
      sessionId: "sess_sub_1111_sub1",
      sessionPath: "/s/sess_sub_1111_sub1.jsonl",
      delegateParentSessionId: "parent-1",
    });
    const coordinator = makeSession({
      sessionId: "sess_coord_2222_coord1",
      sessionPath: "/s/sess_coord_2222_coord1.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, forked, subagent, coordinator], "");

    expect(result.rootSessions).toHaveLength(2);
    const rootIds = result.rootSessions.map((s) => s.sessionId);
    expect(rootIds).toContain("parent-1");
    expect(rootIds).toContain("sess_coord_2222_coord1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(2);
    const childIds = result.childMap["/s/parent-1.jsonl"].map((s) => s.sessionId);
    expect(childIds).toContain("fork-1");
    expect(childIds).toContain("sess_sub_1111_sub1");
  });

  it("multiple subagents nested under same parent", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const s1 = makeSession({
      sessionId: "sess_sub_100_a",
      sessionPath: "/s/sess_sub_100_a.jsonl",
      delegateParentSessionId: "parent-1",
    });
    const s2 = makeSession({
      sessionId: "sess_sub_200_b",
      sessionPath: "/s/sess_sub_200_b.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, s1, s2], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("parent-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(2);
  });

  it("normal session with delegateParentSessionId but non-prefix ID is root", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const unknown = makeSession({
      sessionId: "some-uuid-format",
      sessionPath: "/s/some-uuid-format.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, unknown], "");

    expect(result.rootSessions).toHaveLength(2);
  });
});

describe("groupSessions: filter modes", () => {
  it("filter=delegate returns only sess_coord_ sessions", () => {
    const normal = makeSession({ sessionId: "normal-1" });
    const coordinator = makeSession({
      sessionId: "sess_coord_1234_abcd",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([normal, coordinator], "", "delegate");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("sess_coord_1234_abcd");
  });

  it("filter=delegate excludes subagents (sess_sub_ prefix)", () => {
    const subagent = makeSession({
      sessionId: "sess_sub_1234_abcd",
      sessionPath: "/s/sess_sub_1234_abcd.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([subagent], "", "delegate");
    expect(result.rootSessions).toHaveLength(0);
  });

  it("filter=normal excludes delegates and subagents", () => {
    const normal = makeSession({ sessionId: "normal-1" });
    const coordinator = makeSession({
      sessionId: "sess_coord_1234_abcd",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([normal, coordinator], "", "normal");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("normal-1");
  });
});

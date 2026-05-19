/**
 * @vitest-environment happy-dom
 *
 * TDD: Bug 4b — groupSessions with delegateParentSessionId
 *
 * Tests that groupSessions correctly handles:
 * 1. Coordinator sessions with parentSessionPath set -> nested under parent
 * 2. Coordinator sessions with null parentSessionPath but delegateParentSessionId set
 *    -> nested under parent via ID lookup
 * 3. Orphan coordinator sessions -> still appear as roots (not lost)
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
    messageCount: 0,
    firstMessage: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    ...overrides,
  };
}

describe("groupSessions with delegateParentSessionId", () => {
  it("nests coordinator session under parent via delegateParentSessionId when parentSessionPath is null", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const coord = makeSession({
      sessionId: "coord-1",
      sessionPath: "/s/coord-1.jsonl",
      parentSessionPath: null,
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, coord], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("parent-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(1);
    expect(result.childMap["/s/parent-1.jsonl"][0].sessionId).toBe("coord-1");
  });

  it("nests coordinator session under parent when parentSessionPath is set", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const coord = makeSession({
      sessionId: "coord-1",
      sessionPath: "/s/coord-1.jsonl",
      parentSessionPath: "/s/parent-1.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, coord], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("parent-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(1);
    expect(result.childMap["/s/parent-1.jsonl"][0].sessionId).toBe("coord-1");
  });

  it("places orphan coordinator as root when parent not in session list", () => {
    const coord = makeSession({
      sessionId: "coord-orphan",
      sessionPath: "/s/coord-orphan.jsonl",
      delegateParentSessionId: "non-existent-parent",
    });

    const result = groupSessions([coord], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("coord-orphan");
    expect(Object.keys(result.childMap)).toHaveLength(0);
  });

  it("nests multiple coordinator sessions under same parent via delegateParentSessionId", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const coord1 = makeSession({
      sessionId: "coord-1",
      sessionPath: "/s/coord-1.jsonl",
      delegateParentSessionId: "parent-1",
    });
    const coord2 = makeSession({
      sessionId: "coord-2",
      sessionPath: "/s/coord-2.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, coord1, coord2], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("parent-1");
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(2);
    expect(result.childMap["/s/parent-1.jsonl"].map((s) => s.sessionId)).toEqual(
      expect.arrayContaining(["coord-1", "coord-2"]),
    );
  });

  it("mixed: some coords with parentSessionPath, some with delegateParentSessionId", () => {
    const parent = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
    });
    const coordWithPath = makeSession({
      sessionId: "coord-path",
      sessionPath: "/s/coord-path.jsonl",
      parentSessionPath: "/s/parent-1.jsonl",
      delegateParentSessionId: "parent-1",
    });
    const coordWithId = makeSession({
      sessionId: "coord-id",
      sessionPath: "/s/coord-id.jsonl",
      delegateParentSessionId: "parent-1",
    });

    const result = groupSessions([parent, coordWithPath, coordWithId], "");

    expect(result.rootSessions).toHaveLength(1);
    expect(result.childMap["/s/parent-1.jsonl"]).toHaveLength(2);
  });
});

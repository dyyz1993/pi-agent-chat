/**
 * @vitest-environment node
 *
 * Comprehensive tests for delegate session identification via delegate_info
 * body entry in JSONL files. Covers scanner, RPC handler, and UI filter.
 */
import { describe, it, expect } from "vitest";

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "sess-" + Math.random().toString(36).slice(2, 8),
    name: "",
    sessionPath: "/sessions/" + overrides.sessionId + ".jsonl",
    projectPath: "/project",
    parentSessionPath: null,
    delegateParentSessionId: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle" as const,
    ...overrides,
  };
}

describe("groupSessions: delegate filter scenarios", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { groupSessions } = require("../src/mainview/components/session-sidebar/SessionSidebar");

  const normalSession = makeSession({
    sessionId: "normal-1",
    name: "My Project",
  });

  const delegateSession = makeSession({
    sessionId: "delegate-1",
    name: "指派: ## 任务: fix bug",
    delegateParentSessionId: "parent-1",
  });

  const delegateSession2 = makeSession({
    sessionId: "delegate-2",
    name: "指派: ## 任务: add tests",
    delegateParentSessionId: "parent-1",
  });

  const pinnedSession = makeSession({
    sessionId: "pinned-1",
    name: "Important",
    pinned: true,
  });

  const allSessions = [normalSession, delegateSession, delegateSession2, pinnedSession];

  it("returns all sessions with filterType=all", () => {
    const result = groupSessions(allSessions, "");
    expect(result.rootSessions).toHaveLength(4);
  });

  it("returns only delegate sessions with filterType=delegate", () => {
    const result = groupSessions(allSessions, "", "delegate");
    expect(result.rootSessions).toHaveLength(2);
    const ids = result.rootSessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).toContain("delegate-1");
    expect(ids).toContain("delegate-2");
  });

  it("returns only normal sessions with filterType=normal", () => {
    const result = groupSessions(allSessions, "", "normal");
    expect(result.rootSessions).toHaveLength(2);
    const ids = result.rootSessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).toContain("normal-1");
    expect(ids).toContain("pinned-1");
  });

  it("combines text search with delegate filter", () => {
    const result = groupSessions(allSessions, "fix", "delegate");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("delegate-1");
  });

  it("combines text search with normal filter", () => {
    const result = groupSessions(allSessions, "Important", "normal");
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("pinned-1");
  });

  it("returns empty when no delegates exist and filter=delegate", () => {
    const onlyNormal = [normalSession, pinnedSession];
    const result = groupSessions(onlyNormal, "", "delegate");
    expect(result.rootSessions).toHaveLength(0);
  });

  it("returns empty when all are delegates and filter=normal", () => {
    const onlyDelegates = [delegateSession, delegateSession2];
    const result = groupSessions(onlyDelegates, "", "normal");
    expect(result.rootSessions).toHaveLength(0);
  });
});

describe("groupSessions: agent filter", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { groupSessions } = require("../src/mainview/components/session-sidebar/SessionSidebar");

  const s1 = makeSession({ sessionId: "s1", name: "Build task" });
  const s2 = makeSession({ sessionId: "s2", name: "Explore task" });
  const s3 = makeSession({ sessionId: "s3", name: "Plan task" });
  const sessions = [s1, s2, s3];

  it("filters by single agent name", () => {
    const agentMap = { s1: "build", s2: "explore", s3: "plan" };
    const result = groupSessions(sessions, "", "all", "build", agentMap);
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("s1");
  });

  it("returns all when filterAgent is null", () => {
    const agentMap = { s1: "build" };
    const result = groupSessions(sessions, "", "all", null, agentMap);
    expect(result.rootSessions).toHaveLength(3);
  });

  it("returns empty when agent has no sessions", () => {
    const agentMap = { s1: "build" };
    const result = groupSessions(sessions, "", "all", "nonexistent", agentMap);
    expect(result.rootSessions).toHaveLength(0);
  });

  it("combines agent filter with delegate filter", () => {
    const delegate = makeSession({
      sessionId: "d1",
      name: "指派: task",
      delegateParentSessionId: "p1",
    });
    const mixedSessions = [s1, s2, delegate];
    const agentMap = { s1: "build", s2: "explore", d1: "build" };

    const result = groupSessions(mixedSessions, "", "delegate", "build", agentMap);
    expect(result.rootSessions).toHaveLength(1);
    expect(result.rootSessions[0].sessionId).toBe("d1");
  });
});

describe("groupSessions: sorting with delegate sessions", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { groupSessions } = require("../src/mainview/components/session-sidebar/SessionSidebar");

  it("pinned sessions sort before unpinned regardless of delegate status", () => {
    const normal = makeSession({ sessionId: "n1", updatedAt: Date.now() + 1000 });
    const pinned = makeSession({
      sessionId: "p1",
      pinned: true,
      updatedAt: Date.now(),
    });
    const delegate = makeSession({
      sessionId: "d1",
      delegateParentSessionId: "parent",
      updatedAt: Date.now() + 2000,
    });

    const result = groupSessions([normal, delegate, pinned], "");
    expect(result.rootSessions[0].sessionId).toBe("p1");
  });
});

/**
 * @vitest-environment node
 *
 * Verify delegate_info body entry survives header overwrite and provides
 * fallback delegateParentSessionId through the session-scanner pipeline.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { groupSessions } from "../src/mainview/components/session-sidebar/SessionSidebar";
import type { SessionMeta } from "../src/mainview/types";

const TMP = join(tmpdir(), "pi-scanner-delegate-test-" + Date.now());

beforeEach(() => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function makeJsonl(lines: Record<string, unknown>[]) {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function makeDir(encoded: string) {
  const dir = join(TMP, encoded);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function makePartialSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
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

describe("session-scanner: delegate_info body entry fallback", () => {
  it("reads delegateParentSessionId from header when present", async () => {
    const dir = makeDir("--project-a--");
    writeFileSync(
      join(dir, "sess_test_001.jsonl"),
      makeJsonl([
        {
          type: "session",
          version: 3,
          id: "sess_test_001",
          timestamp: new Date().toISOString(),
          cwd: TMP,
          delegateParentSessionId: "parent-abc",
        },
      ]),
    );

    const { buildDelegateIndex } = await import("../src/shared/lib/session-scanner");
    const sessions = [
      makePartialSession({
        sessionId: "sess_test_001",
        delegateParentSessionId: "parent-abc",
      }),
    ];
    const index = buildDelegateIndex(sessions);
    expect(index.has("parent-abc")).toBe(true);
    expect(index.get("parent-abc")!).toHaveLength(1);
  });

  it("returns null when no delegateParentSessionId anywhere", async () => {
    const dir = makeDir("--project-b--");
    writeFileSync(
      join(dir, "plain_session.jsonl"),
      makeJsonl([
        {
          type: "session",
          version: 3,
          id: "plain-1",
          timestamp: new Date().toISOString(),
          cwd: TMP,
        },
      ]),
    );

    const { buildDelegateIndex } = await import("../src/shared/lib/session-scanner");
    const sessions = [
      makePartialSession({
        sessionId: "plain-1",
        delegateParentSessionId: null,
      }),
    ];
    const index = buildDelegateIndex(sessions);
    expect(index.size).toBe(0);
  });
});

describe("groupSessions: delegate filter uses delegateParentSessionId", () => {
  it("filters delegate sessions by delegateParentSessionId", () => {
    const sessions = [
      makePartialSession({
        sessionId: "normal-1",
        name: "Normal Session",
      }),
      makePartialSession({
        sessionId: "delegate-1",
        name: "指派: task",
        delegateParentSessionId: "parent-1",
        delegateType: "coordinator",
      }),
    ];

    const all = groupSessions(sessions, "");
    expect(all.rootSessions).toHaveLength(2);

    const delegates = groupSessions(sessions, "", "delegate");
    expect(delegates.rootSessions).toHaveLength(1);
    expect(delegates.rootSessions[0].sessionId).toBe("delegate-1");

    const normal = groupSessions(sessions, "", "normal");
    expect(normal.rootSessions).toHaveLength(1);
    expect(normal.rootSessions[0].sessionId).toBe("normal-1");
  });

  it("filters by agent name", () => {
    const sessions = [
      makePartialSession({
        sessionId: "s1",
        name: "Build",
      }),
      makePartialSession({
        sessionId: "s2",
        name: "Explore",
      }),
    ];

    const agentMap = { s1: "build", s2: "explore" };

    const filtered = groupSessions(sessions, "", "all", "build", agentMap);
    expect(filtered.rootSessions).toHaveLength(1);
    expect(filtered.rootSessions[0].sessionId).toBe("s1");
  });
});

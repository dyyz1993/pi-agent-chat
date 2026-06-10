/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { findCoordinatorResponseManaged } from "../../../src/shared/agent/coordinator-response-routing";

interface TestManaged {
  _activeSessionId: string;
}

describe("coordinator response routing", () => {
  it("returns the active managed client when it is already available", () => {
    const active = { _activeSessionId: "session-a" };

    expect(
      findCoordinatorResponseManaged({
        active,
        sessionId: "session-a",
        sessionProjectPaths: new Map(),
        processByCwd: new Map<string, Set<TestManaged>>(),
      }),
    ).toEqual({
      managed: active,
      matchedViaFallback: false,
      projectPath: undefined,
      processCount: undefined,
    });
  });

  it("falls back through processByCwd when the active client was evicted", () => {
    const managed = { _activeSessionId: "session-a" };

    expect(
      findCoordinatorResponseManaged({
        active: undefined,
        sessionId: "session-a",
        sessionProjectPaths: new Map([["session-a", "/repo/app"]]),
        processByCwd: new Map([["/repo/app", new Set<TestManaged>([managed])]]),
      }),
    ).toEqual({
      managed,
      matchedViaFallback: true,
      projectPath: "/repo/app",
      processCount: 1,
    });
  });

  it("reports fallback metadata when no matching process exists", () => {
    const other = { _activeSessionId: "session-b" };

    expect(
      findCoordinatorResponseManaged({
        active: undefined,
        sessionId: "session-a",
        sessionProjectPaths: new Map([["session-a", "/repo/app"]]),
        processByCwd: new Map([["/repo/app", new Set<TestManaged>([other])]]),
      }),
    ).toEqual({
      managed: undefined,
      matchedViaFallback: false,
      projectPath: "/repo/app",
      processCount: 1,
    });
  });

  it("skips fallback when the session has no project path record", () => {
    expect(
      findCoordinatorResponseManaged({
        active: undefined,
        sessionId: "session-a",
        sessionProjectPaths: new Map(),
        processByCwd: new Map<string, Set<TestManaged>>(),
      }),
    ).toEqual({
      managed: undefined,
      matchedViaFallback: false,
      projectPath: undefined,
      processCount: undefined,
    });
  });
});

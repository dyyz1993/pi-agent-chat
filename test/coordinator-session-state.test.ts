/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  canStopDelegateChild,
  clearDelegateTracking,
  findParentSession,
  listDelegateChildSessions,
  popDelegateChildren,
  registerDelegateChild,
  removeDelegateChild,
  removeSessionFromAllParents,
} from "../src/shared/agent/coordinator-session-state";

describe("coordinator session state helpers", () => {
  it("registers children and finds their parent session", () => {
    const parentChildMap = new Map<string, Set<string>>();

    registerDelegateChild(parentChildMap, "parent-a", "child-1");
    registerDelegateChild(parentChildMap, "parent-a", "child-2");

    expect([...parentChildMap.get("parent-a") ?? []]).toEqual(["child-1", "child-2"]);
    expect(findParentSession(parentChildMap, "child-2")).toBe("parent-a");
    expect(findParentSession(parentChildMap, "missing")).toBeNull();
  });

  it("removes a child and drops empty parent buckets", () => {
    const parentChildMap = new Map<string, Set<string>>([
      ["parent-a", new Set(["child-1"])],
    ]);

    expect(removeDelegateChild(parentChildMap, "parent-a", "child-1")).toBe(true);
    expect(parentChildMap.has("parent-a")).toBe(false);
    expect(removeDelegateChild(parentChildMap, "parent-a", "child-1")).toBe(false);
  });

  it("removes a session from every parent bucket", () => {
    const parentChildMap = new Map<string, Set<string>>([
      ["parent-a", new Set(["child-1", "child-2"])],
      ["parent-b", new Set(["child-1"])],
    ]);

    removeSessionFromAllParents(parentChildMap, "child-1");

    expect([...parentChildMap.get("parent-a") ?? []]).toEqual(["child-2"]);
    expect(parentChildMap.has("parent-b")).toBe(false);
  });

  it("pops children for cascade stop", () => {
    const parentChildMap = new Map<string, Set<string>>([
      ["parent-a", new Set(["child-1", "child-2"])],
    ]);

    expect(popDelegateChildren(parentChildMap, "parent-a")).toEqual(["child-1", "child-2"]);
    expect(parentChildMap.has("parent-a")).toBe(false);
    expect(popDelegateChildren(parentChildMap, "parent-a")).toEqual([]);
  });

  it("clears delegate reply tracking for a session", () => {
    const createdAt = new Map([["child-1", 123]]);
    const replyCount = new Map([["child-1", 2]]);

    expect(clearDelegateTracking(createdAt, replyCount, "child-1")).toBe(true);
    expect(createdAt.has("child-1")).toBe(false);
    expect(replyCount.has("child-1")).toBe(false);
    expect(clearDelegateTracking(createdAt, replyCount, "child-1")).toBe(false);
  });

  it("lists only active child sessions", () => {
    const parentChildMap = new Map<string, Set<string>>([
      ["parent-a", new Set(["child-active", "child-missing"])],
    ]);
    const clients = new Map([
      [
        "child-active",
        {
          info: {
            status: "streaming",
            projectPath: "/repo/app",
          },
        },
      ],
    ]);

    expect(listDelegateChildSessions(parentChildMap, clients, "parent-a")).toEqual({
      sessions: [{ sessionId: "child-active", status: "streaming", projectPath: "/repo/app" }],
    });
    expect(canStopDelegateChild(parentChildMap, "parent-a", "child-active")).toBe(true);
    expect(canStopDelegateChild(parentChildMap, "parent-a", "child-missing")).toBe(true);
    expect(canStopDelegateChild(parentChildMap, "parent-b", "child-active")).toBe(false);
  });
});

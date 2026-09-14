import { describe, it, expect, beforeEach } from "vitest";
import {
  setSessionOwner,
  getSessionOwner,
  canAccessSession,
  addUserProjectRoot,
  getUserProjectRoots,
  isRequestAllowed,
  isEventVisible,
} from "../../../src/shared/agent/session-ownership";

describe("session-ownership", () => {
  beforeEach(() => {
    // Module-level registries: reset via create/delete round-trip.
    setSessionOwner("s-alice", "alice");
    setSessionOwner("s-bob", "bob");
  });

  describe("canAccessSession", () => {
    it("admin (undefined uid) passes everywhere", () => {
      expect(canAccessSession("s-alice", undefined)).toBe(true);
      expect(canAccessSession("s-unknown", undefined)).toBe(true);
    });

    it("owner passes on own session", () => {
      expect(canAccessSession("s-alice", "alice")).toBe(true);
    });

    it("owner fails on someone else's session", () => {
      expect(canAccessSession("s-bob", "alice")).toBe(false);
    });

    it("token-user fails on unregistered (admin or pre-restart) sessions", () => {
      expect(canAccessSession("s-admin-only", "alice")).toBe(false);
    });
  });

  describe("setSessionOwner", () => {
    it("admin sessions are not registered", () => {
      setSessionOwner("s-x", undefined);
      expect(getSessionOwner("s-x")).toBeUndefined();
    });
  });

  describe("isRequestAllowed", () => {
    it("admin passes without inspection", () => {
      expect(isRequestAllowed("agent.start", { sessionId: "s-bob" }, undefined)).toBe(true);
    });

    it("token-user passes own sessionId, fails foreign", () => {
      expect(isRequestAllowed("agent.start", { sessionId: "s-alice" }, "alice")).toBe(true);
      expect(isRequestAllowed("agent.start", { sessionId: "s-bob" }, "alice")).toBe(false);
    });

    it("requests without sessionId are not gated", () => {
      expect(isRequestAllowed("project.list", { foo: 1 }, "alice")).toBe(true);
      expect(isRequestAllowed("agent.ping", undefined, "alice")).toBe(true);
    });
  });

  describe("isEventVisible", () => {
    it("hides foreign session events carried in payload", () => {
      expect(
        isEventVisible("agent.event", { sessionId: "s-bob", event: {} }, { sessionId: "s-bob" }, "alice"),
      ).toBe(false);
    });

    it("shows own session events from payload or metadata", () => {
      expect(isEventVisible("agent.event", { sessionId: "s-alice" }, undefined, "alice")).toBe(true);
      expect(isEventVisible("agent.event", undefined, { sessionId: "s-alice" }, "alice")).toBe(true);
    });

    it("global events without sessionId are visible to everyone", () => {
      expect(isEventVisible("session.list_changed", { foo: 1 }, undefined, "alice")).toBe(true);
    });
  });

  describe("project roots", () => {
    it("normalizes and returns roots per user", () => {
      addUserProjectRoot("carol", "/tmp/proj-a");
      addUserProjectRoot("carol", "/tmp/proj-b");
      addUserProjectRoot("dave", "/tmp/proj-c");
      const roots = getUserProjectRoots("carol");
      expect(roots).toContain("/tmp/proj-a");
      expect(roots).toContain("/tmp/proj-b");
      expect(roots).not.toContain("/tmp/proj-c");
    });
  });
});

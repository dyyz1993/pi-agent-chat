import { describe, it, expect } from "vitest";
import type { SessionMeta } from "../src/mainview/types";
import { insertAfterPinned } from "../src/mainview/stores/use-session-store";

function makeSession(id: string, overrides?: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId: id,
    name: "",
    sessionPath: `/sessions/${id}.jsonl`,
    projectPath: "/project",
    parentSessionPath: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    ...overrides,
  };
}

describe("insertAfterPinned", () => {
  it("should insert at position 0 when no sessions are pinned", () => {
    const existing = [makeSession("a"), makeSession("b"), makeSession("c")];
    const newSession = makeSession("new");

    const result = insertAfterPinned(existing, newSession);

    expect(result[0]).toEqual(newSession);
    expect(result).toHaveLength(4);
  });

  it("should insert after all pinned sessions", () => {
    const pinned1 = makeSession("p1", { pinned: true });
    const pinned2 = makeSession("p2", { pinned: true });
    const normal1 = makeSession("n1");
    const normal2 = makeSession("n2");

    const existing = [pinned1, pinned2, normal1, normal2];
    const newSession = makeSession("new");

    const result = insertAfterPinned(existing, newSession);

    expect(result[0]).toEqual(pinned1);
    expect(result[1]).toEqual(pinned2);
    expect(result[2]).toEqual(newSession);
    expect(result[3]).toEqual(normal1);
    expect(result[4]).toEqual(normal2);
  });

  it("should insert after the only pinned session", () => {
    const pinned = makeSession("p1", { pinned: true });
    const normal1 = makeSession("n1");
    const normal2 = makeSession("n2");

    const existing = [pinned, normal1, normal2];
    const newSession = makeSession("new");

    const result = insertAfterPinned(existing, newSession);

    expect(result[0]).toEqual(pinned);
    expect(result[1]).toEqual(newSession);
    expect(result[2]).toEqual(normal1);
  });

  it("should handle pinned session at the end", () => {
    const normal1 = makeSession("n1");
    const pinned = makeSession("p1", { pinned: true });

    const existing = [normal1, pinned];
    const newSession = makeSession("new");

    const result = insertAfterPinned(existing, newSession);

    expect(result[0]).toEqual(normal1);
    expect(result[1]).toEqual(pinned);
    expect(result[2]).toEqual(newSession);
  });

  it("should handle empty sessions array", () => {
    const newSession = makeSession("new");

    const result = insertAfterPinned([], newSession);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(newSession);
  });

  it("should treat undefined pinned as not pinned", () => {
    const existing = [makeSession("a"), makeSession("b")];
    const newSession = makeSession("new");

    const result = insertAfterPinned(existing, newSession);

    expect(result[0]).toEqual(newSession);
    expect(result).toHaveLength(3);
  });

  it("should not mutate the original array", () => {
    const existing = [makeSession("a", { pinned: true }), makeSession("b")];
    const newSession = makeSession("new");

    const result = insertAfterPinned(existing, newSession);

    expect(existing).toHaveLength(2);
    expect(result).toHaveLength(3);
  });
});

describe("fork session naming", () => {
  it("should produce 'fork: <name>' when original session has a name", () => {
    const originalName = "my coding session";
    const forkedName = originalName ? `fork: ${originalName}` : "";

    expect(forkedName).toBe("fork: my coding session");
  });

  it("should produce 'fork: <firstMessage>' when session has no name but has firstMessage", () => {
    const session = { name: "", firstMessage: "hello world" };
    const originalName = session.name || session.firstMessage || "";
    const forkedName = originalName ? `fork: ${originalName}` : "";

    expect(forkedName).toBe("fork: hello world");
  });

  it("should produce empty name when session has no name and no firstMessage", () => {
    const session = { name: "", firstMessage: "" };
    const originalName = session.name || session.firstMessage || "";
    const forkedName = originalName ? `fork: ${originalName}` : "";

    expect(forkedName).toBe("");
  });
});

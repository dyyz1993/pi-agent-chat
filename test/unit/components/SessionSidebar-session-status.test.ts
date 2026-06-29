import { describe, expect, it } from "vitest";
import { getSessionSidebarStatus } from "../../../src/mainview/components/session-sidebar/SessionSidebar";
import type { SessionMeta } from "../../../src/mainview/types";

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: "sess-1",
    name: "Session",
    sessionPath: "/tmp/sess-1.jsonl",
    projectPath: "/project",
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 1,
    firstMessage: "hello",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    ...overrides,
  };
}

describe("getSessionSidebarStatus", () => {
  it("prefers runtime state for permission and retrying", () => {
    expect(getSessionSidebarStatus(makeSession(), "permission")).toBe("permission");
    expect(getSessionSidebarStatus(makeSession(), "retrying")).toBe("retrying");
  });

  it("treats persisted running state as working when runtime map is missing", () => {
    expect(getSessionSidebarStatus(makeSession({ status: "running" }))).toBe("working");
    expect(getSessionSidebarStatus(makeSession({ sessionStatus: "streaming" }))).toBe("working");
    expect(getSessionSidebarStatus(makeSession({ sessionStatus: "retrying" }))).toBe("working");
  });

  it("keeps idle only when neither runtime nor persisted state is live", () => {
    expect(getSessionSidebarStatus(makeSession(), "idle")).toBe("idle");
    expect(getSessionSidebarStatus(makeSession())).toBe("idle");
  });
});

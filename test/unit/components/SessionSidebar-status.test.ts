import { describe, expect, it } from "vitest";
import { getSubagentSidebarStatus } from "../../../src/mainview/components/session-sidebar/SessionSidebar";
import type { SubagentSessionInfo } from "../../../src/mainview/types";

function makeSub(overrides: Partial<SubagentSessionInfo> = {}): SubagentSessionInfo {
  return {
    sessionId: "sub-1",
    sessionPath: "/tmp/sub-1.jsonl",
    description: "Sub task",
    instruction: "Do work",
    startedAt: 1,
    ...overrides,
  };
}

describe("getSubagentSidebarStatus", () => {
  it("prefers live runtime states over persisted completion fields", () => {
    expect(getSubagentSidebarStatus(makeSub({ completedAt: 123 }), "streaming")).toBe("running");
    expect(getSubagentSidebarStatus(makeSub(), "permission")).toBe("permission");
    expect(getSubagentSidebarStatus(makeSub(), "retrying")).toBe("retrying");
  });

  it("treats idle runtime state as completed even when completedAt is missing", () => {
    expect(getSubagentSidebarStatus(makeSub(), "idle")).toBe("idle");
  });

  it("uses authoritative child session idle state to clear stale subagent streaming state", () => {
    expect(getSubagentSidebarStatus(makeSub(), "streaming", "idle")).toBe("idle");
    expect(getSubagentSidebarStatus(makeSub(), "permission", "idle")).toBe("permission");
  });

  it("falls back to persisted error and completion markers when runtime state is absent", () => {
    expect(getSubagentSidebarStatus(makeSub({ exitCode: 1 }))).toBe("error");
    expect(getSubagentSidebarStatus(makeSub({ completedAt: 456 }))).toBe("idle");
    expect(getSubagentSidebarStatus(makeSub())).toBe("running");
  });
});

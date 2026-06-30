import { describe, expect, it } from "vitest";
import {
  getSubagentSidebarStatus,
  sortSubagentsForSidebar,
} from "../../../src/mainview/components/session-sidebar/SessionSidebar";
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

describe("sortSubagentsForSidebar", () => {
  it("moves subagents needing help above running and idle subagents", () => {
    const idle = makeSub({ sessionId: "idle", startedAt: 30, completedAt: 40 });
    const running = makeSub({ sessionId: "running", startedAt: 20 });
    const permission = makeSub({ sessionId: "permission", startedAt: 10 });

    const sorted = sortSubagentsForSidebar([idle, running, permission], {
      permission: "permission",
      running: "streaming",
      idle: "idle",
    });

    expect(sorted.map((sub) => sub.sessionId)).toEqual(["permission", "running", "idle"]);
  });

  it("keeps newer subagents first when they share the same sidebar status", () => {
    const older = makeSub({ sessionId: "older", startedAt: 10 });
    const newer = makeSub({ sessionId: "newer", startedAt: 20 });

    const sorted = sortSubagentsForSidebar([older, newer], {
      older: "streaming",
      newer: "streaming",
    });

    expect(sorted.map((sub) => sub.sessionId)).toEqual(["newer", "older"]);
  });
});

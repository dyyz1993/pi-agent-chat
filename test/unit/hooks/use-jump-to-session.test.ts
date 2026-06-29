import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  setActiveProject: vi.fn(),
  setActiveSession: vi.fn(),
  loadSessionsForProject: vi.fn(),
  setActiveSubsession: vi.fn(),
  loadSubsessions: vi.fn(),
  setReturnSource: vi.fn(),
  activeSubsessionId: null as string | null,
  sessionState: {
    activeSessionId: "origin-session",
    activeProjectId: "project-a",
    projectTabs: [{ id: "project-a", path: "/project-a" }],
    sessionsByProject: {
      "/project-a": [
        {
          sessionId: "parent-session",
          name: "Parent",
          projectPath: "/project-a",
          sessionPath: "/sessions/parent.jsonl",
          parentSessionPath: null,
          delegateParentSessionId: null,
          delegateType: null,
          messageCount: 1,
          firstMessage: "parent",
          createdAt: 1,
          updatedAt: 2,
          status: "idle" as const,
        },
        {
          sessionId: "sess_sub_child",
          name: "Child",
          projectPath: "/project-a",
          sessionPath: "/sessions/child.jsonl",
          parentSessionPath: "/sessions/parent.jsonl",
          delegateParentSessionId: "parent-session",
          delegateType: "subagent",
          messageCount: 1,
          firstMessage: "child",
          createdAt: 2,
          updatedAt: 3,
          status: "idle" as const,
        },
        {
          sessionId: "delegate-session",
          name: "Delegate",
          projectPath: "/project-a",
          sessionPath: "/sessions/delegate.jsonl",
          parentSessionPath: null,
          delegateParentSessionId: "parent-session",
          delegateType: "coordinator",
          messageCount: 1,
          firstMessage: "delegate",
          createdAt: 3,
          updatedAt: 4,
          status: "idle" as const,
        },
      ],
    } as Record<string, unknown[]>,
  },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => ({
      ...hoisted.sessionState,
      setActiveProject: hoisted.setActiveProject,
      setActiveSession: hoisted.setActiveSession,
      loadSessionsForProject: hoisted.loadSessionsForProject,
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: {
    getState: () => ({
      activeSubsessionId: hoisted.activeSubsessionId,
      setActiveSubsession: hoisted.setActiveSubsession,
      loadSubsessions: hoisted.loadSubsessions,
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-session-return-store", () => ({
  useSessionReturnStore: {
    getState: () => ({
      setReturnSource: hoisted.setReturnSource,
    }),
  },
}));

import { jumpToSessionById } from "../../../src/mainview/components/chat/primitives/useJumpToSession";

describe("jumpToSessionById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.activeSubsessionId = null;
    hoisted.sessionState.activeSessionId = "origin-session";
    hoisted.sessionState.activeProjectId = "project-a";
    hoisted.loadSessionsForProject.mockImplementation(async (path: string) => {
      return (hoisted.sessionState.sessionsByProject[path] ?? []) as unknown[];
    });
  });

  it("opens subagent sessions through the parent session view and activates activeSubsession", async () => {
    await jumpToSessionById("sess_sub_child", { returnSourceSessionId: "origin-session" });

    expect(hoisted.setActiveSession).toHaveBeenCalledWith("parent-session", true);
    expect(hoisted.loadSubsessions).toHaveBeenCalledWith("/sessions/parent.jsonl");
    expect(hoisted.setActiveSubsession).toHaveBeenCalledWith("parent-session", "sess_sub_child");
    expect(hoisted.setReturnSource).toHaveBeenCalledWith("parent-session", "origin-session");
    expect(hoisted.setActiveSession).not.toHaveBeenCalledWith("sess_sub_child", true);
  });

  it("keeps non-subagent delegate sessions as normal session jumps", async () => {
    await jumpToSessionById("delegate-session", { returnSourceSessionId: "origin-session" });

    expect(hoisted.setActiveSession).toHaveBeenCalledWith("delegate-session", true);
    expect(hoisted.setActiveSubsession).not.toHaveBeenCalledWith(
      "parent-session",
      "delegate-session",
    );
    expect(hoisted.setReturnSource).toHaveBeenCalledWith("delegate-session", "origin-session");
  });

  it("clears the previously active subagent view before switching to another target", async () => {
    hoisted.activeSubsessionId = "existing-sub";
    hoisted.sessionState.activeSessionId = "main-session";

    await jumpToSessionById("delegate-session");

    expect(hoisted.setActiveSubsession).toHaveBeenCalledWith("main-session", null);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  jumpToSessionById: vi.fn<(_: string) => Promise<void>>(),
  setActiveSession: vi.fn(),
  setActiveSubsession: vi.fn(),
  loadSubsessions: vi.fn<(_: string) => Promise<unknown[]>>(),
  sessionsByProject: {
    "/project-a": [
      {
        sessionId: "parent-1",
        sessionPath: "/sessions/parent-1.jsonl",
      },
    ],
  },
}));

vi.mock("../../../src/mainview/components/chat/primitives/useJumpToSession", () => ({
  jumpToSessionById: hoisted.jumpToSessionById,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => ({
      setActiveSession: hoisted.setActiveSession,
      sessionsByProject: hoisted.sessionsByProject,
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: {
    getState: () => ({
      setActiveSubsession: hoisted.setActiveSubsession,
      loadSubsessions: hoisted.loadSubsessions,
    }),
  },
}));

import { openSidebarSubagentSession } from "../../../src/mainview/components/session-sidebar/SessionSidebar";

describe("openSidebarSubagentSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadSubsessions.mockResolvedValue([]);
  });

  it("opens known sidebar subagents through the parent session view", async () => {
    hoisted.jumpToSessionById.mockResolvedValueOnce();

    await openSidebarSubagentSession("parent-1", "sub-1");

    expect(hoisted.jumpToSessionById).not.toHaveBeenCalled();
    expect(hoisted.setActiveSession).toHaveBeenCalledWith("parent-1", true);
    expect(hoisted.loadSubsessions).toHaveBeenCalledWith("/sessions/parent-1.jsonl");
    expect(hoisted.setActiveSubsession).toHaveBeenCalledWith("parent-1", "sub-1");
    expect(hoisted.loadSubsessions.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.setActiveSubsession.mock.invocationCallOrder[0],
    );
  });

  it("does not depend on generic jump resolution for sidebar subagents", async () => {
    hoisted.jumpToSessionById.mockRejectedValueOnce(new Error("not found"));

    await openSidebarSubagentSession("parent-1", "sub-1");

    expect(hoisted.jumpToSessionById).not.toHaveBeenCalled();
    expect(hoisted.setActiveSession).toHaveBeenCalledWith("parent-1", true);
    expect(hoisted.loadSubsessions).toHaveBeenCalledWith("/sessions/parent-1.jsonl");
    expect(hoisted.setActiveSubsession).toHaveBeenCalledWith("parent-1", "sub-1");
  });
});

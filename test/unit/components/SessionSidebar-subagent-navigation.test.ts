import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  jumpToSessionById: vi.fn<(_: string) => Promise<void>>(),
  setActiveSession: vi.fn(),
  setActiveSubsession: vi.fn(),
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
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: {
    getState: () => ({
      setActiveSubsession: hoisted.setActiveSubsession,
    }),
  },
}));

import { openSidebarSubagentSession } from "../../../src/mainview/components/session-sidebar/SessionSidebar";

describe("openSidebarSubagentSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers the shared jumpToSessionById flow", async () => {
    hoisted.jumpToSessionById.mockResolvedValueOnce();

    await openSidebarSubagentSession("parent-1", "sub-1");

    expect(hoisted.jumpToSessionById).toHaveBeenCalledWith("sub-1");
    expect(hoisted.setActiveSession).not.toHaveBeenCalled();
    expect(hoisted.setActiveSubsession).not.toHaveBeenCalled();
  });

  it("falls back to parent + activeSubsession activation when shared jump fails", async () => {
    hoisted.jumpToSessionById.mockRejectedValueOnce(new Error("not found"));

    await openSidebarSubagentSession("parent-1", "sub-1");

    expect(hoisted.setActiveSession).toHaveBeenCalledWith("parent-1", true);
    expect(hoisted.setActiveSubsession).toHaveBeenCalledWith("parent-1", "sub-1");
  });
});

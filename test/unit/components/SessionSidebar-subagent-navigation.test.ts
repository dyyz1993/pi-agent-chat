import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  jumpToSessionById:
    vi.fn<(_: string, __?: { subagentParentSessionId?: string }) => Promise<void>>(),
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

import { openSidebarSubagentSession } from "../../../src/mainview/components/session-sidebar/SessionSidebar";

describe("openSidebarSubagentSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.jumpToSessionById.mockResolvedValue(undefined);
  });

  it("opens sidebar subagents through the shared session jump path", async () => {
    await openSidebarSubagentSession("parent-1", "sub-1");

    expect(hoisted.jumpToSessionById).toHaveBeenCalledWith("sub-1", {
      subagentParentSessionId: "parent-1",
    });
  });

  it("propagates shared jump errors to the caller", async () => {
    hoisted.jumpToSessionById.mockRejectedValueOnce(new Error("not found"));

    await expect(openSidebarSubagentSession("parent-1", "sub-1")).rejects.toThrow("not found");

    expect(hoisted.jumpToSessionById).toHaveBeenCalledWith("sub-1", {
      subagentParentSessionId: "parent-1",
    });
  });
});

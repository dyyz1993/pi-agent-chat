import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const returnTargetMock = vi.hoisted(() => ({
  target: null as
    | null
    | {
        kind: "subagent" | "delegate" | "source";
        targetSessionId: string;
        handleReturn: () => void;
      },
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      (
        {
          backToMain: "Back to main session",
          backToDelegate: "Back to delegator",
          backToSource: "Back to source",
        } as Record<string, string>
      )[key] ?? fallback ?? key,
  }),
}));

vi.mock("../../../src/mainview/components/chat/primitives/useReturnToSourceSession", () => ({
  useReturnToSourceSession: () => returnTargetMock.target,
}));

import { ReturnToSourceButton } from "../../../src/mainview/components/chat/ChatPanel";

describe("ReturnToSourceButton", () => {
  afterEach(() => {
    cleanup();
    returnTargetMock.target = null;
  });

  it("shows a main-session label for subagent returns", () => {
    returnTargetMock.target = {
      kind: "subagent",
      targetSessionId: "main-session",
      handleReturn: vi.fn(),
    };

    render(<ReturnToSourceButton />);

    expect(screen.getByRole("button", { name: "Back to main session" })).toBeTruthy();
  });

  it("shows a delegator label for delegate returns", () => {
    returnTargetMock.target = {
      kind: "delegate",
      targetSessionId: "parent-session",
      handleReturn: vi.fn(),
    };

    render(<ReturnToSourceButton />);

    expect(screen.getByRole("button", { name: "Back to delegator" })).toBeTruthy();
  });

  it("calls handleReturn when clicked", () => {
    const handleReturn = vi.fn();
    returnTargetMock.target = {
      kind: "source",
      targetSessionId: "source-session",
      handleReturn,
    };

    render(<ReturnToSourceButton />);
    fireEvent.click(screen.getByRole("button", { name: "Back to source" }));

    expect(handleReturn).toHaveBeenCalledOnce();
  });
});

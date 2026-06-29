import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackToMainSessionButton } from "../../../src/mainview/components/chat/ChatPanel";
import { useSubagentStore } from "../../../src/mainview/stores/use-subagent-store";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => ({ backToMain: "Back to main session" })[key] ?? key,
  }),
}));

describe("BackToMainSessionButton", () => {
  const originalSetActiveSubsession = useSubagentStore.getState().setActiveSubsession;

  afterEach(() => {
    cleanup();
    useSubagentStore.setState({ setActiveSubsession: originalSetActiveSubsession });
  });

  it("uses a compact bottom-action style that keeps the label on one line", () => {
    const onBack = vi.fn();
    render(<BackToMainSessionButton onBack={onBack} />);

    const button = screen.getByRole("button", { name: "Back to main session" });
    expect(button.className).toContain("whitespace-nowrap");
    expect(button.className).toContain("justify-center");

    fireEvent.click(button);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("clears the active sub-session for the current main session", () => {
    const setActiveSubsession = vi.fn();
    useSubagentStore.setState({ setActiveSubsession });

    render(<BackToMainSessionButton activeSessionId="main-session" />);
    fireEvent.click(screen.getByRole("button", { name: "Back to main session" }));

    expect(setActiveSubsession).toHaveBeenCalledWith("main-session", null);
  });
});

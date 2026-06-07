/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageCard } from "../src/mainview/components/chat/MessageCard";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import type { ChatMessage } from "../src/mainview/types";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  cleanup();
  useSessionStore.setState({ activeSessionId: null });
});

describe("MessageCard stop boundary rendering", () => {
  it("does not render role error with stopReason stop as a red error card", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const message: ChatMessage = {
      id: "msg-stop-boundary",
      role: "error",
      content: [{ type: "text", text: "Memory loaded. Continue with the next step." }],
      timestamp: Date.now(),
      stopReason: "stop",
    };

    const { container } = render(<MessageCard message={message} />);

    expect(screen.getByText("Memory loaded. Continue with the next step.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("bg-status-error");
    expect(container.innerHTML).not.toContain("text-status-error");
  });
});

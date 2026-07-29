/**
 * @vitest-environment happy-dom
 *
 * Regression for the customType drift between fork and app:
 * fork (goal-vendor extension) writes `customType: "pi-goal-complete"`,
 * app used to look for `"supervisor_goal_complete"` (legacy name from
 * before the supervisor → goal-vendor migration).
 *
 * If app doesn't recognise `pi-goal-complete`, the GoalCompleteCard
 * doesn't render and the user sees a blank / mis-rendered message.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageCard } from "../../../src/mainview/components/chat/MessageCard";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useTurnStore } from "../../../src/mainview/stores/use-turn-store";
import type { ChatMessage } from "../../../src/mainview/types";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  useSessionStore.setState({ activeSessionId: null });
  useTurnStore.setState({
    selectedMessageIdsBySession: {},
    collapsedMessageIdsBySession: {},
    isMultiSelectModeBySession: {},
    selectedNavIdBySession: {},
    navAnchorBySession: {},
  });
});

describe("MessageCard — pi-goal-complete rendering", () => {
  it("renders GoalCompleteCard when fork emits customType 'pi-goal-complete'", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const message: ChatMessage = {
      id: "msg-goal-complete",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Goal complete and independently verified.",
        },
      ],
      timestamp: Date.now(),
      customType: "pi-goal-complete",
      data: { summary: "All tests pass." },
    } as unknown as ChatMessage;

    const { container } = render(<MessageCard message={message} />);
    // GoalCompleteCard should render — looking for the data attribute it sets
    // or any text inside the card.
    expect(container.innerHTML).toContain("msg-goal-complete");
    // If app missed the rename, the GoalCompleteCard would not render and
    // the message would fall through to default text rendering only.
    // We assert that the card shell div is present.
    expect(container.querySelector('[data-msg-card-id="msg-goal-complete"]')).not.toBeNull();
  });
});

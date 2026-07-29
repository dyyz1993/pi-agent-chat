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
      role: "custom",
      content: [
        {
          type: "custom",
          customType: "pi-goal-complete",
          data: { objective: "ship the feature", verdict: "all tests pass" },
        },
      ],
      timestamp: Date.now(),
    } as ChatMessage;

    const { container } = render(<MessageCard message={message} />);
    // GoalCompleteCard renders a button with aria-label "goal.completeCardLabel".
    // If app missed the rename (still looking for "supervisor_goal_complete"),
    // this button would not exist — the message would fall through to the
    // default text rendering instead.
    expect(container.querySelector('button[aria-label="goal.completeCardLabel"]')).not.toBeNull();
  });
});


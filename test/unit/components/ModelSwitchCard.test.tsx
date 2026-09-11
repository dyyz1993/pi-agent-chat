/**
 * @vitest-environment happy-dom
 *
 * Model switch notices: MessageCard renders `model_changed` custom entries
 * as a compact centered pill (docs/mockups/model-switch-entry.html plan A)
 * showing "previous → new (tier)".
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageCard } from "../../../src/mainview/components/chat/MessageCard";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useTierStore } from "../../../src/mainview/stores/use-tier-store";
import { useTurnStore } from "../../../src/mainview/stores/use-turn-store";
import type { ChatMessage } from "../../../src/mainview/types";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

function buildMessage(data: Record<string, unknown>): ChatMessage {
  return {
    id: "msg-mc-1",
    role: "custom",
    content: [{ type: "custom", customType: "model_changed", data }],
    timestamp: new Date("2026-09-11T06:00:00.000Z").getTime(),
  } as ChatMessage;
}

afterEach(() => {
  cleanup();
  useSessionStore.setState({ activeSessionId: null });
  useTierStore.setState({ globalDefaults: {}, dataBySession: {} });
  useTurnStore.setState({
    selectedMessageIdsBySession: {},
    collapsedMessageIdsBySession: {},
    isMultiSelectModeBySession: {},
    selectedNavIdBySession: {},
    navAnchorBySession: {},
  });
});

describe("MessageCard — model_changed rendering", () => {
  it("renders previous → new model pill", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const { container } = render(
      <MessageCard
        message={buildMessage({
          provider: "opencode-go",
          modelId: "deepseek-v4-flash",
          previousProvider: "google",
          previousModelId: "gemini-2.5-pro",
          source: "set",
        })}
      />,
    );
    expect(container.textContent).toContain("modelSwitch.label");
    expect(container.textContent).toContain("google/gemini-2.5-pro");
    expect(container.textContent).toContain("opencode-go/deepseek-v4-flash");
  });

  it("shows matched tier in parentheses", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    useTierStore.setState({
      globalDefaults: { pro: "opencode-go/deepseek-v4-flash" },
    });
    const { container } = render(
      <MessageCard
        message={buildMessage({
          provider: "opencode-go",
          modelId: "deepseek-v4-flash",
          previousProvider: "google",
          previousModelId: "gemini-2.5-pro",
        })}
      />,
    );
    expect(container.textContent).toContain("(Pro)");
  });

  it("falls back to custom-tier label when no tier matches", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const { container } = render(
      <MessageCard
        message={buildMessage({
          provider: "opencode-go",
          modelId: "deepseek-v4-flash",
          previousProvider: "google",
          previousModelId: "gemini-2.5-pro",
        })}
      />,
    );
    expect(container.textContent).toContain("(modelSwitch.customTier)");
  });

  it("renders one-way notice when previous model is absent", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const { container } = render(
      <MessageCard
        message={buildMessage({ provider: "opencode-go", modelId: "deepseek-v4-flash" })}
      />,
    );
    expect(container.textContent).toContain("opencode-go/deepseek-v4-flash");
    expect(container.textContent).not.toContain("→");
  });
});

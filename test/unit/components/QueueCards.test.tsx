import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueueCards } from "../../../src/mainview/components/chat/QueueCards";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { useSessionQueueStore } from "../../../src/mainview/stores/use-session-queue-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({ steering: [], followUp: [] }),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      ({
        revokeQueuedMessages: `Dismiss ${String(params?.count ?? "")} queued messages`,
        revokeQueuedMessage: `Dismiss queued message: ${String(params?.text ?? "")}`,
        expandQueuedMessage: `Expand queued message: ${String(params?.text ?? "")}`,
        collapseQueuedMessage: `Collapse queued message: ${String(params?.text ?? "")}`,
        queuedSteeringLabel: "Steering",
        queuedFollowUpLabel: "Follow-up",
      })[key] ?? key,
  }),
}));

describe("QueueCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ activeSessionId: "sess-1" });
    useSessionQueueStore.setState({
      queueBySession: {
        "sess-1": {
          steering: ["steer now"],
          followUp: ["first follow-up", "second follow-up with\nmore detail"],
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    useSessionQueueStore.setState({ queueBySession: {} });
  });

  it("expands a queued message to show full multiline content", () => {
    render(<QueueCards sessionId="sess-1" />);

    fireEvent.click(
      screen.getByRole("button", { name: /Expand queued message: second follow-up/ }),
    );

    expect(
      screen.getByText(
        (_, el) => el?.tagName === "PRE" && el.textContent === "second follow-up with\nmore detail",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Collapse queued message: second follow-up/ }),
    ).toBeTruthy();
  });

  it("dismisses only the selected queued message", async () => {
    render(<QueueCards sessionId="sess-1" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss queued message: first follow-up" }),
    );

    await waitFor(() => {
      expect(apiClient.call).toHaveBeenCalledWith("agent.clearQueue", {
        sessionId: "sess-1",
        item: { type: "followUp", index: 0, text: "first follow-up" },
      });
    });

    expect(useSessionQueueStore.getState().queueBySession["sess-1"]).toEqual({
      steering: ["steer now"],
      followUp: ["second follow-up with\nmore detail"],
    });
  });
});

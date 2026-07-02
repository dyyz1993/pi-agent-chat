import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiCallMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: apiCallMock,
    onConnectionChange: vi.fn(() => () => {}),
    onReconnect: vi.fn(),
    subscribe: vi.fn(() => "sub-id"),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) =>
      (
        {
          reloadTitle: "Reload",
          reloadSuccess: "Reloaded",
          reloadFailed: "Reload failed",
        } as Record<string, string>
      )[key] ?? key,
  }),
}));

import {
  ChatReloadButton,
  shouldShowChatReloadButton,
} from "../../../src/mainview/components/chat/ChatPanel";
import { useNotificationStore } from "../../../src/mainview/stores/use-notification-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";

describe("ChatReloadButton", () => {
  const originalFetchInitialState = useSessionStore.getState().fetchInitialState;
  const originalPush = useNotificationStore.getState().push;

  beforeEach(() => {
    apiCallMock.mockReset();
    apiCallMock.mockResolvedValue({});
    useSessionStore.setState({
      fetchInitialState: originalFetchInitialState,
    });
    useNotificationStore.setState({
      push: originalPush,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("only shows the reload button for an idle session", () => {
    expect(shouldShowChatReloadButton({ sessionId: "sess-1", status: "idle" })).toBe(true);
    expect(shouldShowChatReloadButton({ sessionId: "sess-1", status: "streaming" })).toBe(false);
    expect(shouldShowChatReloadButton({ sessionId: "sess-1", status: "compacting" })).toBe(false);
    expect(shouldShowChatReloadButton({ sessionId: "sess-1", status: "retrying" })).toBe(false);
    expect(shouldShowChatReloadButton({ sessionId: "sess-1", status: "permission" })).toBe(false);
    expect(shouldShowChatReloadButton({ sessionId: null, status: "idle" })).toBe(false);
  });

  it("renders in idle state and hides while the session is running", () => {
    const { rerender } = render(<ChatReloadButton sessionId="sess-1" status="idle" />);
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();

    rerender(<ChatReloadButton sessionId="sess-1" status="streaming" />);
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("calls agent.reload for the current chat session", async () => {
    const fetchInitialState = vi.fn();
    const push = vi.fn();
    useSessionStore.setState({ fetchInitialState });
    useNotificationStore.setState({ push });

    render(<ChatReloadButton sessionId="sess-1" status="idle" />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith("agent.reload", { sessionId: "sess-1" });
    });
    expect(fetchInitialState).toHaveBeenCalledWith("sess-1");
    expect(push).toHaveBeenCalledWith({ message: "Reloaded", level: "info" });
  });
});

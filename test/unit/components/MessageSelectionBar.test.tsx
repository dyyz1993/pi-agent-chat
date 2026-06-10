import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MessageSelectionBar } from "../../../src/mainview/components/chat/MessageSelectionBar";
import type { ChatMessage, TokenUsage } from "../../../src/mainview/types";

const mockClearSelection = vi.fn();
const mockApiCall = vi.fn(() => Promise.resolve());

let selectedIds: Set<string> = new Set(["msg-1", "msg-2"]);

vi.mock("../../../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        selectedMessageIdsBySession: { "test-session": selectedIds },
        clearSelection: mockClearSelection,
      }),
    {
      getState: () => ({
        selectedMessageIdsBySession: { "test-session": selectedIds },
        clearSelection: mockClearSelection,
      }),
    },
  ),
  EMPTY_SET: new Set(),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        activeSessionId: "test-session",
        projectTabs: [{ id: "proj-1", path: "/test" }],
        activeProjectId: "proj-1",
      }),
    {
      getState: () => ({
        activeSessionId: "test-session",
        projectTabs: [{ id: "proj-1", path: "/test" }],
        activeProjectId: "proj-1",
      }),
    },
  ),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: mockApiCall, onReconnect: () => {} },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../src/mainview/utils/turn-utils", () => ({
  formatTokenCount: (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  },
}));

function makeMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
  tokenUsage?: TokenUsage,
): ChatMessage & { tokenUsage?: TokenUsage } {
  return {
    id,
    role,
    content: [{ type: "text" as const, text }],
    timestamp: Date.now(),
    tokenUsage,
  };
}

describe("MessageSelectionBar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    selectedIds = new Set(["msg-1", "msg-2"]);
  });

  it("renders nothing when no messages are selected", () => {
    selectedIds = new Set();
    const { container } = render(<MessageSelectionBar messageIds={[]} messages={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows count 2 when 2 messages selected", () => {
    render(
      <MessageSelectionBar
        messageIds={["msg-1", "msg-2"]}
        messages={[makeMessage("msg-1", "user", "hello"), makeMessage("msg-2", "assistant", "hi")]}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows token stats when messages have tokenUsage", () => {
    render(
      <MessageSelectionBar
        messageIds={["msg-1", "msg-2"]}
        messages={[
          makeMessage("msg-1", "user", "hello", { input: 500, output: 100 }),
          makeMessage("msg-2", "assistant", "hi", { input: 200, output: 300 }),
        ]}
      />,
    );
    expect(screen.getByText("700")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
  });

  it("does NOT show token stats when no tokenUsage", () => {
    const { container } = render(
      <MessageSelectionBar
        messageIds={["msg-1"]}
        messages={[makeMessage("msg-1", "user", "hello")]}
      />,
    );
    const fontMonoElements = container.querySelectorAll(".font-mono");
    expect(fontMonoElements.length).toBe(0);
  });

  it("click Delete calls onDeleteSelected with selected IDs", () => {
    const onDeleteSelected = vi.fn();
    render(
      <MessageSelectionBar
        messageIds={["msg-1", "msg-2"]}
        messages={[makeMessage("msg-1", "user", "hello"), makeMessage("msg-2", "assistant", "hi")]}
        onDeleteSelected={onDeleteSelected}
      />,
    );
    fireEvent.click(screen.getByTitle("deleteSelected"));
    expect(onDeleteSelected).toHaveBeenCalledWith(["msg-1", "msg-2"]);
  });

  it("click X (cancel) calls clear()", () => {
    render(
      <MessageSelectionBar
        messageIds={["msg-1"]}
        messages={[makeMessage("msg-1", "user", "hello")]}
      />,
    );
    fireEvent.click(screen.getByTitle("cancelSelection"));
    expect(mockClearSelection).toHaveBeenCalled();
  });
});

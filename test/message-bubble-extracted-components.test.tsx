/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryCard } from "../src/mainview/components/chat/MemoryCard";
import { TextContentCard } from "../src/mainview/components/chat/TextContentCard";
import { useChatOverlayStore } from "../src/mainview/stores/use-chat-overlay-store";
import { useMemoryStore } from "../src/mainview/stores/use-memory-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) return key;
      return `${key}:${JSON.stringify(opts)}`;
    },
  }),
}));

vi.mock("../src/mainview/utils/clipboard", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
}));

afterEach(() => {
  cleanup();
  useChatOverlayStore.getState().close();
  useSessionStore.setState({ activeSessionId: null });
  useMemoryStore.setState({ irrelevantMarkedBySession: {} });
});

describe("extracted message bubble components", () => {
  it("opens the markdown overlay for long text content", () => {
    const text = Array.from({ length: 22 }, (_, index) => `line ${index + 1}`).join("\n");

    render(<TextContentCard text={text} blockId="msg-1-0" />);

    fireEvent.click(screen.getByTitle("expandFullText"));

    const overlay = useChatOverlayStore.getState();
    expect(overlay.overlay).toBe("markdown");
    expect(overlay.markdownContent).toBe(text);
    expect(overlay.markdownTitle).toContain("messageContentLineCount");
  });

  it("renders memory prefetch searching details after expansion", () => {
    render(
      <MemoryCard
        customType="memory_prefetch"
        data={{ query: "hooks permission", availableFiles: 3 }}
        blockId="memory-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /搜索记忆/ }));

    expect(screen.getByText("searchingMemory")).toBeInTheDocument();
    expect(screen.getByText("「hooks permission」")).toBeInTheDocument();
    expect(screen.getByText(/filesCount/)).toBeInTheDocument();
  });

  it("renders memory prefetch result details after expansion", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });

    render(
      <MemoryCard
        customType="memory_prefetch"
        data={{ query: "hooks permission" }}
        mergedResultData={{
          _prefetchQuery: "hooks permission",
          snippet: "### Hook UI\nPlace approval near the input.",
          selectedFiles: ["docs/hooks.md"],
          injectedBytes: 128,
          layer: "llm",
          availableFiles: 1,
        }}
        blockId="memory-2"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /记忆搜索/ }));

    expect(screen.getByText("relatedMemory")).toBeInTheDocument();
    expect(screen.getByText(/Hook UI/)).toBeInTheDocument();
    expect(screen.getByTitle("markIrrelevant")).toBeInTheDocument();
  });
});

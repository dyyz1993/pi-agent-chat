/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryCard } from "../../../src/mainview/components/chat/MemoryCard";
import { TextContentCard } from "../../../src/mainview/components/chat/TextContentCard";
import { ToolExecutionCard } from "../../../src/mainview/components/chat/ToolExecutionCard";
import { ReadFileCard } from "../../../src/mainview/components/chat/tool-renderers/ReadFileCard";
import { useChatOverlayStore } from "../../../src/mainview/stores/use-chat-overlay-store";
import { useExplorerStore } from "../../../src/mainview/stores/use-explorer-store";
import { useMemoryStore } from "../../../src/mainview/stores/use-memory-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) return key;
      return `${key}:${JSON.stringify(opts)}`;
    },
  }),
}));

vi.mock("../../../src/mainview/utils/clipboard", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
}));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  useChatOverlayStore.getState().close();
  useExplorerStore.setState({ selectedPath: null, filePreview: null, loadingFile: false });
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

  it("renders markdown while text content is streaming", async () => {
    render(
      <TextContentCard text={"# Streaming title\n\n**bold** text"} isStreaming blockId="msg-1-1" />,
    );

    expect(await screen.findByRole("heading", { name: "Streaming title" })).toBeInTheDocument();
    expect(screen.getByText("bold")).toHaveAttribute("data-streamdown", "strong");
  });

  it("updates the streaming markdown snapshot even when text keeps changing", async () => {
    const { rerender } = render(
      <TextContentCard text={"# Streaming title\n\n**bo"} isStreaming blockId="msg-1-2" />,
    );

    expect(await screen.findByRole("heading", { name: "Streaming title" })).toBeInTheDocument();

    rerender(
      <TextContentCard
        text={"# Streaming title\n\n**bold** text\n\n- item one"}
        isStreaming
        blockId="msg-1-2"
      />,
    );

    expect(screen.getByText("bold")).toHaveAttribute("data-streamdown", "strong");
    expect(screen.getByText("item one").closest("li")).not.toBeNull();
  });

  it("uses the shared code block renderer while text content is streaming", async () => {
    render(
      <TextContentCard
        text={"```ts\nconst ok = true;\n```"}
        isStreaming
        blockId="msg-1-code"
      />,
    );

    await waitFor(() => {
      const root = document.querySelector('[data-block-id="msg-1-code"]');
      expect(root?.querySelector("pre")).not.toBeNull();
      expect(root?.querySelector('[data-streamdown="code-block"]')).toBeNull();
      expect(root?.querySelector(".table-row")).not.toBeNull();
      expect(root?.textContent).toContain("const");
      expect(root?.textContent).toContain("ok");
    });
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

  it("moves system-reminder memory references out of visible response text", () => {
    const memoryPath = "/Users/xyz/.pi/agent/memory/--project--/remote-preference.md";
    render(
      <TextContentCard
        blockId="msg-context-1"
        text={`可以继续。\n<system-reminder>\n${memoryPath}\nsecret memory body\n</system-reminder>\n已完成。`}
      />,
    );

    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("Memory 1")).toBeInTheDocument();
    expect(screen.getByText("remote-preference.md")).toBeInTheDocument();
    expect(screen.queryByText(/secret memory body/)).not.toBeInTheDocument();
  });

  it("opens context reference files through the shared file overlay", () => {
    const skillPath = "/tmp/pi-test/SKILL.md";
    render(
      <TextContentCard
        blockId="msg-context-2"
        text={`<skill name="pi-test" location="${skillPath}">\n# Pi Test\nUse harness first.\n</skill>`}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /pi-test/ }));

    expect(useExplorerStore.getState().selectedPath).toBe(skillPath);
    expect(useChatOverlayStore.getState().overlay).toBe("file");
  });

  it("extracts memory success and failure tags into context references", () => {
    render(
      <TextContentCard
        blockId="msg-context-3"
        text={`完成。\n<memory-created>\n/Users/xyz/.pi/agent/memory/project/ok.md\ncreated body\n</memory-created>\n<memory-failed>\nwrite failed loudly\n</memory-failed>`}
      />,
    );

    expect(screen.getAllByText("Context")).toHaveLength(2);
    expect(screen.getByText("ok.md")).toBeInTheDocument();
    expect(screen.getByText("Memory failed")).toBeInTheDocument();
    expect(screen.queryByText(/created body/)).not.toBeInTheDocument();
    expect(screen.queryByText(/write failed loudly/)).not.toBeInTheDocument();
  });

  it("does not open the matched target file when a rule has no source path", () => {
    const matchedFilePath = "/tmp/pi-test/SKILL.md";
    render(
      <ReadFileCard
        block={{
          type: "toolExecution",
          toolCallId: "read-1",
          toolName: "read",
          args: JSON.stringify({ path: matchedFilePath }),
          status: "done",
          output: "skill contents",
          details: {
            matchedFilePath,
            rulesMatched: [
              {
                name: "skill-rule",
                title: "Skill Rule",
                severity: "medium",
                matchedGlob: "**/SKILL.md",
                status: "loaded",
              },
            ],
          },
        }}
        blockId="read-rule-1"
      />,
    );

    fireEvent.click(screen.getByText("Context"));
    fireEvent.click(screen.getByRole("button", { name: /Skill Rule/ }));

    expect(useExplorerStore.getState().selectedPath).toBeNull();
    expect(useChatOverlayStore.getState().overlay).toBeNull();
  });

  it("renders hook tags as guard intervention UI instead of response text", () => {
    render(
      <TextContentCard
        blockId="msg-hook-1"
        text={`准备执行。\n<hook status="blocked" eventName="preToolUse" toolName="bash" matcher="rm *" source="hooks-focus">\nBlocked by hooks-focus\nraw hook payload\n</hook>\n已停止。`}
      />,
    );

    expect(screen.getByText("Hook blocked")).toBeInTheDocument();
    expect(screen.getByText("preToolUse · bash")).toBeInTheDocument();
    expect(screen.getAllByText("Blocked by hooks-focus").length).toBeGreaterThan(0);
    expect(screen.queryByText(/raw hook payload/)).not.toBeInTheDocument();
  });

  it("renders hook denial tool errors as guard intervention UI", () => {
    render(
      <ToolExecutionCard
        block={{
          type: "toolExecution",
          toolCallId: "bash-1",
          toolName: "bash",
          args: JSON.stringify({ command: "rm -rf /tmp/demo" }),
          status: "error",
          output: "blocked",
          details: {
            hookDenial: {
              reason: "Blocked by hooks-focus",
              toolName: "bash",
              timestamp: Date.now(),
            },
          },
        }}
        blockId="hook-denial-1"
      />,
    );

    expect(screen.getByText("Hook blocked")).toBeInTheDocument();
    expect(screen.getByText("hookDenied")).toBeInTheDocument();
    expect(screen.getAllByText("Blocked by hooks-focus").length).toBeGreaterThan(0);
  });
});

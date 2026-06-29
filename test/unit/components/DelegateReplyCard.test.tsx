import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DelegateReplyCard } from "../../../src/mainview/components/chat/special-block-renderers/DelegateReplyCard";
import type { SpecialBlock } from "../../../src/mainview/components/chat/special-block-registry";

function makeBlock(body: string, attrs: Record<string, string> = {}): SpecialBlock {
  return {
    type: "special-block",
    tag: "delegate-reply",
    attrs: {
      from: "child-session",
      sessionId: "child-session",
      title: "Long delegate reply",
      elapsed: "12s",
      historyCount: "3",
      task: "Review the pending implementation",
      agent: "pi-worktree-dev",
      projectPath: "/tmp/project",
      params: '{"title":"Long delegate reply","agent":"pi-worktree-dev","projectPath":"/tmp/project","replyMode":"interrupt"}',
      ...attrs,
    },
    body,
    raw: "",
  };
}

describe("DelegateReplyCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows delegate task context when expanded", () => {
    render(<DelegateReplyCard block={makeBlock("Result body")} />);

    fireEvent.click(screen.getByText("Long delegate reply"));

    expect(screen.getByText("Review the pending implementation")).toBeInTheDocument();
    expect(screen.getByText("pi-worktree-dev")).toBeInTheDocument();
    expect(screen.getByText("/tmp/project")).toBeInTheDocument();
    expect(
      screen.getByText(
        '{"title":"Long delegate reply","agent":"pi-worktree-dev","projectPath":"/tmp/project","replyMode":"interrupt"}',
      ),
    ).toBeInTheDocument();
  });

  it("keeps long delegate replies scrollable and can expand to full height", () => {
    const longBody = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n\n");
    const { container } = render(<DelegateReplyCard block={makeBlock(longBody)} />);

    fireEvent.click(screen.getByText("Long delegate reply"));

    const body = container.querySelector("[data-testid='delegate-reply-body']");
    expect(body?.className).toContain("max-h-72");
    expect(body?.className).toContain("overflow-y-auto");

    fireEvent.click(screen.getByRole("button", { name: "View full reply" }));
    expect(body?.className).not.toContain("max-h-72");
  });

  it("scrolls expanded delegate replies to the bottom by default", () => {
    const longBody = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n\n");
    const { container, rerender } = render(<DelegateReplyCard block={makeBlock(longBody)} />);

    fireEvent.click(screen.getByText("Long delegate reply"));

    const body = container.querySelector("[data-testid='delegate-reply-body']") as HTMLDivElement;
    Object.defineProperty(body, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(body, "clientHeight", { configurable: true, value: 200 });

    rerender(<DelegateReplyCard block={makeBlock(`${longBody}\n\nnew line`)} />);

    expect(body.scrollTop).toBe(1000);
  });
});

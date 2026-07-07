import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileOverlay } from "../../../src/mainview/components/file-preview/FileOverlay";
import type { FilePreview } from "../../../src/mainview/types";

vi.mock("virtua", async () => {
  const { forwardRef } = await import("react");
  return {
    Virtualizer: forwardRef<HTMLDivElement, { children: ReactNode }>(({ children }, ref) => (
      <div ref={ref} data-testid="mock-virtualizer">
        {children}
      </div>
    )),
  };
});

const textPreview: FilePreview = {
  path: "/tmp/AGENTS.md",
  name: "AGENTS.md",
  content: "hello\nworld",
  imageUrl: null,
  mimeType: "text/markdown",
  size: 11,
  isText: true,
  isImage: false,
  totalLines: 2,
  editable: true,
};

afterEach(() => {
  cleanup();
});

describe("FileOverlay embedded mode", () => {
  it("renders as an in-panel editor surface instead of a dialog overlay", () => {
    render(<FileOverlay preview={textPreview} loading={false} onClose={vi.fn()} embedded />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: /AGENTS\.md/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("hello\nworld");
  });

  it("keeps the close action in the embedded header", () => {
    const onClose = vi.fn();
    render(<FileOverlay preview={textPreview} loading={false} onClose={onClose} embedded />);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps editable raw text in no-wrap mode so ASCII diagrams preserve structure", () => {
    const asciiPreview: FilePreview = {
      ...textPreview,
      path: "/tmp/tree.txt",
      name: "tree.txt",
      mimeType: "text/plain",
      content: "project/\n├── src/\n│   └── main.ts\n└── README.md",
      size: 48,
      totalLines: 4,
      editable: true,
    };

    render(<FileOverlay preview={asciiPreview} loading={false} onClose={vi.fn()} embedded />);

    const editor = screen.getByRole("textbox");
    expect(editor).toHaveAttribute("wrap", "off");
    expect(editor).toHaveClass("whitespace-pre");
    expect(editor).toHaveValue("project/\n├── src/\n│   └── main.ts\n└── README.md");
  });

  it("keeps read-only text preview lines as intrinsic-width rows for horizontal scrolling", async () => {
    const asciiPreview: FilePreview = {
      ...textPreview,
      path: "/tmp/tree.txt",
      name: "tree.txt",
      mimeType: "text/plain",
      content: "project/\n├── src/\n│   └── main.ts\n└── README.md",
      size: 48,
      totalLines: 4,
      editable: false,
    };

    render(<FileOverlay preview={asciiPreview} loading={false} onClose={vi.fn()} embedded />);

    const treeLine = await screen.findByText((_, element) => {
      return element?.textContent === "│   └── main.ts";
    });
    expect(treeLine).toHaveClass("whitespace-pre");
    expect(treeLine.parentElement).toHaveClass("min-w-max");
    expect(screen.getByTestId("mock-virtualizer").parentElement).toHaveStyle({
      width: "max(100%, calc(16ch + 3.5rem))",
    });
  });

  it("does not leak Prism markdown table token classes into layout", async () => {
    const markdownPreview: FilePreview = {
      ...textPreview,
      path: "/tmp/CLI_ROADMAP.md",
      name: "CLI_ROADMAP.md",
      mimeType: "text/markdown",
      content: "| # | 任务 | 文件 | 工作量 |\n|---|---|---|---|",
      size: 46,
      totalLines: 2,
      editable: false,
    };

    const { container } = render(
      <FileOverlay preview={markdownPreview} loading={false} onClose={vi.fn()} embedded />,
    );

    const tableLines = await screen.findAllByText((_, element) => {
      return element?.textContent === "| # | 任务 | 文件 | 工作量 |";
    });
    const tableLine = tableLines.find((element) => element.classList.contains("whitespace-pre"));

    expect(tableLine).toBeDefined();
    expect(tableLine).toHaveClass("whitespace-pre");
    expect(tableLine?.parentElement).toHaveClass("min-w-max");
    expect(screen.getByTestId("mock-virtualizer").parentElement).toHaveStyle({
      width: "max(100%, calc(27ch + 3.5rem))",
    });
    expect(container.querySelector(".table")).toBeNull();
  });
});

/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CachedReactMarkdown } from "../../../src/mainview/components/chat/CachedReactMarkdown";
import { useExplorerStore } from "../../../src/mainview/stores/use-explorer-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";

const originalOpenFile = useExplorerStore.getState().openFile;

describe("CachedReactMarkdown clickable file paths", () => {
  beforeEach(() => {
    useSessionStore.setState({
      activeProjectId: "project-1",
      activeSessionId: "session-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/project" }],
      sessionsByProject: {
        "/project": [
          {
            sessionId: "session-1",
            projectPath: "/project",
            title: "Session",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      },
    });
  });

  afterEach(() => {
    cleanup();
    useExplorerStore.setState({ openFile: originalOpenFile });
    useSessionStore.setState({
      activeProjectId: null,
      activeSessionId: null,
      projectTabs: [],
      sessionsByProject: {},
    });
  });

  it("turns relative file paths into clickable file preview entries", () => {
    const openFile = vi.fn();
    useExplorerStore.setState({ openFile });

    render(<CachedReactMarkdown>{"Open src/mainview/Xxx.tsx please"}</CachedReactMarkdown>);

    const link = screen.getByRole("button", { name: "src/mainview/Xxx.tsx" });
    expect(link).toHaveClass("underline");
    fireEvent.click(link);

    expect(openFile).toHaveBeenCalledWith(
      {
        name: "Xxx.tsx",
        path: "/project/src/mainview/Xxx.tsx",
        type: "file",
      },
      false,
    );
  });

  it("does not replace normal markdown links or urls", () => {
    render(
      <CachedReactMarkdown>
        {"Read [docs](docs/readme.md) and https://example.com/src/mainview/Xxx.tsx"}
      </CachedReactMarkdown>,
    );

    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute("href", "docs/readme.md");
    expect(screen.queryByRole("button", { name: "docs/readme.md" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "https://example.com/src/mainview/Xxx.tsx" }),
    ).not.toBeInTheDocument();
  });

  it("turns inline code paths into clickable file preview entries", () => {
    const openFile = vi.fn();
    useExplorerStore.setState({ openFile });

    render(<CachedReactMarkdown>{"Check `src/mainview/Xxx.tsx`"}</CachedReactMarkdown>);

    fireEvent.click(screen.getByRole("button", { name: "src/mainview/Xxx.tsx" }));
    expect(openFile).toHaveBeenCalledWith(
      {
        name: "Xxx.tsx",
        path: "/project/src/mainview/Xxx.tsx",
        type: "file",
      },
      false,
    );
  });

  it("turns absolute file paths into clickable file preview entries", () => {
    const openFile = vi.fn();
    useExplorerStore.setState({ openFile });

    render(<CachedReactMarkdown>{"Open /tmp/pi-e2e-click-path.md please"}</CachedReactMarkdown>);

    fireEvent.click(screen.getByRole("button", { name: "/tmp/pi-e2e-click-path.md" }));
    expect(openFile).toHaveBeenCalledWith(
      {
        name: "pi-e2e-click-path.md",
        path: "/tmp/pi-e2e-click-path.md",
        type: "file",
      },
      false,
    );
  });
});

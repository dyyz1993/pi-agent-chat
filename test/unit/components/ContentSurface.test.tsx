/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Image } from "lucide-react";
import { ContentSurface } from "../../../src/mainview/components/primitives/ContentSurface";

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("ContentSurface", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a shared surface header, body, icon, and close action", () => {
    const onClose = vi.fn();

    render(
      <ContentSurface
        title="Image preview"
        closeLabel="Close preview"
        icon={<Image data-testid="surface-icon" />}
        onClose={onClose}
      >
        <div data-testid="surface-body">Preview body</div>
      </ContentSurface>,
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Image preview")).toBeInTheDocument();
    expect(screen.getByTestId("surface-icon")).toBeInTheDocument();
    expect(screen.getByTestId("surface-body")).toHaveTextContent("Preview body");

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("defaults to a chat-scoped absolute fullscreen surface", () => {
    const { container } = render(
      <ContentSurface title="Preview" closeLabel="Close" onClose={vi.fn()}>
        Body
      </ContentSurface>,
    );

    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("absolute");
    expect(root.className).toContain("z-fullscreen");
  });
});

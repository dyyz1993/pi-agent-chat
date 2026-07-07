import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentSurface } from "../../../src/mainview/components/primitives/ContentSurface";

afterEach(() => {
  cleanup();
});

describe("ContentSurface safe-area header behavior", () => {
  it("does not add top safe-area padding for chat-scoped absolute surfaces", () => {
    render(
      <ContentSurface title="File preview" onClose={vi.fn()} position="absolute">
        <div>Preview body</div>
      </ContentSurface>,
    );

    const header = screen.getByRole("heading", { name: "File preview" }).parentElement;

    expect(header).toBeTruthy();
    expect(header).not.toHaveClass("surface-header-safe-top");
  });

  it("keeps top safe-area padding for fixed fullscreen surfaces", () => {
    render(
      <ContentSurface title="Image preview" onClose={vi.fn()} position="fixed">
        <div>Preview body</div>
      </ContentSurface>,
    );

    const header = screen.getByRole("heading", { name: "Image preview" }).parentElement;

    expect(header).toBeTruthy();
    expect(header).toHaveClass("surface-header-safe-top");
  });
});

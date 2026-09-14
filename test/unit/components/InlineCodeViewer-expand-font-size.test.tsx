import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InlineCodeViewer } from "../../../src/mainview/components/chat/tool-renderers/InlineCodeViewer";
import { useChatOverlayStore } from "../../../src/mainview/stores/use-chat-overlay-store";

function ExpandedContent() {
  const content = useChatOverlayStore((s) => s.expandContent);
  return <>{content}</>;
}

describe("InlineCodeViewer expand font size", () => {
  afterEach(() => {
    cleanup();
    useChatOverlayStore.getState().close();
  });

  it("inline preview keeps the fixed 11px code font", () => {
    const { container } = render(
      <InlineCodeViewer code={"const a = 1;\n".repeat(3)} filename="a.ts" />,
    );
    const inlinePre = container.querySelector("pre");
    expect(inlinePre).not.toBeNull();
    expect(inlinePre?.className).toContain("text-[11px]");
  });

  it("expanded code inherits the overlay font size instead of a fixed class", () => {
    const { container } = render(
      <InlineCodeViewer code={"const a = 1;\n".repeat(3)} filename="a.ts" />,
    );
    const expandButton = container.querySelector("button");
    expect(expandButton).not.toBeNull();
    fireEvent.click(expandButton!);

    const expanded = render(<ExpandedContent />);
    const pre = expanded.container.querySelector("pre");
    expect(pre).not.toBeNull();
    // CodeExpandOverlay sets font size via inline style on a wrapper div; a
    // fixed text-[11px] on the <pre> would override it and break zoom controls.
    expect(pre?.className).not.toContain("text-[11px]");
    const lineNumber = expanded.container.querySelector("span.table-cell");
    expect(lineNumber?.className).toContain("text-[0.91em]");
  });
});

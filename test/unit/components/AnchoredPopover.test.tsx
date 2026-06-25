import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { AnchoredPopover } from "../../../src/mainview/components/primitives";

function TestPopover({ onClose = vi.fn() }: { onClose?: () => void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        ref={(node) => {
          anchorRef.current = node;
          if (!node) return;
          node.getBoundingClientRect = () =>
            ({
              x: 100,
              y: 40,
              top: 40,
              left: 100,
              right: 180,
              bottom: 70,
              width: 80,
              height: 30,
              toJSON: () => ({}),
            }) as DOMRect;
        }}
      >
        Trigger
      </button>
      <AnchoredPopover
        anchorRef={anchorRef}
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        placement="bottom"
        minWidth={224}
        maxHeight={256}
      >
        <div>Menu content</div>
      </AnchoredPopover>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("AnchoredPopover", () => {
  it("positions the portal content from the anchor rect", () => {
    render(<TestPopover />);

    const popover = screen.getByText("Menu content").parentElement;
    expect(popover).toHaveStyle({
      position: "fixed",
      left: "100px",
      top: "74px",
      width: "224px",
    });
  });

  it("keeps trigger clicks inside the interaction group and closes on outside click", () => {
    const onClose = vi.fn();
    render(<TestPopover onClose={onClose} />);

    fireEvent.mouseDown(screen.getByText("Trigger"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Menu content")).not.toBeInTheDocument();
  });
});

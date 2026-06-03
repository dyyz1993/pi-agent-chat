import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useRef } from "react";
import { ContextMenu, type MenuItem } from "../src/mainview/components/explorer/ContextMenu";
import { useFocusTrap } from "../src/mainview/hooks/use-focus-trap";

const defaultItems: MenuItem[] = [
  { label: "复制", onClick: vi.fn() },
  { label: "删除", onClick: vi.fn(), danger: true },
  { label: "重命名", onClick: vi.fn() },
];

describe("ContextMenu keyboard navigation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should respond to Escape key to close", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={100} y={100} items={defaultItems} onClose={onClose} />);

    const menuItems = screen.getAllByRole("menuitem");
    fireEvent.keyDown(menuItems[0], { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should navigate items with ArrowDown and activate with Enter", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const items: MenuItem[] = [
      { label: "Item A", onClick: vi.fn() },
      { label: "Item B", onClick },
      { label: "Item C", onClick: vi.fn() },
    ];

    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    const menuItems = screen.getAllByRole("menuitem");

    fireEvent.keyDown(menuItems[0], { key: "ArrowDown" });
    expect(menuItems[1]).toHaveFocus();

    fireEvent.keyDown(menuItems[1], { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should wrap around with ArrowUp from first item", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={100} y={100} items={defaultItems} onClose={onClose} />);

    const menuItems = screen.getAllByRole("menuitem");

    fireEvent.keyDown(menuItems[0], { key: "ArrowUp" });
    expect(menuItems[2]).toHaveFocus();
  });

  it("should activate item with Space key", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const items: MenuItem[] = [{ label: "Action", onClick }];

    render(<ContextMenu x={100} y={100} items={items} onClose={onClose} />);

    const menuItems = screen.getAllByRole("menuitem");
    fireEvent.keyDown(menuItems[0], { key: " " });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should have role=menu and role=menuitem", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={100} y={100} items={defaultItems} onClose={onClose} />);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });
});

function FocusTrapTestDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { onEscape: onClose });
  return (
    <div ref={ref}>
      <button>First</button>
      <button>Last</button>
    </div>
  );
}

function TwoFocusTrapTestDialogs({
  onOuterClose,
  onInnerClose,
}: {
  onOuterClose: () => void;
  onInnerClose: () => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(outerRef, { onEscape: onOuterClose });
  useFocusTrap(innerRef, { onEscape: onInnerClose });
  return (
    <div ref={outerRef}>
      <button>Outer</button>
      <div ref={innerRef}>
        <button>Inner</button>
      </div>
    </div>
  );
}

describe("FocusTrap", () => {
  afterEach(() => {
    cleanup();
  });

  it("should trap focus within modal container on Tab", () => {
    const onClose = vi.fn();
    render(<FocusTrapTestDialog onClose={onClose} />);

    const firstBtn = screen.getByText("First");
    const lastBtn = screen.getByText("Last");

    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(firstBtn);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastBtn);
  });

  it("should call onEscape when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<FocusTrapTestDialog onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should only close the topmost active trap on Escape", () => {
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    render(<TwoFocusTrapTestDialogs onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
  });
});

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "../../lib/classes";

type PopoverPlacement = "top" | "bottom";
type PopoverAlign = "start" | "end" | "stretch";

export interface AnchoredPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: PopoverPlacement;
  align?: PopoverAlign;
  offset?: number;
  viewportPadding?: number;
  minWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  className?: string;
  style?: CSSProperties;
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
  "data-model-picker-dropdown"?: boolean | string;
  "data-testid"?: string;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    ref.current = value;
  }
}

export const AnchoredPopover = forwardRef<HTMLDivElement, AnchoredPopoverProps>(
  function AnchoredPopover(
    {
      anchorRef,
      open,
      onClose,
      children,
      placement = "bottom",
      align = "start",
      offset = 4,
      viewportPadding = 8,
      minWidth,
      maxWidth,
      maxHeight = 320,
      className,
      style,
      closeOnOutsideClick = true,
      closeOnEscape = true,
      "data-model-picker-dropdown": dataModelPickerDropdown,
      "data-testid": dataTestId,
    },
    forwardedRef,
  ) {
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const [positionStyle, setPositionStyle] = useState<CSSProperties | null>(null);

    const setPopoverRef = useCallback(
      (node: HTMLDivElement | null) => {
        popoverRef.current = node;
        assignRef(forwardedRef, node);
      },
      [forwardedRef],
    );

    const updatePosition = useCallback(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const resolvedMinWidth = minWidth ?? 0;
      const resolvedWidth =
        align === "stretch" ? rect.width : Math.max(rect.width, resolvedMinWidth);
      const width = maxWidth ? Math.min(resolvedWidth, maxWidth) : resolvedWidth;
      const clampedWidth = Math.min(width, window.innerWidth - viewportPadding * 2);

      const next: CSSProperties = {
        position: "fixed",
        maxHeight: Math.max(80, maxHeight),
      };

      if (align === "end") {
        next.right = Math.max(viewportPadding, window.innerWidth - rect.right);
      } else {
        next.left = Math.max(
          viewportPadding,
          Math.min(rect.left, window.innerWidth - clampedWidth - viewportPadding),
        );
      }

      if (align === "stretch" || minWidth || maxWidth) {
        next.width = clampedWidth;
      }

      if (placement === "top") {
        const availableHeight = Math.max(80, rect.top - viewportPadding - offset);
        next.bottom = Math.max(viewportPadding, window.innerHeight - rect.top + offset);
        next.maxHeight = Math.min(maxHeight, availableHeight);
      } else {
        const availableHeight = Math.max(
          80,
          window.innerHeight - rect.bottom - viewportPadding - offset,
        );
        next.top = Math.min(rect.bottom + offset, window.innerHeight - viewportPadding);
        next.maxHeight = Math.min(maxHeight, availableHeight);
      }

      setPositionStyle(next);
    }, [align, anchorRef, maxHeight, maxWidth, minWidth, offset, placement, viewportPadding]);

    useLayoutEffect(() => {
      if (!open) return;
      updatePosition();
    }, [open, updatePosition]);

    useEffect(() => {
      if (!open) return;
      let rafId = 0;
      const scheduleUpdate = () => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updatePosition);
      };
      window.addEventListener("resize", scheduleUpdate);
      window.addEventListener("scroll", scheduleUpdate, true);
      return () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener("resize", scheduleUpdate);
        window.removeEventListener("scroll", scheduleUpdate, true);
      };
    }, [open, updatePosition]);

    useEffect(() => {
      if (!open || (!closeOnOutsideClick && !closeOnEscape)) return;
      const handlePointerDown = (event: MouseEvent) => {
        if (!closeOnOutsideClick) return;
        const target = event.target as Node;
        if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
        onClose();
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (closeOnEscape && event.key === "Escape") onClose();
      };
      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handlePointerDown);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [anchorRef, closeOnEscape, closeOnOutsideClick, onClose, open]);

    if (!open) return null;

    return createPortal(
      <div
        ref={setPopoverRef}
        data-model-picker-dropdown={dataModelPickerDropdown}
        data-testid={dataTestId}
        className={cx("fixed z-popover", className)}
        style={{ ...positionStyle, ...style }}
      >
        {children}
      </div>,
      document.body,
    );
  },
);

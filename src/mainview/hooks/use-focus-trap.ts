import { useEffect, useCallback, useRef, type RefObject } from "react";

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0,
  );
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options?: { onEscape?: () => void },
) {
  const initialFocusDoneRef = useRef(false);
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (e.key === "Escape") {
        options?.onEscape?.();
        return;
      }

      if (e.key !== "Tab") return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [containerRef, options],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    document.addEventListener("keydown", handleKeyDown);

    if (!initialFocusDoneRef.current) {
      initialFocusDoneRef.current = true;
      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        requestAnimationFrame(() => focusable[0].focus());
      }
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [containerRef, handleKeyDown]);
}

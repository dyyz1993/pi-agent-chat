import { useEffect, useCallback, useRef, type RefObject } from "react";

interface FocusTrapOptions {
  onEscape?: () => void;
  active?: boolean;
  initialFocus?: boolean;
  returnFocus?: boolean;
}

interface FocusTrapEntry {
  id: number;
  getContainer: () => HTMLElement | null;
}

let nextFocusTrapId = 0;
const focusTrapStack: FocusTrapEntry[] = [];

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

function isVisible(container: HTMLElement): boolean {
  const style = window.getComputedStyle(container);
  return style.display !== "none" && style.visibility !== "hidden";
}

function pruneFocusTrapStack() {
  for (let i = focusTrapStack.length - 1; i >= 0; i -= 1) {
    const container = focusTrapStack[i].getContainer();
    if (!container || !container.isConnected) {
      focusTrapStack.splice(i, 1);
    }
  }
}

function getTopVisibleTrapId(): number | null {
  pruneFocusTrapStack();
  for (let i = focusTrapStack.length - 1; i >= 0; i -= 1) {
    const entry = focusTrapStack[i];
    const container = entry.getContainer();
    if (container && isVisible(container)) {
      return entry.id;
    }
  }
  return null;
}

function stopKeyboardEvent(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options?: FocusTrapOptions,
) {
  const initialFocusDoneRef = useRef(false);
  const optionsRef = useRef(options);
  const trapIdRef = useRef<number | null>(null);
  const active = options?.active ?? true;

  optionsRef.current = options;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (trapIdRef.current !== getTopVisibleTrapId()) return;

      if (e.key === "Escape") {
        stopKeyboardEvent(e);
        optionsRef.current?.onEscape?.();
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
    [containerRef],
  );

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const trapId = ++nextFocusTrapId;
    trapIdRef.current = trapId;
    focusTrapStack.push({ id: trapId, getContainer: () => containerRef.current });
    document.addEventListener("keydown", handleKeyDown);

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!initialFocusDoneRef.current && optionsRef.current?.initialFocus !== false) {
      initialFocusDoneRef.current = true;
      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        requestAnimationFrame(() => {
          if (trapIdRef.current === getTopVisibleTrapId()) {
            focusable[0].focus();
          }
        });
      }
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const idx = focusTrapStack.findIndex((entry) => entry.id === trapId);
      if (idx >= 0) focusTrapStack.splice(idx, 1);
      if (
        optionsRef.current?.returnFocus !== false &&
        previouslyFocused &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
      trapIdRef.current = null;
    };
  }, [active, containerRef, handleKeyDown]);
}

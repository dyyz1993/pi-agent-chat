import { memo, useCallback, useEffect, useState, type RefObject } from "react";
import { Copy, MessageSquareQuote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCopyFeedback } from "../primitives";

interface TextSelectionToolbarProps {
  rootRef: RefObject<HTMLElement>;
  onQuoteText: (text: string) => void;
  onFocusInput: () => void;
}

interface SelectionState {
  text: string;
  x: number;
  y: number;
}

const MAX_SELECTED_TEXT = 4000;
const TOOLBAR_WIDTH = 226;
const TOOLBAR_HEIGHT = 36;
const VIEWPORT_MARGIN = 8;
const SELECTION_GAP = 16;

function isNodeInside(root: HTMLElement, node: Node | null): boolean {
  if (!node) return false;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return !!element && root.contains(element);
}

function getSelectionText(selection: Selection): string {
  return selection.toString().replace(/\s+\n/g, "\n").trim().slice(0, MAX_SELECTED_TEXT);
}

function getSelectionRect(selection: Selection): DOMRect | null {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  return rects[0] ?? range.getBoundingClientRect();
}

function clampToolbarPosition(rect: DOMRect): { x: number; y: number } {
  const rawX = rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2;
  const aboveY = rect.top - TOOLBAR_HEIGHT - SELECTION_GAP;
  const belowY = rect.bottom + SELECTION_GAP;
  const rawY = aboveY >= VIEWPORT_MARGIN ? aboveY : belowY;
  const maxX = window.innerWidth - TOOLBAR_WIDTH - VIEWPORT_MARGIN;
  const maxY = window.innerHeight - TOOLBAR_HEIGHT - VIEWPORT_MARGIN;
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(rawX, maxX)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(rawY, maxY)),
  };
}

export const TextSelectionToolbar = memo(function TextSelectionToolbar({
  rootRef,
  onQuoteText,
  onFocusInput,
}: TextSelectionToolbarProps) {
  const { t } = useTranslation(["chat", "common"]);
  const copyWithFeedback = useCopyFeedback({ showToast: false });
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelectionState(null);
  }, []);

  const refreshSelection = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed) {
      setSelectionState(null);
      return;
    }
    if (!isNodeInside(root, selection.anchorNode) || !isNodeInside(root, selection.focusNode)) {
      setSelectionState(null);
      return;
    }

    const text = getSelectionText(selection);
    const rect = getSelectionRect(selection);
    if (!text || !rect || rect.width <= 0 || rect.height <= 0) {
      setSelectionState(null);
      return;
    }

    setSelectionState({ text, ...clampToolbarPosition(rect) });
  }, [rootRef]);

  useEffect(() => {
    const deferredRefresh = () => window.setTimeout(refreshSelection, 0);
    const hide = () => setSelectionState(null);
    document.addEventListener("selectionchange", deferredRefresh);
    document.addEventListener("mouseup", deferredRefresh);
    document.addEventListener("keyup", deferredRefresh);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("selectionchange", deferredRefresh);
      document.removeEventListener("mouseup", deferredRefresh);
      document.removeEventListener("keyup", deferredRefresh);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [refreshSelection]);

  const handleCopy = useCallback(() => {
    if (!selectionState?.text) return;
    void copyWithFeedback(selectionState.text);
    clearSelection();
  }, [clearSelection, copyWithFeedback, selectionState?.text]);

  const handleQuoteToInput = useCallback(() => {
    if (!selectionState?.text) return;
    onQuoteText(selectionState.text);
    onFocusInput();
    clearSelection();
  }, [clearSelection, onFocusInput, onQuoteText, selectionState?.text]);

  if (!selectionState) return null;

  return (
    <div
      className="fixed z-[var(--z-tooltip)] flex items-center gap-1 rounded-md border border-border-primary bg-bg-elevated/95 px-1.5 py-1 text-xs text-text-secondary shadow-lg backdrop-blur"
      style={{ left: selectionState.x, top: selectionState.y, width: TOOLBAR_WIDTH }}
      onMouseDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label={t("selectionToolbar")}
    >
      <button
        type="button"
        onClick={handleCopy}
        className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded px-2 py-1 hover:bg-surface-hover hover:text-text-primary"
      >
        <Copy className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate whitespace-nowrap">{t("copyText")}</span>
      </button>
      <button
        type="button"
        onClick={handleQuoteToInput}
        className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded px-2 py-1 hover:bg-surface-hover hover:text-text-primary"
      >
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate whitespace-nowrap">{t("quoteToInput")}</span>
      </button>
    </div>
  );
});

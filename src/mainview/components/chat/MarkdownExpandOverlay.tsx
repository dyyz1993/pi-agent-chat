import { memo, useCallback, useEffect, useRef } from "react";
import { X, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import { useExpandStore } from "../../stores/use-expand-store";
import { copyToClipboard } from "../../utils/clipboard";
import { useFocusTrap } from "../../hooks/use-focus-trap";

export const MarkdownExpandOverlay = memo(function MarkdownExpandOverlay() {
  const { t } = useTranslation("chat");
  const expandedContent = useExpandStore((s) => s.expandedContent);
  const expandedTitle = useExpandStore((s) => s.expandedTitle);
  const closeExpand = useExpandStore((s) => s.closeExpand);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevContentRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, { onEscape: closeExpand });

  useEffect(() => {
    if (expandedContent && expandedContent !== prevContentRef.current) {
      prevContentRef.current = expandedContent;
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      });
    }
  }, [expandedContent]);

  useEffect(() => {
    if (!expandedContent) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeExpand();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expandedContent, closeExpand]);

  const handleCopy = useCallback(() => {
    if (expandedContent) copyToClipboard(expandedContent);
  }, [expandedContent]);

  if (!expandedContent) return null;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-50 flex flex-col bg-white/98 dark:bg-gray-950/98 backdrop-blur-sm"
    >
      <div
        className="flex items-center gap-2 px-4 py-2 bg-gray-50/90 dark:bg-gray-900/90 border-b border-gray-200 dark:border-gray-800 flex-shrink-0"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate flex-1 min-w-0">
          {expandedTitle}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            className="p-2 rounded text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            title={t("copyContentTitle")}
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={closeExpand}
            className="p-2 rounded text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            title={t("markdownOverlay.closeEsc")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="max-w-4xl mx-auto px-6 py-6 prose dark:prose-invert prose-sm max-w-none prose-p:my-2 prose-pre:bg-gray-100/80 dark:prose-pre:bg-gray-900/80 prose-pre:border prose-pre:border-gray-200 dark:prose-pre:border-gray-800 prose-code:text-emerald-700 dark:prose-code:text-emerald-300 prose-a:text-indigo-400">
          <CachedReactMarkdown>{expandedContent}</CachedReactMarkdown>
        </div>
      </div>
    </div>
  );
});

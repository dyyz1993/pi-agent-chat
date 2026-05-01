import { memo, useCallback, useEffect, useRef } from "react";
import { X, Copy } from "lucide-react";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import { useExpandStore } from "../../stores/use-expand-store";
import { copyToClipboard } from "../../utils/clipboard";

export const MarkdownExpandOverlay = memo(function MarkdownExpandOverlay() {
  const expandedContent = useExpandStore((s) => s.expandedContent);
  const expandedTitle = useExpandStore((s) => s.expandedTitle);
  const closeExpand = useExpandStore((s) => s.closeExpand);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevContentRef = useRef<string | null>(null);

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
    <div className="absolute inset-0 z-50 flex flex-col bg-gray-950/98 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/90 border-b border-gray-800 flex-shrink-0">
        <span className="text-xs text-gray-400 font-medium truncate flex-1 min-w-0">
          {expandedTitle}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            title="复制内容"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={closeExpand}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-4xl mx-auto px-6 py-6 prose prose-invert prose-sm max-w-none prose-p:my-2 prose-pre:bg-gray-900/80 prose-pre:border prose-pre:border-gray-800 prose-code:text-emerald-300 prose-a:text-indigo-400">
          <CachedReactMarkdown>{expandedContent}</CachedReactMarkdown>
        </div>
      </div>
    </div>
  );
});

import { memo, useCallback, useEffect, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import { useChatOverlayStore } from "../../stores/use-chat-overlay-store";
import { useClipboard } from "./preview/use-clipboard";
import { ContentSurface, IconButton } from "../primitives";

export const MarkdownExpandOverlay = memo(function MarkdownExpandOverlay() {
  const { t } = useTranslation("chat");
  const expandedContent = useChatOverlayStore((s) => s.markdownContent);
  const expandedTitle = useChatOverlayStore((s) => s.markdownTitle);
  const closeExpand = useChatOverlayStore((s) => s.close);
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

  const { copied, copy } = useClipboard(2000);

  const handleCopy = useCallback(() => {
    if (expandedContent) copy(expandedContent);
  }, [expandedContent, copy]);

  if (!expandedContent) return null;

  return (
    <ContentSurface
      title={expandedTitle}
      onClose={closeExpand}
      closeLabel={t("markdownOverlay.closeEsc")}
      position="absolute"
      layer="modal"
      bodyRef={scrollRef}
      actions={
        <IconButton
          label={t("copyContentTitle")}
          size="sm"
          onClick={handleCopy}
          className="rounded-md"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-status-success" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </IconButton>
      }
    >
      <div className="max-w-4xl mx-auto px-6 py-6 prose dark:prose-invert prose-sm max-w-none prose-p:my-2 prose-pre:bg-surface-dim/80 dark:prose-pre:bg-surface-code/80 prose-pre:border prose-pre:border-border-secondary dark:prose-pre:border-border-secondary prose-code:text-emerald-700 dark:prose-code:text-emerald-300 prose-a:text-semantic-accent">
        <CachedReactMarkdown>{expandedContent}</CachedReactMarkdown>
      </div>
    </ContentSurface>
  );
});

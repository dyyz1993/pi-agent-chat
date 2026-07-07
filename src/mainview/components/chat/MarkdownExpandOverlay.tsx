import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import { useChatOverlayStore } from "../../stores/use-chat-overlay-store";
import { useClipboard } from "./preview/use-clipboard";
import { ContentSurface, IconButton } from "../primitives";
import {
  loadSavedZoom,
  saveZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from "../file-preview/zoom-utils";
import { usePinchZoom } from "../file-preview/use-pinch-zoom";

const zoomBtnClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover/70 hover:text-text-primary dark:hover:text-text-primary transition-colors disabled:opacity-40";

export const MarkdownExpandOverlay = memo(function MarkdownExpandOverlay() {
  const { t } = useTranslation("chat");
  const expandedContent = useChatOverlayStore((s) => s.markdownContent);
  const expandedTitle = useChatOverlayStore((s) => s.markdownTitle);
  const closeExpand = useChatOverlayStore((s) => s.close);
  const prevContentRef = useRef<string | null>(null);
  const [fontSize, setFontSize] = useState(loadSavedZoom);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const bodyRef = usePinchZoom(fontSizeRef, setFontSize);

  useEffect(() => {
    if (expandedContent && expandedContent !== prevContentRef.current) {
      prevContentRef.current = expandedContent;
      requestAnimationFrame(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = 0;
      });
    }
  }, [expandedContent, bodyRef]);

  const { copied, copy } = useClipboard(2000);

  const handleCopy = useCallback(() => {
    if (expandedContent) copy(expandedContent);
  }, [expandedContent, copy]);

  if (!expandedContent) return null;

  const zoomPercent = Math.round((fontSize / ZOOM_DEFAULT) * 100);

  const handleZoomIn = useCallback(() => {
    setFontSize((prev) => {
      const next = Math.min(prev + ZOOM_STEP, ZOOM_MAX);
      saveZoom(next);
      return next;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setFontSize((prev) => {
      const next = Math.max(prev - ZOOM_STEP, ZOOM_MIN);
      saveZoom(next);
      return next;
    });
  }, []);

  const handleZoomReset = useCallback(() => {
    setFontSize(ZOOM_DEFAULT);
    saveZoom(ZOOM_DEFAULT);
  }, []);

  const lineHeight = Math.round(fontSize * 20 / 12);

  return (
    <ContentSurface
      title={expandedTitle}
      onClose={closeExpand}
      closeLabel={t("markdownOverlay.closeEsc")}
      position="absolute"
      layer="modal"
      bodyRef={bodyRef}
      bodyClassName="touch-pan-y"
      actions={
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleZoomOut}
            disabled={fontSize <= ZOOM_MIN}
            className={zoomBtnClass}
            title={t("explorer:zoomOut")}
            aria-label={t("explorer:zoomOut")}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleZoomReset}
            className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded-md px-1 text-text-tertiary hover:bg-surface-hover/70 hover:text-text-primary dark:hover:text-text-primary transition-colors"
            title={t("explorer:zoomReset")}
          >
            <span className="tabular-nums text-[10px] font-medium">{zoomPercent}%</span>
          </button>
          <button
            onClick={handleZoomIn}
            disabled={fontSize >= ZOOM_MAX}
            className={zoomBtnClass}
            title={t("explorer:zoomIn")}
            aria-label={t("explorer:zoomIn")}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <div className="ml-1 pl-1 border-l border-border-secondary">
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
          </div>
        </div>
      }
    >
      <div
        className="max-w-4xl mx-auto px-6 py-6 prose dark:prose-invert prose-sm max-w-none prose-p:my-2 prose-pre:bg-surface-dim/80 dark:prose-pre:bg-surface-code/80 prose-pre:border prose-pre:border-border-secondary dark:prose-pre:border-border-secondary prose-code:text-emerald-700 dark:prose-code:text-emerald-300 prose-a:text-semantic-accent"
        style={{
          fontSize: fontSize + "px",
          lineHeight: lineHeight + "px",
        }}
      >
        <CachedReactMarkdown>{expandedContent}</CachedReactMarkdown>
      </div>
    </ContentSurface>
  );
});

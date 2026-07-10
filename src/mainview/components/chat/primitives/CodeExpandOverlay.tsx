import { memo, useRef, useCallback, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContentSurface } from "../../primitives";
import {
  loadSavedZoom,
  saveZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from "../../file-preview/zoom-utils";
import { usePinchZoom } from "../../file-preview/use-pinch-zoom";

interface CodeExpandOverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const zoomBtnClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover/70 hover:text-text-primary dark:hover:text-text-primary transition-colors disabled:opacity-40";

export const CodeExpandOverlay = memo(function CodeExpandOverlay({
  open,
  onClose,
  title,
  children,
}: CodeExpandOverlayProps) {
  const { t } = useTranslation();
  const [fontSize, setFontSize] = useState(loadSavedZoom);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const bodyRef = usePinchZoom(fontSizeRef, setFontSize);

  if (!open) return null;

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

  const actions = (
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
    </div>
  );

  return (
    <ContentSurface
      title={title}
      onClose={onClose}
      closeLabel={t("common:close")}
      position="absolute"
      bodyClassName="overflow-auto touch-pan-y"
      bodyRef={bodyRef}
      actions={actions}
    >
      <div
        style={{
          fontSize: fontSize + "px",
          lineHeight: Math.round(fontSize * 20 / 12) + "px",
        }}
      >
        {children}
      </div>
    </ContentSurface>
  );
});

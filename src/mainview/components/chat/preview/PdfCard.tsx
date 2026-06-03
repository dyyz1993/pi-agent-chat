import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { FileText, X, RefreshCw, Maximize2, ExternalLink } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";
import { CopyAction, IconButton } from "../../primitives";

export const PdfCard = memo(function PdfCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const httpUrl = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";
  const [iframeKey, setIframeKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const handleRetry = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullscreen]);

  if (!httpUrl) {
    return (
      <div className="rounded-lg overflow-hidden border border-border-secondary dark:border-border-secondary/40 bg-bg-elevated dark:bg-surface-code/60">
        <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-border-secondary dark:border-border-secondary/30">
          <FileText className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
          <span className="text-text-primary dark:text-text-secondary truncate min-w-0">
            {details.title ?? details.source}
          </span>
        </div>
        <div className="px-3 py-4 text-xs text-text-tertiary italic">{t("noPathForPreview")}</div>
      </div>
    );
  }

  const headerButtons = (
    <div className="flex items-center gap-1 ml-auto shrink-0">
      <IconButton
        onClick={handleRetry}
        label={t("reloadTitle")}
        size="sm"
        className="h-7 w-7 rounded-md"
      >
        <RefreshCw className="w-3 h-3" />
      </IconButton>
      {!fullscreen && (
        <IconButton
          onClick={() => setFullscreen(true)}
          label={t("fullscreenTitle")}
          size="sm"
          className="h-7 w-7 rounded-md"
        >
          <Maximize2 className="w-3 h-3" />
        </IconButton>
      )}
      <CopyAction
        text={httpUrl}
        size="xs"
        title={t("copyLinkTitle")}
        className="h-7 w-7 rounded-md"
      />
      <IconButton
        onClick={() => window.open(httpUrl, "_blank", "noopener,noreferrer")}
        label={t("openInNewWindowTitle")}
        size="sm"
        className="h-7 w-7 rounded-md"
      >
        <ExternalLink className="w-3 h-3" />
      </IconButton>
      {fullscreen && (
        <IconButton
          onClick={() => setFullscreen(false)}
          label={t("closeEscTitle")}
          size="md"
          className="ml-1 h-10 w-10 rounded-md"
        >
          <X className="w-4 h-4" />
        </IconButton>
      )}
    </div>
  );

  const header = (
    <div
      className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-border-secondary dark:border-border-secondary/30"
      style={
        fullscreen ? { paddingTop: "calc(0.375rem + env(safe-area-inset-top, 0px))" } : undefined
      }
    >
      <FileText className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
      <span className="text-text-primary dark:text-text-secondary truncate min-w-0">
        {details.title ?? details.source}
      </span>
      {headerButtons}
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-fullscreen bg-bg-elevated dark:bg-black flex flex-col">
        {header}
        <iframe
          key={iframeKey}
          src={httpUrl}
          className="flex-1 w-full border-0"
          title={details.title ?? details.source}
        />
      </div>,
      document.body,
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary dark:border-border-secondary/40 bg-bg-elevated dark:bg-surface-code/60">
      {header}
      <iframe
        key={iframeKey}
        src={httpUrl}
        className="w-full border-0"
        style={{ minHeight: 300, maxHeight: 600 }}
        title={details.title ?? details.source}
      />
    </div>
  );
});

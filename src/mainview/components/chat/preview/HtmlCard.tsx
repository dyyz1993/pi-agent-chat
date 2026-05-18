import { memo, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Code, X, RefreshCw, Maximize2, Copy, Check, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";
import { useClipboard } from "./use-clipboard";

export const HtmlCard = memo(function HtmlCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const httpUrl = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";
  const [iframeKey, setIframeKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const { copied, copy } = useClipboard();

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
          <Code className="w-3.5 h-3.5 text-orange-500 dark:text-orange-400 shrink-0" />
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
      <button
        onClick={handleRetry}
        className="p-0.5 rounded text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50 transition-colors"
        title={t("reloadTitle")}
      >
        <RefreshCw className="w-3 h-3" />
      </button>
      {!fullscreen && (
        <button
          onClick={() => setFullscreen(true)}
          className="p-0.5 rounded text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50 transition-colors"
          title={t("fullscreenTitle")}
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={() => copy(httpUrl)}
        className="p-0.5 rounded text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50 transition-colors"
        title={t("copyLinkTitle")}
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-500 dark:text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
      <button
        onClick={() => window.open(httpUrl, "_blank", "noopener,noreferrer")}
        className="p-0.5 rounded text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50 transition-colors"
        title={t("openInNewWindowTitle")}
      >
        <ExternalLink className="w-3 h-3" />
      </button>
      {fullscreen && (
        <button
          onClick={() => setFullscreen(false)}
          className="p-2 rounded text-text-secondary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover/50 transition-colors ml-1"
          title={t("closeEscTitle")}
        >
          <X className="w-4 h-4" />
        </button>
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
      <Code className="w-3.5 h-3.5 text-orange-500 dark:text-orange-400 shrink-0" />
      <span className="text-text-primary dark:text-text-secondary truncate min-w-0">
        {details.title ?? details.source}
      </span>
      {headerButtons}
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[200] bg-bg-elevated dark:bg-black flex flex-col">
        {header}
        <iframe
          key={iframeKey}
          src={httpUrl}
          className="flex-1 w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
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
        style={{ minHeight: 200, maxHeight: 600 }}
        sandbox="allow-scripts allow-same-origin allow-forms"
        title={details.title ?? details.source}
      />
    </div>
  );
});

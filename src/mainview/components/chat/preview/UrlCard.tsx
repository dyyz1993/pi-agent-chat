import { memo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Globe, X, RefreshCw, Maximize2, Copy, Check, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";
import { useClipboard } from "./use-clipboard";

export const UrlCard = memo(function UrlCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const [showIframe, setShowIframe] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const src = details.absolutePath ?? details.source;
  const { copied, copy } = useClipboard();

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullscreen]);

  if (!showIframe) {
    return (
      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-900/60">
        <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-200 dark:border-gray-700/30">
          <Globe className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 shrink-0" />
          <span className="text-gray-800 dark:text-gray-300 truncate min-w-0">
            {details.title ?? src}
          </span>
        </div>
        <button
          onClick={() => setShowIframe(true)}
          className="w-full px-3 py-8 flex flex-col items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
        >
          <Globe className="w-6 h-6 text-blue-400/60 dark:text-blue-400/60" />
          <span>{t("clickToLoadPreview")}</span>
          <span className="text-gray-400 dark:text-gray-600 font-mono text-[10px]">{src}</span>
        </button>
      </div>
    );
  }

  const displayUrl = getFileHttpUrl(src);

  const headerButtons = (
    <div className="flex items-center gap-1 ml-auto shrink-0">
      <button
        onClick={() => {
          setShowIframe(false);
          setFullscreen(false);
        }}
        className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
        title={t("reloadTitle")}
      >
        <RefreshCw className="w-3 h-3" />
      </button>
      {!fullscreen && (
        <button
          onClick={() => setFullscreen(true)}
          className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
          title={t("fullscreenTitle")}
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={() => copy(displayUrl)}
        className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
        title={t("copyLinkTitle")}
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-500 dark:text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
      <button
        onClick={() => window.open(displayUrl, "_blank", "noopener,noreferrer")}
        className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
        title={t("openInNewWindowTitle")}
      >
        <ExternalLink className="w-3 h-3" />
      </button>
      {fullscreen && (
        <button
          onClick={() => setFullscreen(false)}
          className="p-0.5 rounded text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700/50 transition-colors ml-1"
          title={t("closeEscTitle")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  const header = (
    <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-200 dark:border-gray-700/30">
      <Globe className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 shrink-0" />
      <span className="text-gray-800 dark:text-gray-300 truncate min-w-0">
        {details.title ?? src}
      </span>
      {headerButtons}
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[200] bg-white dark:bg-black flex flex-col">
        {header}
        <iframe
          src={src}
          className="flex-1 w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title={details.title ?? src}
        />
      </div>,
      document.body,
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-900/60">
      {header}
      <iframe
        src={src}
        className="w-full border-0"
        style={{ minHeight: 300, maxHeight: 600 }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title={details.title ?? src}
      />
    </div>
  );
});

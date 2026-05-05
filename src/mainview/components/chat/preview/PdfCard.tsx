import { memo, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { FileText, X, RefreshCw, Maximize2, Copy, Check, ExternalLink } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";
import { useClipboard } from "./use-clipboard";

export const PdfCard = memo(function PdfCard({ details }: { details: PreviewDetails }) {
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
      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-900/60">
        <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-200 dark:border-gray-700/30">
          <FileText className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
          <span className="text-gray-800 dark:text-gray-300 truncate min-w-0">
            {details.title ?? details.source}
          </span>
        </div>
        <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 italic">
          No path available for preview
        </div>
      </div>
    );
  }

  const headerButtons = (
    <div className="flex items-center gap-1 ml-auto shrink-0">
      <button
        onClick={handleRetry}
        className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
        title="重新加载"
      >
        <RefreshCw className="w-3 h-3" />
      </button>
      {!fullscreen && (
        <button
          onClick={() => setFullscreen(true)}
          className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
          title="全屏展开"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={() => copy(httpUrl)}
        className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
        title="复制链接"
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-500 dark:text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
      <button
        onClick={() => window.open(httpUrl, "_blank", "noopener,noreferrer")}
        className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
        title="在新窗口打开"
      >
        <ExternalLink className="w-3 h-3" />
      </button>
      {fullscreen && (
        <button
          onClick={() => setFullscreen(false)}
          className="p-0.5 rounded text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700/50 transition-colors ml-1"
          title="关闭 (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  const header = (
    <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-200 dark:border-gray-700/30">
      <FileText className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
      <span className="text-gray-800 dark:text-gray-300 truncate min-w-0">
        {details.title ?? details.source}
      </span>
      {headerButtons}
    </div>
  );

  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[200] bg-white dark:bg-black flex flex-col">
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
    <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-900/60">
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

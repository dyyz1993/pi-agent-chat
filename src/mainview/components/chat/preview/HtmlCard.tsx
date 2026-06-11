import { memo, useState, useCallback } from "react";
import { Code, RefreshCw, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";
import { CopyAction, IconButton, IframeFullscreenOverlay } from "../../primitives";

export const HtmlCard = memo(function HtmlCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const httpUrl = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";
  const [iframeKey, setIframeKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const handleRetry = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

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

  const actions = (
    <div className="flex items-center gap-1">
      <IconButton
        onClick={handleRetry}
        label={t("reloadTitle")}
        size="sm"
        className="h-7 w-7 rounded-md"
      >
        <RefreshCw className="w-3 h-3" />
      </IconButton>
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
    </div>
  );

  if (fullscreen) {
    return (
      <IframeFullscreenOverlay
        icon={<Code className="w-3.5 h-3.5 text-orange-500 dark:text-orange-400 shrink-0" />}
        title={details.title ?? details.source}
        src={httpUrl}
        onClose={() => setFullscreen(false)}
        closeLabel={t("closeEscTitle")}
        actions={actions}
        iframeKey={iframeKey}
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary dark:border-border-secondary/40 bg-bg-elevated dark:bg-surface-code/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-border-secondary dark:border-border-secondary/30">
        <Code className="w-3.5 h-3.5 text-orange-500 dark:text-orange-400 shrink-0" />
        <span className="text-text-primary dark:text-text-secondary truncate min-w-0">
          {details.title ?? details.source}
        </span>
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <IconButton
            onClick={handleRetry}
            label={t("reloadTitle")}
            size="sm"
            className="h-7 w-7 rounded-md"
          >
            <RefreshCw className="w-3 h-3" />
          </IconButton>
          <IconButton
            onClick={() => setFullscreen(true)}
            label={t("fullscreenTitle")}
            size="sm"
            className="h-7 w-7 rounded-md"
          >
            <Code className="w-3 h-3" />
          </IconButton>
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
        </div>
      </div>
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

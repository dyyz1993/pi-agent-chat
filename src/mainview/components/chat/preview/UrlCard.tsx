import { memo, useState } from "react";
import { Globe, RefreshCw, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";
import { CopyAction, IconButton, IframeFullscreenOverlay } from "../../primitives";

export const UrlCard = memo(function UrlCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const [showIframe, setShowIframe] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const src = details.absolutePath ?? details.source;

  if (!showIframe) {
    return (
      <div className="rounded-lg overflow-hidden border border-border-secondary/40 bg-bg-elevated bg-surface-code/60">
        <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-border-secondary/30">
          <Globe className="w-3.5 h-3.5 text-status-info shrink-0" />
          <span className="text-text-primary truncate min-w-0">{details.title ?? src}</span>
        </div>
        <button
          onClick={() => setShowIframe(true)}
          className="w-full px-3 py-8 flex flex-col items-center gap-2 text-xs text-text-tertiary hover:text-text-primary hover:bg-surface-dim transition-colors"
        >
          <Globe className="w-6 h-6 text-status-info/60" />
          <span>{t("clickToLoadPreview")}</span>
          <span className="text-text-tertiary font-mono text-[10px]">{src}</span>
        </button>
      </div>
    );
  }

  const displayUrl = getFileHttpUrl(src);

  const actions = (
    <div className="flex items-center gap-1">
      <IconButton
        onClick={() => {
          setShowIframe(false);
          setFullscreen(false);
        }}
        label={t("reloadTitle")}
        size="sm"
        className="h-7 w-7 rounded-md"
      >
        <RefreshCw className="w-3 h-3" />
      </IconButton>
      <CopyAction
        text={displayUrl}
        size="xs"
        title={t("copyLinkTitle")}
        className="h-7 w-7 rounded-md"
      />
      <IconButton
        onClick={() => window.open(displayUrl, "_blank", "noopener,noreferrer")}
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
        icon={<Globe className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 shrink-0" />}
        title={details.title ?? src}
        src={displayUrl}
        onClose={() => setFullscreen(false)}
        closeLabel={t("closeEscTitle")}
        actions={actions}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary dark:border-border-secondary/40 bg-bg-elevated dark:bg-surface-code/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-border-secondary dark:border-border-secondary/30">
        <Globe className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 shrink-0" />
        <span className="text-text-primary dark:text-text-secondary truncate min-w-0">
          {details.title ?? src}
        </span>
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <IconButton
            onClick={() => {
              setShowIframe(false);
              setFullscreen(false);
            }}
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
            <Globe className="w-3 h-3" />
          </IconButton>
          <CopyAction
            text={displayUrl}
            size="xs"
            title={t("copyLinkTitle")}
            className="h-7 w-7 rounded-md"
          />
          <IconButton
            onClick={() => window.open(displayUrl, "_blank", "noopener,noreferrer")}
            label={t("openInNewWindowTitle")}
            size="sm"
            className="h-7 w-7 rounded-md"
          >
            <ExternalLink className="w-3 h-3" />
          </IconButton>
        </div>
      </div>
      <iframe
        src={displayUrl}
        className="w-full border-0"
        style={{ minHeight: 300, maxHeight: 600 }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title={details.title ?? src}
      />
    </div>
  );
});

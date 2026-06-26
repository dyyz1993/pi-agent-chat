import { memo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FileText, RefreshCw, ExternalLink } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getPreviewRenderableSource } from "./types";
import { MediaCardError } from "./MediaCardError";
import { CopyAction, IconButton, IframeFullscreenOverlay } from "../../primitives";
import { usePreviewRenderSource } from "../../../hooks/use-preview-render-source";

export const PdfCard = memo(function PdfCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const renderableSource = getPreviewRenderableSource(details);
  const [iframeKey, setIframeKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const previewSource = usePreviewRenderSource(
    renderableSource,
    details.mimeType ?? "application/pdf",
    iframeKey,
  );

  const handleRetry = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  if (!renderableSource) {
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

  const actionUrl = previewSource.src || renderableSource;
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
        text={actionUrl}
        size="xs"
        title={t("copyLinkTitle")}
        className="h-7 w-7 rounded-md"
      />
      <IconButton
        onClick={() => window.open(actionUrl, "_blank", "noopener,noreferrer")}
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
        icon={<FileText className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />}
        title={details.title ?? details.source}
        src={previewSource.src}
        onClose={() => setFullscreen(false)}
        closeLabel={t("closeEscTitle")}
        actions={actions}
        iframeKey={iframeKey}
      />
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary dark:border-border-secondary/40 bg-bg-elevated dark:bg-surface-code/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-border-secondary dark:border-border-secondary/30">
        <FileText className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
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
            <FileText className="w-3 h-3" />
          </IconButton>
          <CopyAction
            text={actionUrl}
            size="xs"
            title={t("copyLinkTitle")}
            className="h-7 w-7 rounded-md"
          />
          <IconButton
            onClick={() => window.open(actionUrl, "_blank", "noopener,noreferrer")}
            label={t("openInNewWindowTitle")}
            size="sm"
            className="h-7 w-7 rounded-md"
          >
            <ExternalLink className="w-3 h-3" />
          </IconButton>
        </div>
      </div>
      {previewSource.loading ? (
        <div className="px-3 py-8 text-center text-xs text-text-tertiary animate-pulse">
          {t("loadingImage")}
        </div>
      ) : previewSource.error ? (
        <MediaCardError
          errorKind="server_error"
          errorDetail={previewSource.error}
          onRetry={handleRetry}
        />
      ) : previewSource.src ? (
        <iframe
          key={iframeKey}
          src={previewSource.src}
          className="w-full border-0"
          style={{ minHeight: 300, maxHeight: 600 }}
          title={details.title ?? details.source}
        />
      ) : (
        <div className="px-3 py-4 text-xs text-text-tertiary italic">{t("noPathForPreview")}</div>
      )}
    </div>
  );
});

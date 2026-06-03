import { memo } from "react";
import { ExternalLink, RefreshCw, Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CopyAction, IconButton } from "../../primitives";
import { getFileHttpUrl } from "./types";

interface CardActionBarProps {
  absolutePath?: string;
  onRetry?: () => void;
  onExpand?: () => void;
}

export const CardActionBar = memo(function CardActionBar({
  absolutePath,
  onRetry,
  onExpand,
}: CardActionBarProps) {
  const { t } = useTranslation("chat");

  if (!absolutePath) return null;

  const url = getFileHttpUrl(absolutePath);

  return (
    <div className="flex items-center gap-1 ml-auto shrink-0">
      {onRetry && (
        <IconButton
          onClick={onRetry}
          label={t("reloadTitle")}
          size="sm"
          className="h-7 w-7 rounded-md"
        >
          <RefreshCw className="w-3 h-3" />
        </IconButton>
      )}
      {onExpand && (
        <IconButton
          onClick={onExpand}
          label={t("fullscreenTitle")}
          size="sm"
          className="h-7 w-7 rounded-md"
        >
          <Maximize2 className="w-3 h-3" />
        </IconButton>
      )}
      <CopyAction text={url} size="xs" title={t("copyLinkTitle")} className="h-7 w-7 rounded-md" />
      <IconButton
        onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        label={t("openInNewWindowTitle")}
        size="sm"
        className="h-7 w-7 rounded-md"
      >
        <ExternalLink className="w-3 h-3" />
      </IconButton>
    </div>
  );
});

interface CardHeaderProps {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  absolutePath?: string;
  onRetry?: () => void;
  onExpand?: () => void;
}

export const CardHeader = memo(function CardHeader({
  icon,
  label,
  meta,
  absolutePath,
  onRetry,
  onExpand,
}: CardHeaderProps) {
  return (
    <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-border-secondary">
      {icon}
      <span className="text-text-primary truncate min-w-0">{label}</span>
      {meta && <span className="text-text-tertiary shrink-0 text-[10px]">{meta}</span>}
      <CardActionBar absolutePath={absolutePath} onRetry={onRetry} onExpand={onExpand} />
    </div>
  );
});

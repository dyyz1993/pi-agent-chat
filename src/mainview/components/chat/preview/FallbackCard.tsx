import { memo } from "react";
import { AlertCircle, FileQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { formatFileSize } from "./types";
import { CardHeader } from "./CardHeader";

export const FallbackCard = memo(function FallbackCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const hasError = details.status === "error" || details.status === "not_found";

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary dark:border-border-secondary/40 bg-bg-elevated dark:bg-surface-code/60">
      <CardHeader
        icon={
          hasError ? (
            <AlertCircle className="w-3.5 h-3.5 text-status-error shrink-0" />
          ) : (
            <FileQuestion className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
          )
        }
        label={details.title ?? details.source}
        absolutePath={details.absolutePath}
      />
      <div className="px-3 py-3 text-xs space-y-1">
        {details.error ? (
          <div className="text-status-error">{details.error}</div>
        ) : (
          <>
            <div className="text-text-secondary dark:text-text-tertiary">
              {t("typeLabel", { type: details.resourceType })}
            </div>
            {details.mimeType && (
              <div className="text-text-tertiary">{t("mimeLabel", { mime: details.mimeType })}</div>
            )}
            {details.size != null && (
              <div className="text-text-tertiary">
                {t("sizeLabel", { size: formatFileSize(details.size) })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

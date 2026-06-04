import { memo } from "react";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { CardHeader } from "./CardHeader";

export const MarkdownCard = memo(function MarkdownCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary bg-bg-elevated">
      <CardHeader
        icon={<FileText className="w-3.5 h-3.5 text-teal-500 dark:text-teal-400 shrink-0" />}
        label={details.title ?? details.source}
        absolutePath={details.absolutePath}
      />
      <div className="px-3 py-4 text-xs text-text-tertiary italic">
        {t("markdownPreview", { source: details.source })}
      </div>
    </div>
  );
});

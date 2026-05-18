import { memo } from "react";
import { Code } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { CardHeader } from "./CardHeader";

export const TextCard = memo(function TextCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary bg-bg-elevated">
      <CardHeader
        icon={<Code className="w-3.5 h-3.5 text-text-tertiary shrink-0" />}
        label={details.title ?? details.source}
        meta={details.mimeType}
        absolutePath={details.absolutePath}
      />
      <div className="px-3 py-4 text-xs text-text-tertiary italic">
        {t("textFilePreview", { source: details.source })}
      </div>
    </div>
  );
});

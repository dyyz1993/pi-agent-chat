import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CachedReactMarkdown } from "./CachedReactMarkdown";

export const CompactionSummaryCard = memo(function CompactionSummaryCard({
  summary,
  blockId,
}: {
  summary: string;
  blockId: string;
}) {
  const { t } = useTranslation("chat");
  const [isOpen, setIsOpen] = useState(false);

  const lines = summary.split("\n");
  const firstMeaningfulLine = lines.find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "";
  const preview = firstMeaningfulLine.slice(0, 120);
  const isLong = summary.length > 200 || lines.length > 6;

  return (
    <div data-block-id={blockId} className="my-0.5">
      <div className="px-3 py-1.5 text-sm text-text-secondary leading-relaxed">
        {isLong ? (
          <>
            <div className="flex items-start gap-1.5">
              <span className="text-text-tertiary flex-1">
                {preview}
                {firstMeaningfulLine.length > 120 ? "..." : ""}
              </span>
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="shrink-0 p-0.5 text-semantic-tool/60 hover:text-semantic-tool transition-colors text-[11px] underline decoration-dotted underline-offset-2"
                aria-expanded={isOpen}
                aria-label={isOpen ? t("collapseThinkingDetail") : t("expandThinkingDetail")}
              >
                {isOpen ? t("collapseDetail") : t("showDetail")}
              </button>
            </div>
            {isOpen && (
              <div className="mt-1.5 pl-0 border-l-2 border-semantic-tool/20 prose dark:prose-invert prose-sm max-w-none prose-p:my-0.5 prose-headings:my-1">
                <CachedReactMarkdown>{summary}</CachedReactMarkdown>
              </div>
            )}
          </>
        ) : (
          <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-0.5 prose-headings:my-1">
            <CachedReactMarkdown>{summary}</CachedReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
});

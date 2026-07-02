import { memo, useState } from "react";
import { ChevronDown, FileText, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { apiClient } from "../../../lib/api-client";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export const LongContentCard = memo(function LongContentCard({ block }: SpecialBlockRendererProps) {
  const { t } = useTranslation("chat");
  const path = block.attrs.path ?? "";
  const rawSummary = block.attrs.summary ?? basename(path);
  const summary = rawSummary ? rawSummary : t("longContent.untitled");
  const chars = block.attrs.originalLength ?? String(block.body.length);
  const lines = block.attrs.lineCount ?? String(block.body.split(/\r\n|\r|\n/u).length);
  const [expanded, setExpanded] = useState(false);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleExpanded = async () => {
    const next = !expanded;
    setExpanded(next);
    if (!next || fullContent || !path) return;
    setLoading(true);
    setError(null);
    try {
      const result = (await apiClient.call("file.readFile", { path })) as { content?: string };
      setFullContent(result.content ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="my-1 rounded-xl border border-border-secondary/50 bg-bg-secondary/80 text-xs shadow-sm">
      <button
        type="button"
        onClick={() => void toggleExpanded()}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        <FileText className="h-4 w-4 shrink-0 text-status-info" />
        <span className="shrink-0 rounded bg-status-info/10 px-1.5 py-0.5 text-[10px] font-medium text-status-info">
          {t("longContent.title")}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{summary}</span>
        <span className="shrink-0 text-[11px] text-text-tertiary">
          {t("longContent.stats", { chars, lines })}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      <div className="border-t border-border-primary/70 px-3 py-2">
        {path && <div className="break-all font-mono text-[10px] text-text-tertiary">{path}</div>}
        {!expanded && (
          <pre className="mt-2 max-h-28 overflow-hidden whitespace-pre-wrap rounded-lg bg-bg-primary/50 px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary">
            {block.body}
          </pre>
        )}
        {expanded && (
          <div className="mt-2">
            {loading ? (
              <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("loadingDots")}
              </div>
            ) : error ? (
              <div className="rounded-lg border border-status-error/30 bg-status-error/10 px-2 py-1.5 text-[11px] text-status-error">
                {error}
              </div>
            ) : (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-bg-primary/60 px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary">
                {fullContent ?? block.body}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

registerSpecialBlock("long-content", LongContentCard);

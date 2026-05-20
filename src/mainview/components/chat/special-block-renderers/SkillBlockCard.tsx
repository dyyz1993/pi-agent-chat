import { memo } from "react";
import { ChevronRight, BookOpen } from "lucide-react";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";

function extractSummary(body: string): string {
  const lines = body
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("References are relative to"));
  const firstHeading = lines.find((l) => l.startsWith("# "));
  if (firstHeading) return firstHeading.replace(/^#+\s*/, "");
  if (lines.length > 0) return lines[0].slice(0, 120);
  return "";
}

export const SkillBlockCard = memo(function SkillBlockCard({ block }: SpecialBlockRendererProps) {
  const summary = extractSummary(block.body);
  const name = block.attrs.name ?? "";
  const location = block.attrs.location ?? "";

  return (
    <details className="my-1 rounded-md border border-border-secondary/40 bg-surface-dim/50">
      <summary className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs cursor-pointer select-none hover:bg-surface-hover transition-colors list-none min-w-0">
        <ChevronRight className="w-3 h-3 shrink-0 text-text-tertiary details-chevron" />
        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-semantic-tool/10 text-semantic-tool text-[10px] font-medium">
          <BookOpen className="w-3 h-3" />
          技能
        </span>
        <span className="font-medium text-text-primary truncate">{name}</span>
        {summary && (
          <>
            <span className="text-text-tertiary shrink-0">·</span>
            <span className="text-text-secondary truncate">{summary}</span>
          </>
        )}
      </summary>
      <div className="px-2.5 pb-2 pt-1 border-t border-border-secondary/30">
        <div className="text-[10px] text-text-tertiary mb-1 font-mono truncate" title={location}>
          {location}
        </div>
        <pre className="text-xs text-text-secondary whitespace-pre-wrap break-words max-h-64 overflow-y-auto font-mono leading-relaxed">
          {block.body}
        </pre>
      </div>
      <style>{`
        details[open] > summary .details-chevron {
          transform: rotate(90deg);
          transition: transform 0.15s ease;
        }
        details:not([open]) > summary .details-chevron {
          transform: rotate(0deg);
          transition: transform 0.15s ease;
        }
      `}</style>
    </details>
  );
});

registerSpecialBlock("skill", SkillBlockCard);

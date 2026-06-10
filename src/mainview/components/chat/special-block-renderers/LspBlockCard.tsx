import { memo, useState } from "react";
import { ChevronDown, FileWarning } from "lucide-react";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";

export const LspBlockCard = memo(function LspBlockCard({ block }: SpecialBlockRendererProps) {
  const [collapsed, setCollapsed] = useState(true);
  const hasBody = !!block.body;
  const firstLine = block.body.split("\n")[0] ?? "";

  const isError = /error/i.test(firstLine);
  const iconColor = isError ? "text-status-error" : "text-status-warning";

  return (
    <div className="my-1 rounded-md border border-status-warning/30 bg-surface-dim/50">
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs min-w-0 ${hasBody ? "cursor-pointer" : ""}`}
        onClick={hasBody ? () => setCollapsed((c) => !c) : undefined}
      >
        <FileWarning className={`w-3 h-3 shrink-0 ${iconColor}`} />
        <span className="shrink-0 px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning text-[10px] font-medium">
          LSP
        </span>
        {firstLine && <span className="text-text-secondary truncate">{firstLine}</span>}
        {hasBody && (
          <ChevronDown
            className={`w-3 h-3 shrink-0 text-text-tertiary transition-transform ml-auto ${collapsed ? "" : "rotate-180"}`}
          />
        )}
      </div>
      {hasBody && !collapsed && (
        <div className="px-2.5 pb-2 pt-0.5 border-t border-border-secondary/30 text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed font-mono">
          {block.body}
        </div>
      )}
    </div>
  );
});

registerSpecialBlock("lsp", LspBlockCard);

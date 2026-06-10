import { memo, useState } from "react";
import { ChevronDown, AlertTriangle } from "lucide-react";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";

export const HookBlockCard = memo(function HookBlockCard({ block }: SpecialBlockRendererProps) {
  const from = block.attrs.from ?? "";
  const [collapsed, setCollapsed] = useState(true);
  const hasBody = !!block.body;

  return (
    <div className="my-1 rounded-md border border-status-warning/30 bg-status-warning/5">
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs min-w-0 ${hasBody ? "cursor-pointer" : ""}`}
        onClick={hasBody ? () => setCollapsed((c) => !c) : undefined}
      >
        <AlertTriangle className="w-3 h-3 shrink-0 text-status-warning" />
        <span className="shrink-0 px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning text-[10px] font-medium">
          Hook
        </span>
        {from && <span className="text-text-tertiary text-[10px] shrink-0">{from}</span>}
        {hasBody && (
          <>
            <span className="text-text-secondary truncate">{block.body.split("\n")[0]}</span>
            <ChevronDown
              className={`w-3 h-3 shrink-0 text-text-tertiary transition-transform ml-auto ${collapsed ? "" : "rotate-180"}`}
            />
          </>
        )}
      </div>
      {hasBody && !collapsed && (
        <div className="px-2.5 pb-2 pt-0.5 border-t border-status-warning/20 text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed">
          {block.body}
        </div>
      )}
    </div>
  );
});

registerSpecialBlock("hook", HookBlockCard);

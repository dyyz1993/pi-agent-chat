import { memo, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import {
  CHAT_COMPACT_BLOCK_CLASS,
  CHAT_COMPACT_ROW_BUTTON_BASE_CLASS,
} from "./chat-layout-classes";

export const SUPERVISOR_CONTINUE_CUSTOM_TYPE = "supervisor_continue";

const PREVIEW_LIMIT = 140;

function stringifyContinueData(data: unknown): string {
  if (typeof data === "string") return data.trim();
  if (!data || typeof data !== "object") return "";

  const d = data as Record<string, unknown>;
  for (const key of ["message", "content", "prompt", "reason", "summary"]) {
    const value = d[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function buildPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Continue requested";
  return normalized.length > PREVIEW_LIMIT
    ? `${normalized.slice(0, PREVIEW_LIMIT)}...`
    : normalized;
}

export const SupervisorContinueCard = memo(function SupervisorContinueCard({
  data,
}: {
  data: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = useMemo(() => stringifyContinueData(data), [data]);
  const preview = useMemo(() => buildPreview(text), [text]);

  return (
    <div className={CHAT_COMPACT_BLOCK_CLASS}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`${CHAT_COMPACT_ROW_BUTTON_BASE_CLASS} text-status-info hover:bg-status-info/5`}
        aria-expanded={expanded}
        aria-label="Supervisor Continue"
      >
        <RefreshCw className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="font-medium whitespace-nowrap">Supervisor Continue</span>
          <span className="text-text-tertiary truncate">{preview}</span>
        </span>
        <span className="text-text-tertiary shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded && text && (
        <div className="px-3 pb-2 text-[11px] text-text-secondary whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
});

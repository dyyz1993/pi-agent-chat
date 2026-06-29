import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, CircleCheckBig, Clock, Hash, Target } from "lucide-react";

import { formatDuration } from "./primitives/formatDuration";
import {
  CHAT_COMPACT_BLOCK_CLASS,
  CHAT_COMPACT_ROW_BUTTON_BASE_CLASS,
} from "./chat-layout-classes";

interface GoalCompleteData {
  goalId?: string;
  objective?: string;
  verdict?: string;
  continuationCount?: number;
  durationMs?: number;
  evidence?: string[];
}

function formatDurationShort(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export const GoalCompleteCard = memo(function GoalCompleteCard({
  data,
}: {
  data: unknown;
  blockId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation("chat");

  const d = (data ?? {}) as GoalCompleteData;
  const objective = d.objective ?? "";
  const continuationCount = d.continuationCount ?? 0;
  const durationMs = d.durationMs ?? 0;
  const evidence = d.evidence ?? [];

  return (
    <div className={CHAT_COMPACT_BLOCK_CLASS}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`${CHAT_COMPACT_ROW_BUTTON_BASE_CLASS} text-status-success hover:bg-status-success/5`}
        aria-expanded={expanded}
        aria-label={t("goal.completeCardLabel")}
      >
        <CircleCheckBig className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="font-medium whitespace-nowrap">{t("goal.completeCardLabel")}</span>
          {objective && <span className="text-text-tertiary truncate">{objective}</span>}
        </span>
        <span className="shrink-0 flex items-center gap-2 text-[10px] text-text-tertiary">
          {durationMs > 0 && (
            <span className="flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {formatDurationShort(durationMs)}
            </span>
          )}
          {continuationCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Hash className="w-2.5 h-2.5" />
              {continuationCount} {t("goal.executions")}
            </span>
          )}
        </span>
        <span className="text-text-tertiary shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-[11px] space-y-1.5">
          {objective && (
            <div className="flex gap-1.5 items-start">
              <Target className="w-3 h-3 mt-0.5 shrink-0 text-status-success/60" />
              <span className="text-text-secondary">{objective}</span>
            </div>
          )}
          {durationMs > 0 && (
            <div className="flex gap-1.5 items-center">
              <Clock className="w-3 h-3 shrink-0 text-text-tertiary/60" />
              <span className="text-text-tertiary">{t("goal.totalDuration")}</span>
              <span className="text-text-secondary">{formatDuration(durationMs)}</span>
            </div>
          )}
          {continuationCount > 0 && (
            <div className="flex gap-1.5 items-center">
              <Hash className="w-3 h-3 shrink-0 text-text-tertiary/60" />
              <span className="text-text-tertiary">{t("goal.totalExecutions")}</span>
              <span className="text-text-secondary">{continuationCount}</span>
            </div>
          )}
          {evidence.length > 0 && (
            <div className="space-y-0.5 mt-1">
              <div className="text-[10px] font-medium text-text-tertiary">{t("goal.evidence")}</div>
              {evidence.map((e, i) => (
                <div key={i} className="text-text-tertiary flex gap-1 items-start pl-1">
                  <span className="text-status-success/60 shrink-0">•</span>
                  <span className="text-text-secondary">{e}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

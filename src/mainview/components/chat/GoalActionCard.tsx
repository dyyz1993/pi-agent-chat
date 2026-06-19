import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { GoalState, GoldResult, TriggerRecord } from "../../../shared/modules/supervisor";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useSupervisorStore } from "../../stores/use-supervisor-store";

type GoalCardState = GoalState["status"];
type GoalWithLegacyFields = GoalState & {
  state?: GoalCardState;
  createdAt?: number;
  completedAt?: number;
};

const EMPTY_TRIGGER_RECORDS: TriggerRecord[] = [];

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours}h ${rest}m`;
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getGoalStatus(goal: GoalWithLegacyFields): GoalCardState {
  return goal.status ?? goal.state ?? "running";
}

function getGoalStartedAt(goal: GoalWithLegacyFields): number {
  const startedAt = goal.startedAt ?? goal.createdAt;
  return typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : Date.now();
}

function getGoalEndedAt(goal: GoalWithLegacyFields, now: number): number {
  const endedAt = goal.completedAt ?? goal.updatedAt;
  return typeof endedAt === "number" && Number.isFinite(endedAt) ? endedAt : now;
}

function getGoalTone(status: GoalCardState): {
  icon: LucideIcon;
  className: string;
  iconClassName: string;
} {
  if (status === "complete") {
    return {
      icon: CheckCircle2,
      className: "border-status-success/40 bg-status-success/10",
      iconClassName: "text-status-success",
    };
  }
  if (status === "blocked" || status === "needs_user") {
    return {
      icon: AlertTriangle,
      className: "border-status-warning/50 bg-status-warning/10",
      iconClassName: "text-status-warning",
    };
  }
  return {
    icon: Loader2,
    className: "border-semantic-accent/40 bg-semantic-accent/10",
    iconClassName: "text-semantic-accent",
  };
}

function goldSummary(result?: GoldResult): string | null {
  if (!result) return null;
  if (result.reason) return result.reason;
  return result.verdict;
}

function checklistStatusClass(status: NonNullable<GoalState["checklist"]>[number]["status"]): string {
  switch (status) {
    case "done":
      return "text-status-success";
    case "blocked":
      return "text-status-warning";
    case "in_progress":
      return "text-semantic-accent";
    default:
      return "text-text-tertiary";
  }
}

function checklistMarker(status: NonNullable<GoalState["checklist"]>[number]["status"]): string {
  switch (status) {
    case "done":
      return "✓";
    case "blocked":
      return "!";
    case "in_progress":
      return "•";
    default:
      return "○";
  }
}

function checklistSummary(
  checklist: GoalState["checklist"] | undefined,
): { total: number; done: number; focus?: string } | null {
  if (!checklist || checklist.length === 0) return null;
  const done = checklist.filter((item) => item.status === "done").length;
  const focus =
    checklist.find((item) => item.status === "in_progress") ??
    checklist.find((item) => item.status === "blocked") ??
    checklist.find((item) => item.status === "pending") ??
    checklist[checklist.length - 1];
  return { total: checklist.length, done, focus: focus?.text };
}

export function GoalActionCard({
  sessionId,
  onEdit,
}: {
  sessionId: string;
  onEdit: (objective: string) => void;
}) {
  const { t } = useTranslation("chat");
  const status = useSupervisorStore((s) => s.bySession[sessionId]?.status ?? null);
  const triggerRecords = useSupervisorStore(
    (s) => s.bySession[sessionId]?.triggerRecords ?? EMPTY_TRIGGER_RECORDS,
  );
  const clearGoal = useSupervisorStore((s) => s.clearGoal);
  const openStatusPanel = useLayoutStore((s) => s.openStatusPanel);
  const [now, setNow] = useState(() => Date.now());
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const goal = status?.goal as GoalWithLegacyFields | undefined;
  const lastGoldResult =
    goal && status?.lastGoldResult?.goalId === goal.id ? status.lastGoldResult : undefined;
  const goalStatus = goal ? getGoalStatus(goal) : "running";
  const tone = goal ? getGoalTone(goalStatus) : null;
  const Icon = tone?.icon ?? Target;

  useEffect(() => {
    if (!goal || goalStatus === "complete" || goalStatus === "cancelled") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [goal, goalStatus]);

  if (!goal) return null;

  const startedAt = getGoalStartedAt(goal);
  const endedAt =
    goalStatus === "complete" || goalStatus === "cancelled" ? getGoalEndedAt(goal, now) : now;
  const elapsed = formatElapsed(endedAt - startedAt);
  const summary = goldSummary(lastGoldResult);
  const isLive = goalStatus === "running" || goalStatus === "checking";
  const triggerCount = triggerRecords.filter((record) => record.goalId === goal.id).length;
  const checkCount = Math.max(goal.continuationCount ?? 0, triggerCount, lastGoldResult ? 1 : 0);
  const checkSummary = checklistSummary(goal.checklist);

  const openGoalPanel = (event?: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    openStatusPanel("supervisor");
  };

  const handleClearGoal = (event?: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    void clearGoal(sessionId, "user_cancelled");
  };

  return (
    <div className="px-3 py-1.5 flex-shrink-0">
      {/* Mobile view — compact single row */}
      <div
        className={`sm:hidden flex items-center gap-1 px-2 py-1.5 rounded-lg border min-h-11 ${tone?.className ?? "border-border-secondary bg-surface-dim"}`}
      >
        <button
          type="button"
          onClick={() => onEdit(goal.objective)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <Icon
            className={`w-4 h-4 shrink-0 ${tone?.iconClassName ?? "text-text-tertiary"} ${isLive ? "animate-pulse" : ""}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-text-tertiary truncate">
              {t(`goal.state.${goalStatus}`)} · {elapsed} · #{checkCount}
              {checkSummary ? ` · ${checkSummary.done}/${checkSummary.total}` : ""}
            </span>
            <span className="block text-xs text-text-secondary truncate">{goal.objective}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={openGoalPanel}
          className="w-11 h-11 -my-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors flex items-center justify-center shrink-0"
          title={t("goal.openPanel")}
          aria-label={t("goal.openPanel")}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleClearGoal}
          className="w-11 h-11 -my-1.5 -mr-2 rounded-md text-text-tertiary hover:text-status-error hover:bg-status-error/10 transition-colors flex items-center justify-center shrink-0"
          title={t("goal.cancel")}
          aria-label={t("goal.cancel")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Desktop view */}
      <div
        className={`hidden sm:flex items-start gap-2 p-2.5 rounded-lg border ${tone?.className ?? "border-border-secondary bg-surface-dim"}`}
      >
        <Icon
          className={`w-4 h-4 mt-0.5 shrink-0 ${tone?.iconClassName ?? "text-text-tertiary"} ${isLive ? "animate-pulse" : ""}`}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium text-text-primary">{t("goal.cardTitle")}</span>
            <span className="text-[11px] text-text-tertiary">
              {t(`goal.state.${goalStatus}`)} · {elapsed} · #{checkCount}
            </span>
            <button
              type="button"
              onClick={() => setDetailsExpanded((v) => !v)}
              className="inline-flex items-center gap-0.5 text-[11px] text-semantic-accent hover:underline"
              aria-expanded={detailsExpanded}
            >
              {detailsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              <span>{detailsExpanded ? t("collapse") : t("expand")}</span>
            </button>
          </div>
          <div
            className={`text-xs text-text-secondary break-words whitespace-pre-wrap ${
              detailsExpanded ? "max-h-32 overflow-y-auto" : "line-clamp-2"
            }`}
          >
            {goal.objective}
          </div>
          {goal.checklist && goal.checklist.length > 0 && (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                <ListChecks className="w-3 h-3" />
                <span>{t("goal.checklist")}</span>
                {checkSummary && (
                  <span className="text-text-secondary">
                    {checkSummary.done}/{checkSummary.total}
                  </span>
                )}
              </div>
              {detailsExpanded ? (
                <div className="grid gap-0.5">
                  {goal.checklist.map((item) => (
                    <div key={item.id} className="flex items-start gap-1.5 text-[11px] text-text-secondary">
                      <span className={`mt-px w-3 shrink-0 text-center ${checklistStatusClass(item.status)}`}>
                        {checklistMarker(item.status)}
                      </span>
                      <span className="break-words">{item.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                checkSummary?.focus && (
                  <div className="flex items-start gap-1.5 text-[11px] text-text-secondary">
                    <span className="mt-px w-3 shrink-0 text-center text-text-tertiary">·</span>
                    <span className="line-clamp-1 break-words">{checkSummary.focus}</span>
                  </div>
                )
              )}
            </div>
          )}
          {detailsExpanded && summary && (
            <div className="text-[11px] text-text-tertiary break-words line-clamp-1">
              {t("goal.lastGold")}: {summary}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onEdit(goal.objective)}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
            title={t("goal.edit")}
            aria-label={t("goal.edit")}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={openGoalPanel}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
            title={t("goal.openPanel")}
            aria-label={t("goal.openPanel")}
          >
            <ListChecks className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClearGoal}
            className="p-1.5 rounded-md text-text-tertiary hover:text-status-error hover:bg-status-error/10 transition-colors"
            title={t("goal.cancel")}
            aria-label={t("goal.cancel")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

import {
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  Loader2,
  Pencil,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GoalState, GoldResult } from "../../../shared/modules/supervisor";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useStatusStore } from "../../stores/use-status-store";
import { useSupervisorStore } from "../../stores/use-supervisor-store";

type GoalCardState = GoalState["status"];
type GoalWithLegacyFields = GoalState & {
  state?: GoalCardState;
  createdAt?: number;
  completedAt?: number;
};

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

export function GoalActionCard({
  sessionId,
  onEdit,
}: {
  sessionId: string;
  onEdit: (objective: string) => void;
}) {
  const { t } = useTranslation("chat");
  const status = useSupervisorStore((s) => s.bySession[sessionId]?.status ?? null);
  const clearGoal = useSupervisorStore((s) => s.clearGoal);
  const openStatusPanel = useLayoutStore((s) => s.openStatusPanel);
  const expandStatusSection = useStatusStore((s) => s.expandSection);
  const [now, setNow] = useState(() => Date.now());

  const goal = status?.goal as GoalWithLegacyFields | undefined;
  const lastGoldResult = status?.lastGoldResult;
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

  const openGoalPanel = () => {
    openStatusPanel("status");
    expandStatusSection("supervisor");
  };

  return (
    <div className="px-3 py-1.5 flex-shrink-0">
      <div
        className={`sm:hidden flex items-center gap-2 px-2 py-1.5 rounded-lg border min-h-11 ${tone?.className ?? "border-border-secondary bg-surface-dim"}`}
      >
        <Icon
          className={`w-4 h-4 shrink-0 ${tone?.iconClassName ?? "text-text-tertiary"} ${isLive ? "animate-pulse" : ""}`}
        />
        <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
          <span className="text-xs font-medium text-text-primary shrink-0">
            {t("goal.cardTitle")}
          </span>
          <span className="text-[11px] text-text-tertiary shrink-0">
            {t(`goal.state.${goalStatus}`)} · {elapsed}
          </span>
          <span className="text-xs text-text-secondary truncate min-w-0">{goal.objective}</span>
        </div>
        <button
          type="button"
          onClick={() => void clearGoal(sessionId, "user_cancelled")}
          className="w-11 h-11 -my-1.5 -mr-1.5 rounded-md text-text-tertiary hover:text-status-error hover:bg-status-error/10 transition-colors flex items-center justify-center shrink-0"
          title={t("goal.cancel")}
          aria-label={t("goal.cancel")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
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
              {t(`goal.state.${goalStatus}`)} · {elapsed}
            </span>
          </div>
          <div className="text-xs text-text-secondary break-words max-h-9 overflow-hidden">
            {goal.objective}
          </div>
          {summary && (
            <div className="text-[11px] text-text-tertiary break-words max-h-5 overflow-hidden">
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
            onClick={() => void clearGoal(sessionId, "user_cancelled")}
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

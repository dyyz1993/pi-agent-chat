import { AlertTriangle, CheckCircle2, ClipboardList, Eye, Loader2, Pencil, Target, X } from "lucide-react";
import { useMemo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { GoalVendorStatus, GoalVendorTaskItem } from "../../../shared/modules/goal";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useGoalStore } from "../../stores/use-goal-store";
import { CardPrimitive, type CardTone } from "../primitives/CardPrimitive";

interface GoalVendorActionCardProps {
  sessionId: string | null;
  onEdit: (objective?: string) => void;
  onCancel?: (sessionId: string) => void;
}

const HIDDEN_RAW_STATUSES = new Set(["none", "cancelled"]);

function shouldShowGoalCard(status: GoalVendorStatus | null | undefined): status is GoalVendorStatus {
  return !!status?.goalId && !!status.objective?.trim() && !HIDDEN_RAW_STATUSES.has(status.rawStatus);
}

function getStateLabel(t: (key: string) => string, status: GoalVendorStatus): string {
  if (status.interrupt?.pendingAuthorityAmendment) return t("goal.state.awaiting_authority");
  if (status.rawStatus === "completed") return t("goal.state.complete");
  if (status.rawStatus === "awaiting_approval") return t("goal.state.needs_user");

  const keyByState: Record<GoalVendorStatus["state"], string> = {
    idle: "goal.state.idle",
    setup: "goal.state.setup",
    running: "goal.state.running",
    checking: "goal.state.checking",
    paused: "goal.state.paused",
    blocked: "goal.state.blocked",
    disabled: "goal.state.disabled",
  };
  const label = t(keyByState[status.state]);
  return label === keyByState[status.state] ? status.state : label;
}

function getTone(status: GoalVendorStatus): {
  tone: CardTone;
  icon: string;
  text: string;
  Icon: typeof Target;
} {
  if (status.interrupt?.pendingAuthorityAmendment) {
    return { tone: "warning", icon: "text-status-warning", text: "text-status-warning", Icon: AlertTriangle };
  }
  if (status.state === "blocked" || status.rawStatus === "interrupted") {
    return { tone: "error", icon: "text-status-error", text: "text-status-error", Icon: AlertTriangle };
  }
  if (status.rawStatus === "completed") {
    return { tone: "success", icon: "text-status-success", text: "text-status-success", Icon: CheckCircle2 };
  }
  if (status.state === "checking" || status.state === "setup" || status.rawStatus === "awaiting_approval") {
    return { tone: "warning", icon: "text-status-warning", text: "text-status-warning", Icon: Loader2 };
  }
  return { tone: "accent", icon: "text-accent", text: "text-accent", Icon: Target };
}

function summarizeTasks(tasks: GoalVendorTaskItem[]) {
  const total = tasks.length;
  const met = tasks.filter((task) => task.status === "met").length;
  const focus = tasks.find((task) => task.status !== "met") ?? tasks[0] ?? null;
  return { total, met, focus };
}

export function GoalVendorActionCard({ sessionId, onEdit, onCancel }: GoalVendorActionCardProps) {
  const { t } = useTranslation("chat");
  const openStatusPanel = useLayoutStore((s) => s.openStatusPanel);
  const sessionState = useGoalStore((s) => (sessionId ? s.bySession[sessionId] : undefined));
  const status = sessionState?.status;
  const tasks = sessionState?.taskReports ?? [];
  const taskSummary = useMemo(() => summarizeTasks(tasks), [tasks]);

  if (!shouldShowGoalCard(status)) return null;

  const tone = getTone(status);
  const Icon = tone.Icon;
  const isSpinning = status.state === "checking" || status.state === "setup";
  const objective = (status.objective ?? "").trim();
  const stateLabel = getStateLabel(t, status);
  const generationLabel = status.generation ? `#${status.generation}` : null;
  const pendingAuthority = status.interrupt?.pendingAuthorityAmendment;
  const authorityLabels = pendingAuthority?.authorities.map((authority) => authority.label).join(" · ");
  const progressLabel =
    taskSummary.total > 0
      ? t("goal.checklistProgress", { met: taskSummary.met, total: taskSummary.total })
      : null;

  const handleOpenPanel = () => openStatusPanel("goal");
  const handleEdit = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onEdit(objective);
  };
  const handleCancel = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (sessionId) onCancel?.(sessionId);
  };

  return (
    <CardPrimitive
      tone={tone.tone}
      data-testid="goal-vendor-action-card"
      className="mx-2 mb-2 px-2.5 py-2 transition-colors hover:bg-surface-hover/70 sm:mx-0"
      aria-label={t("goal.activeCardLabel")}
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          onClick={handleOpenPanel}
          className="mt-0.5 shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-accent"
          title={t("goal.openPanel")}
          aria-label={t("goal.openPanel")}
        >
          <Icon className={`h-4 w-4 ${tone.icon} ${isSpinning ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={handleOpenPanel}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4">
            <span className={`font-semibold ${tone.text}`}>{t("goal.cardTitle")}</span>
            <span className="text-text-secondary">{stateLabel}</span>
            {generationLabel && <span className="text-text-tertiary">{generationLabel}</span>}
            {progressLabel && (
              <span className="inline-flex items-center gap-1 text-text-tertiary">
                <ClipboardList className="h-3 w-3" />
                {progressLabel}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs font-medium leading-5 text-text-primary sm:text-[13px]">
            {objective}
          </div>
          {pendingAuthority && (
            <div className="mt-0.5 truncate text-[11px] leading-4 text-status-warning">
              {t("goal.pendingAuthoritySummary", {
                count: pendingAuthority.authorities.length,
                details: authorityLabels,
              })}
            </div>
          )}
          {!pendingAuthority && taskSummary.focus && (
            <div className="mt-0.5 truncate text-[11px] leading-4 text-text-tertiary">
              {taskSummary.focus.label}
            </div>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleOpenPanel}
            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-accent"
            title={t("goal.openPanel")}
            aria-label={t("goal.openPanel")}
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleEdit}
            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-accent"
            title={t("goal.edit")}
            aria-label={t("goal.edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-status-error"
              title={t("goal.quickCancel")}
              aria-label={t("goal.quickCancel")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </CardPrimitive>
  );
}

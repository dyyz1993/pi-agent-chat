import { useState } from "react";
import { AlertTriangle, Play, Square, CheckCircle, XCircle, Target, Zap, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGoalStore } from "../../stores/use-goal-store";
import { useEffectiveSessionId } from "../../hooks/use-effective-session-id";
import type { GoalVendorTaskItem } from "../../../shared/modules/goal";

const STATE_LABELS: Record<string, { labelKey: string; color: string }> = {
  idle: { labelKey: "goal.state.idle", color: "text-status-success" },
  setup: { labelKey: "goal.state.setup", color: "text-status-info" },
  running: { labelKey: "goal.state.running", color: "text-status-info" },
  checking: { labelKey: "goal.state.checking", color: "text-status-warning" },
  paused: { labelKey: "goal.state.paused", color: "text-status-warning" },
  blocked: { labelKey: "goal.state.blocked", color: "text-status-error" },
  disabled: { labelKey: "goal.state.disabled", color: "text-text-tertiary" },
};

function formatAuthorityCommand(authority: { command?: { executable: string; argsPrefix: string[]; trailingArgs: string } }): string | null {
  if (!authority.command) return null;
  const suffix = authority.command.trailingArgs === "none" ? "" : ` <${authority.command.trailingArgs}>`;
  return [authority.command.executable, ...authority.command.argsPrefix, suffix].filter(Boolean).join(" ");
}

export function GoalPanel() {
  const { t } = useTranslation("chat");
  const sessionId = useEffectiveSessionId();
  const sessionState = useGoalStore((s) => (sessionId ? s.bySession[sessionId] : null));
  const startSetup = useGoalStore((s) => s.startSetup);
  const approveContract = useGoalStore((s) => s.approveContract);
  const approveAuthorityAmendment = useGoalStore((s) => s.approveAuthorityAmendment);
  const rejectContract = useGoalStore((s) => s.rejectContract);
  const clearGoal = useGoalStore((s) => s.clearGoal);
  const forceContinue = useGoalStore((s) => s.forceContinue);
  const enable = useGoalStore((s) => s.enable);
  const disable = useGoalStore((s) => s.disable);

  const [objectiveInput, setObjectiveInput] = useState("");
  const [busy, setBusy] = useState(false);

  if (!sessionId) {
    return <div className="p-3 text-sm text-text-tertiary">{t("goal.panel.noActiveSession")}</div>;
  }

  const status = sessionState?.status;
  const stateInfo = status
    ? (STATE_LABELS[status.state] ?? { labelKey: status.state, color: "text-text-secondary" })
    : null;
  const stateLabel = stateInfo ? t(stateInfo.labelKey) : "";
  const isSettingUp = status?.rawStatus === "setting_up" || status?.rawStatus === "awaiting_approval";
  const pendingAuthorityAmendment = status?.interrupt?.pendingAuthorityAmendment;
  const hasActiveGoal = status && status.rawStatus !== "none" && status.rawStatus !== "completed" && status.rawStatus !== "cancelled";

  const handleStartSetup = async () => {
    if (!objectiveInput.trim()) return;
    setBusy(true);
    try {
      await startSetup(sessionId, objectiveInput.trim());
      setObjectiveInput("");
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    setBusy(true);
    try {
      await approveContract(sessionId);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    setBusy(true);
    try {
      await rejectContract(sessionId, "rejected from panel");
    } finally {
      setBusy(false);
    }
  };

  const handleApproveAuthorityAmendment = async () => {
    setBusy(true);
    try {
      await approveAuthorityAmendment(sessionId);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      await clearGoal(sessionId, "cleared from panel");
    } finally {
      setBusy(false);
    }
  };

  const handleForceContinue = async () => {
    setBusy(true);
    try {
      await forceContinue(sessionId, "forced from panel");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEnabled = async () => {
    setBusy(true);
    try {
      if (status?.enabled) {
        await disable(sessionId);
      } else {
        await enable(sessionId);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-status-info" />
        <span className="text-sm font-medium">{t("goal.panel.title")}</span>
        {status && (
          <button
            type="button"
            onClick={handleToggleEnabled}
            disabled={busy}
            className={`ml-auto rounded px-2 py-0.5 text-xs ${status.enabled ? "bg-status-success/20 text-status-success" : "bg-text-tertiary/20 text-text-tertiary"}`}
          >
            {status.enabled ? t("goal.panel.enabled") : t("goal.panel.disabled")}
          </button>
        )}
      </div>

      {/* Status badge */}
      {status && stateInfo && (
        <div className="flex items-center gap-2 text-sm">
          <span className={`font-medium ${stateInfo.color}`}>{stateLabel}</span>
          <span className="text-xs text-text-tertiary">{status.rawStatus} / {status.rawPhase}</span>
        </div>
      )}

      {/* Objective */}
      {status?.objective && (
        <div className="rounded-md border border-border-primary bg-bg-secondary p-2">
          <div className="text-xs text-text-tertiary mb-1">{t("goal.panel.objective")}</div>
          <div className="text-sm text-text-primary whitespace-pre-wrap">{status.objective}</div>
        </div>
      )}

      {/* Interruption / approval needed */}
      {status?.interrupt && (
        <div className="rounded-md border border-status-warning/35 bg-status-warning/10 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-status-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            {pendingAuthorityAmendment ? t("goal.panel.awaitingAuthority") : status.interrupt.class}
          </div>
          <div className="space-y-1 text-xs leading-5 text-text-secondary">
            <div>{status.interrupt.need}</div>
            <div className="text-text-tertiary">{status.interrupt.recommendation}</div>
          </div>
          {pendingAuthorityAmendment && (
            <div className="mt-2 space-y-1.5">
              {pendingAuthorityAmendment.authorities.map((authority) => {
                const command = formatAuthorityCommand(authority);
                return (
                  <div
                    key={authority.id}
                    className="rounded border border-border-primary/70 bg-bg-secondary/70 px-2 py-1.5"
                  >
                    <div className="text-xs font-medium text-text-primary">{authority.label}</div>
                    {command && <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">{command}</div>}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={handleApproveAuthorityAmendment}
                disabled={busy}
                className="mt-1 flex w-full items-center justify-center gap-1 rounded-md bg-status-warning/20 px-3 py-1.5 text-sm text-status-warning hover:bg-status-warning/30 disabled:opacity-50"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {t("goal.panel.approveAuthorities")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Contract approval (when awaiting_approval) */}
      {isSettingUp && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleApprove}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-status-success/20 px-3 py-1.5 text-sm text-status-success hover:bg-status-success/30"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            {t("goal.panel.approveContract")}
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-status-error/20 px-3 py-1.5 text-sm text-status-error hover:bg-status-error/30"
          >
            <XCircle className="h-3.5 w-3.5" />
            {t("goal.panel.reject")}
          </button>
        </div>
      )}

      {/* Start setup input */}
      {!hasActiveGoal && (
        <div className="flex flex-col gap-2">
          <textarea
            value={objectiveInput}
            onChange={(e) => setObjectiveInput(e.target.value)}
            placeholder={t("goal.panel.objectivePlaceholder")}
            rows={3}
            className="w-full resize-none rounded-md border border-border-primary bg-bg-secondary p-2 text-sm text-text-primary placeholder:text-text-tertiary"
          />
          <button
            type="button"
            onClick={handleStartSetup}
            disabled={busy || !objectiveInput.trim()}
            className="flex items-center justify-center gap-1 rounded-md bg-status-info/20 px-3 py-1.5 text-sm text-status-info hover:bg-status-info/30 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {t("goal.panel.startGoal")}
          </button>
        </div>
      )}

      {/* Active goal controls */}
      {hasActiveGoal && !isSettingUp && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleForceContinue}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-status-info/20 px-3 py-1.5 text-sm text-status-info hover:bg-status-info/30"
          >
            <Zap className="h-3.5 w-3.5" />
            {t("goal.panel.forceContinue")}
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-status-error/20 px-3 py-1.5 text-sm text-status-error hover:bg-status-error/30"
          >
            <Square className="h-3.5 w-3.5" />
            {t("goal.panel.cancelGoal")}
          </button>
        </div>
      )}

      {/* Task report */}
      {sessionState && sessionState.taskReports.length > 0 && (
        <div>
          <div className="text-xs text-text-tertiary mb-1">{t("goal.panel.acceptanceCriteria")}</div>
          <div className="flex flex-col gap-1">
            {sessionState.taskReports.map((task: GoalVendorTaskItem) => (
              <div key={task.id} className="flex items-center gap-2 text-sm">
                <span className={task.status === "met" ? "text-status-success" : "text-text-tertiary"}>
                  {task.status === "met" ? "✓" : "○"}
                </span>
                <span className="text-text-primary">{task.label}</span>
                {task.hasEvidence && <span className="text-xs text-status-success">{t("goal.panel.hasEvidence")}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trigger history */}
      {sessionState && sessionState.triggerRecords.length > 0 && (
        <div>
          <div className="text-xs text-text-tertiary mb-1">{t("goal.panel.eventHistory")}</div>
          <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
            {sessionState.triggerRecords.slice(-20).reverse().map((record) => (
              <div key={record.seq} className="text-xs text-text-tertiary">
                <span className="text-text-secondary">{record.eventType}</span>
                {" — "}
                {record.summary}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Telemetry */}
      {status && hasActiveGoal && (
        <div className="mt-auto flex gap-4 text-xs text-text-tertiary">
          <span>{t("goal.panel.continuation")}: {status.continuationSequence}</span>
          <span>{t("goal.panel.turns")}: {status.turnCount}</span>
          {status.generation && <span>{t("goal.panel.version")}: {status.generation}</span>}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { AlertTriangle, Play, Square, Target, Zap } from "lucide-react";
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
  const clearGoal = useGoalStore((s) => s.clearGoal);
  const forceContinue = useGoalStore((s) => s.forceContinue);
  const enable = useGoalStore((s) => s.enable);
  const disable = useGoalStore((s) => s.disable);
  const approveContract = useGoalStore((s) => s.approveContract);
  const rejectContract = useGoalStore((s) => s.rejectContract);
  const refineContract = useGoalStore((s) => s.refineContract);
  const getPendingContract = useGoalStore((s) => s.getPendingContract);

  const [objectiveInput, setObjectiveInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingContract, setPendingContract] = useState<{
    objective?: string;
    criteria?: Array<Record<string, unknown>>;
    plan?: Array<{ id: string; title: string; status: string; criterionIds?: string[] }>;
    verificationChecks?: Array<Record<string, unknown>>;
    authorities?: Array<Record<string, unknown>>;
    constraints?: string[];
    nonGoals?: string[];
  } | null>(null);
  const [contractLoading, setContractLoading] = useState(false);

  // 拉取待审批契约
  const isAwaitingApprovalNow = sessionState?.status?.rawStatus === "awaiting_approval";
  useEffect(() => {
    if (!sessionId || !isAwaitingApprovalNow) {
      setPendingContract(null);
      return;
    }
    setContractLoading(true);
    getPendingContract(sessionId)
      .then((r) => setPendingContract(r.hasPending ? r : null))
      .catch(() => setPendingContract(null))
      .finally(() => setContractLoading(false));
  }, [sessionId, isAwaitingApprovalNow]);

  const handleApprove = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await approveContract(sessionId);
      setPendingContract(null);
    } finally {
      setBusy(false);
    }
  };
  const handleRefine = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await refineContract(sessionId);
      setPendingContract(null);
    } finally {
      setBusy(false);
    }
  };
  const handleReject = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await rejectContract(sessionId, "rejected from panel");
      setPendingContract(null);
    } finally {
      setBusy(false);
    }
  };

  if (!sessionId) {
    return <div className="p-3 text-sm text-text-tertiary">{t("goal.panel.noActiveSession")}</div>;
  }

  const status = sessionState?.status;
  const isAwaitingApproval = status?.rawStatus === "awaiting_approval";
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
            </div>
          )}
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

      {/* Contract approval card */}
      {isAwaitingApproval && (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/5 p-3 space-y-2">
          <div className="text-xs font-semibold text-status-warning">
            契约等待审批
          </div>
          {contractLoading ? (
            <div className="text-xs text-text-tertiary">加载中…</div>
          ) : pendingContract ? (
            <>
              {pendingContract.objective && (
                <div className="text-xs text-text-secondary">{pendingContract.objective}</div>
              )}
              {!!pendingContract.criteria?.length && (
                <div>
                  <div className="text-[11px] text-text-tertiary mb-0.5">{t("goal.panel.acceptanceCriteria")}</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {pendingContract.criteria.map((ac) => {
                      const label = String((ac as { label?: string }).label ?? (ac as { description?: string }).description ?? JSON.stringify(ac).slice(0, 60));
                      return (
                        <li key={String((ac as { id?: string }).id ?? label)} className="text-[11px] text-text-secondary">
                          {label}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {!!pendingContract.authorities?.length && (
                <div>
                  <div className="text-[11px] text-text-tertiary mb-0.5">{t("goal.panel.requestedAuthorities", "申请的权限")}</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {pendingContract.authorities.map((a) => {
                      const au = a as { id?: string; label?: string; toolName?: string };
                      return (
                        <li key={au.id ?? au.label ?? ""} className="text-[11px] text-text-secondary">
                          {au.label ?? au.id} {au.toolName ? `(${au.toolName})` : ""}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={busy}
                  className="rounded-md bg-status-success/20 px-3 py-1.5 text-xs text-status-success hover:bg-status-success/30 disabled:opacity-50"
                >
                  批准
                </button>
                <button
                  type="button"
                  onClick={handleRefine}
                  disabled={busy}
                  className="rounded-md bg-status-info/20 px-3 py-1.5 text-xs text-status-info hover:bg-status-info/30 disabled:opacity-50"
                >
                  修改
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={busy}
                  className="rounded-md bg-status-error/20 px-3 py-1.5 text-xs text-status-error hover:bg-status-error/30 disabled:opacity-50"
                >
                  拒绝
                </button>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-text-tertiary">加载中…</div>
          )}
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

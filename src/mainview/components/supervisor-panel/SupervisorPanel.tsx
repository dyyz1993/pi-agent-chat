import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { Play, Pause, ShieldCheck } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type {
  GoalState,
  SupervisorStatus,
  TaskReport,
  TriggerRecord,
} from "../../../shared/modules/supervisor";
import { useSessionStore } from "../../stores/use-session-store";
import { useSupervisorStore } from "../../stores/use-supervisor-store";

const STATE_STYLES: Record<string, string> = {
  idle: "bg-status-success/20 text-status-success",
  checking: "bg-status-info/20 text-status-info",
  paused: "bg-status-warning/20 text-status-warning",
  continuing: "bg-status-info/20 text-status-info",
  disabled: "bg-text-tertiary/20 text-text-tertiary",
};

const KNOWN_GUARD_KEYS: Record<string, string> = {
  "incomplete-keywords": "incompleteKeywords",
};
const EMPTY_TASK_REPORTS: TaskReport[] = [];
const EMPTY_TRIGGER_RECORDS: TriggerRecord[] = [];

function getGuardLabel(t: TFunction<"status">, guardName: string): string {
  const key = KNOWN_GUARD_KEYS[guardName];
  if (!key) return guardName;
  return t(`supervisor.guard.${key}.label`);
}

function getGuardDescription(t: TFunction<"status">, guardName: string): string {
  const key = KNOWN_GUARD_KEYS[guardName];
  if (!key) return guardName;
  return t(`supervisor.guard.${key}.description`);
}

function getGuardExecutionLabel(t: TFunction<"status">, guardType: string): string {
  switch (guardType) {
    case "keyword":
      return t("supervisor.guardExecution.keyword");
    case "todo":
      return t("supervisor.guardExecution.channel");
    case "specs":
    case "custom":
      return t("supervisor.guardExecution.model");
    case "ci":
      return t("supervisor.guardExecution.placeholder");
    default:
      return guardType;
  }
}

function getChecklistStatusClass(
  status: NonNullable<GoalState["checklist"]>[number]["status"],
): string {
  switch (status) {
    case "done":
      return "border-status-success/30 bg-status-success/10 text-status-success";
    case "blocked":
      return "border-status-warning/30 bg-status-warning/10 text-status-warning";
    case "in_progress":
      return "border-semantic-accent/30 bg-semantic-accent/10 text-semantic-accent";
    default:
      return "border-border-primary bg-bg-elevated text-text-tertiary";
  }
}

function getChecklistStatusLabel(
  t: TFunction<"status">,
  status: NonNullable<GoalState["checklist"]>[number]["status"],
): string {
  return t(`supervisor.goal.checklist.status.${status}`);
}

export function SupervisorPanel() {
  const { t } = useTranslation("status");
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const sessionState = useSupervisorStore(
    (s) => (sessionId ? s.bySession[sessionId] : null) ?? null,
  );
  const enable = useSupervisorStore((s) => s.enable);
  const disable = useSupervisorStore((s) => s.disable);
  const forceContinue = useSupervisorStore((s) => s.forceContinue);
  const requestPause = useSupervisorStore((s) => s.requestPause);
  const cancelPause = useSupervisorStore((s) => s.cancelPause);
  const fetchTriggerHistory = useSupervisorStore((s) => s.fetchTriggerHistory);

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      <div className="shrink-0 border-b border-border-primary px-3 py-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-semantic-accent" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary">
              {t("supervisor.panelTitle")}
            </div>
            <div className="text-[11px] text-text-tertiary">{t("supervisor.panelSubtitle")}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <SupervisorPanelContent
          status={sessionState?.status ?? null}
          taskReports={sessionState?.taskReports ?? EMPTY_TASK_REPORTS}
          triggerRecords={sessionState?.triggerRecords ?? EMPTY_TRIGGER_RECORDS}
          sessionId={sessionId}
          enable={enable}
          disable={disable}
          forceContinue={forceContinue}
          requestPause={requestPause}
          cancelPause={cancelPause}
          fetchTriggerHistory={fetchTriggerHistory}
        />
      </div>
    </div>
  );
}

interface SupervisorPanelContentProps {
  status: SupervisorStatus | null;
  taskReports: TaskReport[];
  triggerRecords: TriggerRecord[];
  sessionId: string | null;
  enable: (sessionId: string) => Promise<void>;
  disable: (sessionId: string) => Promise<void>;
  forceContinue: (sessionId: string, reason?: string) => Promise<void>;
  requestPause: (sessionId: string, delayMs?: number, reason?: string) => Promise<void>;
  cancelPause: (sessionId: string) => Promise<void>;
  fetchTriggerHistory: (
    sessionId: string,
    limit?: number,
    options?: { force?: boolean },
  ) => Promise<void>;
}

function SupervisorPanelContent({
  status,
  taskReports,
  triggerRecords,
  sessionId,
  enable,
  disable,
  forceContinue,
  requestPause,
  cancelPause,
  fetchTriggerHistory,
}: SupervisorPanelContentProps) {
  const { t } = useTranslation("status");
  const [loading, setLoading] = useState(false);

  const handleEnable = useCallback(
    (sid: string) => {
      setLoading(true);
      enable(sid).finally(() => setLoading(false));
    },
    [enable],
  );

  const handleDisable = useCallback(
    (sid: string) => {
      setLoading(true);
      disable(sid).finally(() => setLoading(false));
    },
    [disable],
  );

  if (!sessionId) {
    return (
      <div className="rounded-md border border-border-primary bg-bg-elevated px-3 py-3 text-sm text-text-tertiary">
        {t("supervisor.noSession")}
      </div>
    );
  }

  if (!status) {
    return (
      <div className="space-y-3">
        <DisabledIntro />
        <button
          onClick={() => handleEnable(sessionId)}
          disabled={loading}
          className="w-full rounded-md bg-status-success/15 px-3 py-2 text-sm font-medium text-status-success hover:bg-status-success/20 disabled:opacity-50"
        >
          {loading ? "..." : t("supervisor.action.enable")}
        </button>
      </div>
    );
  }

  const stateLabel = t(`supervisor.state.${status.state}`) ?? status.state;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border-primary bg-bg-elevated px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] text-text-tertiary">{t("supervisor.runtimeState")}</div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_STYLES[status.state] ?? "bg-text-tertiary/20 text-text-tertiary"}`}
              >
                {stateLabel}
              </span>
              <span
                className={
                  status.enabled ? "text-xs text-status-success" : "text-xs text-text-tertiary"
                }
              >
                {status.enabled ? t("supervisor.enabled") : t("supervisor.disabled")}
              </span>
            </div>
          </div>
          <button
            onClick={() => (status.enabled ? handleDisable(sessionId) : handleEnable(sessionId))}
            disabled={loading}
            className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
              status.enabled
                ? "bg-status-error/15 text-status-error hover:bg-status-error/20"
                : "bg-status-success/15 text-status-success hover:bg-status-success/20"
            }`}
          >
            {loading
              ? "..."
              : status.enabled
                ? t("supervisor.action.disable")
                : t("supervisor.action.enable")}
          </button>
        </div>
        <div className="mt-2 text-[11px] text-text-tertiary">
          {t("supervisor.sessionScopedHint")}
        </div>
        <div className="mt-2 text-xs text-text-tertiary">
          {t("supervisor.continueCount")}: {status.continueCount}/{status.maxContinueCount}
        </div>
      </div>

      {status.goal && (
        <div className="rounded-md border border-status-info/25 bg-status-info/10 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-status-info">{t("supervisor.goal")}</span>
            <span className="text-[11px] text-text-tertiary">
              {t(`supervisor.goal.state.${status.goal.status}`)}
            </span>
          </div>
          <div className="mt-1 break-words text-sm text-text-secondary">
            {status.goal.objective}
          </div>
          {status.goal.checklist && status.goal.checklist.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="text-[11px] font-medium text-text-tertiary">
                {t("supervisor.goal.checklist")}
              </div>
              {status.goal.checklist.map((item, index) => (
                <div
                  key={item.id}
                  className={`rounded border px-2 py-1.5 text-xs ${getChecklistStatusClass(item.status)}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words">
                      {index + 1}. {item.text}
                    </span>
                    <span className="shrink-0 text-[10px]">
                      {getChecklistStatusLabel(t, item.status)}
                    </span>
                  </div>
                  {item.evidence && (
                    <div className="mt-1 text-[11px] opacity-80">{item.evidence}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <PanelSection title={t("supervisor.goldRecords")}>
        {status.lastGoldResult ? (
          <div className="rounded-md border border-border-primary bg-bg-elevated px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-secondary">
                {t("supervisor.gold")}
              </span>
              <span
                className={`text-xs ${
                  status.lastGoldResult.verdict === "complete"
                    ? "text-status-success"
                    : status.lastGoldResult.verdict === "incomplete"
                      ? "text-status-warning"
                      : "text-status-error"
                }`}
              >
                {t(`supervisor.gold.verdict.${status.lastGoldResult.verdict}`)}
              </span>
            </div>
            <div className="mt-1 break-words text-xs text-text-tertiary">
              {status.lastGoldResult.reason}
            </div>
            {status.lastGoldResult.evidence.length > 0 && (
              <div className="mt-1 text-[11px] text-text-tertiary">
                {t("supervisor.gold.evidenceCount", {
                  count: status.lastGoldResult.evidence.length,
                })}
              </div>
            )}
          </div>
        ) : (
          <EmptyBox>{t("supervisor.gold.empty")}</EmptyBox>
        )}
      </PanelSection>

      <PanelSection
        title={t("supervisor.triggerHistory")}
        action={
          <button
            type="button"
            className="text-[11px] text-semantic-accent hover:underline"
            onClick={() => fetchTriggerHistory(sessionId, 50, { force: true })}
          >
            {t("supervisor.triggerHistory.refresh")}
          </button>
        }
      >
        {triggerRecords.length > 0 ? (
          <div className="space-y-1.5">
            {[...triggerRecords].reverse().map((rec) => (
              <div
                key={rec.seq}
                className="rounded-md border border-border-primary bg-bg-elevated px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text-secondary">#{rec.seq}</span>
                  <div className="flex items-center gap-1.5">
                    {rec.durationMs != null && (
                      <span className="text-[11px] text-text-tertiary">
                        {(rec.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    <span
                      className={`text-xs font-medium ${
                        rec.verdict === "complete"
                          ? "text-status-success"
                          : rec.verdict === "incomplete"
                            ? "text-status-warning"
                            : "text-status-error"
                      }`}
                    >
                      {t(`supervisor.trigger.verdict.${rec.verdict}`)}
                    </span>
                    <span className="text-[11px] text-text-tertiary">
                      {Math.round(rec.confidence * 100)}%
                    </span>
                  </div>
                </div>
                {rec.reason && (
                  <div className="mt-1 break-words text-[11px] text-text-tertiary">
                    {rec.reason}
                  </div>
                )}
                {rec.guardResults.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {rec.guardResults.map((g, i) => (
                      <span
                        key={i}
                        title={`${getGuardDescription(t, g.guardName)} · ${getGuardExecutionLabel(t, g.guardType)}`}
                        className={`rounded px-1.5 py-px text-[10px] ${
                          g.passed
                            ? "bg-status-success/15 text-status-success"
                            : "bg-status-error/15 text-status-error"
                        }`}
                      >
                        {getGuardLabel(t, g.guardName)} · {getGuardExecutionLabel(t, g.guardType)}
                      </span>
                    ))}
                  </div>
                )}
                {rec.modelCheck && (
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    {t("supervisor.trigger.modelCheck")}: {rec.modelCheck.passed ? "✓" : "✗"} (
                    {((rec.modelCheck.durationMs ?? 0) / 1000).toFixed(1)}s)
                    {rec.modelCheck.model
                      ? ` · ${t("supervisor.trigger.model")}: ${rec.modelCheck.model}`
                      : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyBox>{t("supervisor.triggerHistory.empty")}</EmptyBox>
        )}
      </PanelSection>

      {status.activeGuards.length > 0 && (
        <PanelSection title={t("supervisor.activeGuards")}>
          <div className="flex flex-wrap gap-1">
            {status.activeGuards.map((g) => (
              <span
                key={g}
                title={getGuardDescription(t, g)}
                className="rounded bg-semantic-tool/15 px-1.5 py-0.5 text-[11px] text-semantic-tool"
              >
                {getGuardLabel(t, g)}
              </span>
            ))}
          </div>
        </PanelSection>
      )}

      {taskReports.length > 0 && (
        <PanelSection title={t("supervisor.taskReport")}>
          <div className="space-y-1">
            {taskReports.map((tr) => (
              <div key={tr.guardName} className="flex items-center gap-1.5 text-xs">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    tr.status === "completed"
                      ? "bg-status-success"
                      : tr.status === "error"
                        ? "bg-status-error"
                        : tr.status === "incomplete"
                          ? "bg-status-warning"
                          : "bg-text-tertiary"
                  }`}
                />
                <span
                  className="truncate text-text-tertiary"
                  title={getGuardDescription(t, tr.guardName)}
                >
                  {getGuardLabel(t, tr.guardName)}
                </span>
                <span className="shrink-0 text-[11px] text-text-tertiary">{tr.status}</span>
              </div>
            ))}
          </div>
        </PanelSection>
      )}

      {status.enabled && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => forceContinue(sessionId)}
            className="flex items-center gap-1 rounded-md bg-status-info/15 px-2 py-1 text-xs text-status-info"
          >
            <Play className="h-3 w-3" />
            {t("supervisor.forceContinue")}
          </button>
          {status.pendingPause ? (
            <button
              onClick={() => cancelPause(sessionId)}
              className="rounded-md bg-status-warning/15 px-2 py-1 text-xs text-status-warning"
            >
              {t("supervisor.cancelPause")}
            </button>
          ) : (
            <button
              onClick={() => requestPause(sessionId, 5000)}
              className="flex items-center gap-1 rounded-md bg-status-warning/15 px-2 py-1 text-xs text-status-warning"
            >
              <Pause className="h-3 w-3" />
              {t("supervisor.pause")}
            </button>
          )}
        </div>
      )}

      {status.pendingPause && (
        <div className="text-[11px] text-status-warning/80">
          {t("supervisor.pause")}:{" "}
          {Math.ceil((status.pendingPause.scheduledAt - Date.now()) / 1000)}s
          {status.pendingPause.reason ? ` - ${status.pendingPause.reason}` : ""}
        </div>
      )}
    </div>
  );
}

function DisabledIntro() {
  const { t } = useTranslation("status");
  return (
    <div className="rounded-md border border-border-primary bg-bg-elevated px-3 py-3">
      <div className="text-sm font-medium text-text-primary">
        {t("supervisor.disabledByDefault")}
      </div>
      <div className="mt-1 text-xs leading-5 text-text-tertiary">
        {t("supervisor.disabledByDefaultDesc")}
      </div>
    </div>
  );
}

function PanelSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border-primary/60 bg-bg-elevated px-3 py-2 text-xs text-text-tertiary">
      {children}
    </div>
  );
}

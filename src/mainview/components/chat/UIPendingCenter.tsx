import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  MessageCircleQuestion,
  ArrowRight,
  CheckSquare,
  Square,
  Send,
  ChevronDown,
  ChevronRight,
  FileEdit,
  ShieldAlert,
  Clock,
  Terminal,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useUIDialogStore, type UIPendingRequest } from "../../stores/use-ui-dialog-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useStatusStore } from "../../stores/use-status-store";
import { AnchoredPopover, IconButton } from "../primitives";
import {
  PermissionActionButtons,
  findOneTimePermissionActionValue,
} from "./PermissionActionButtons";
import { AskUserQuestionCard } from "./tool-renderers/UICardRenderer";
import { jumpToSessionById } from "./primitives/useJumpToSession";

type ApprovalRisk = "Low" | "Medium" | "High";

interface ApprovalSummaryRow {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
  mono?: boolean;
}

function firstStringValue(
  value: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function isHighRiskCommand(command: string | undefined): boolean {
  if (!command) return false;
  return /\b(rm\s+-rf|sudo|chmod\s+-R|chown\s+-R|dd\s+if=|mkfs|curl\b.*\|\s*(sh|bash)|wget\b.*\|\s*(sh|bash)|--no-verify)\b/i.test(
    command,
  );
}

function approvalRisk(req: UIPendingRequest): ApprovalRisk | null {
  const meta = req.permissionMeta;
  if (meta?.type === "path_boundary") {
    return meta.scope === "write" ? "High" : "Medium";
  }
  if (meta?.type === "dangerous_bash") return "High";
  if (meta?.type === "hook_approval") return "Medium";
  if (meta?.type === "permission_runtime") {
    const command = firstStringValue(meta.metadata, ["command", "cmd", "script"]);
    if (
      /danger|unsafe|destructive|sudo|path-access/i.test(meta.provider) ||
      isHighRiskCommand(command)
    ) {
      return "High";
    }
    if (/write|delete|remove|command|bash|shell/i.test(`${meta.provider} ${meta.subject}`)) {
      return "Medium";
    }
    return "Low";
  }
  if (meta?.type === "goal_approval") return "High";
  if (req.hookMeta?.command) {
    return isHighRiskCommand(req.hookMeta.command) ? "High" : "Medium";
  }
  return null;
}

function AutoDenyHint({ timeout }: { timeout?: number }) {
  const { t } = useTranslation("chat");
  if (timeout == null || timeout <= 0) return null;
  return (
    <div className="flex items-center gap-1 mt-1.5 px-0.5">
      <Clock className="w-3 h-3 text-text-tertiary" />
      <span className="text-[10px] text-text-tertiary">
        {t("uiCard.autoDeny", { seconds: Math.ceil(timeout / 1000) })}
      </span>
    </div>
  );
}

function buildApprovalSummaryRows(
  req: UIPendingRequest,
  sessionName?: string,
): ApprovalSummaryRow[] {
  const rows: ApprovalSummaryRow[] = [];
  const push = (row: ApprovalSummaryRow | null | undefined) => {
    if (row?.value) rows.push(row);
  };

  push({ label: "Session", value: sessionName ?? req.sessionId, mono: !sessionName });

  const meta = req.permissionMeta;
  if (meta?.type === "path_boundary") {
    push({ label: "Tool", value: meta.toolName });
    push({ label: "Operation", value: meta.scope });
    push({ label: "Target", value: meta.path, mono: true });
    push({ label: "Project", value: meta.cwd, mono: true });
    push({ label: "Boundary", value: meta.relativeTo });
  } else if (meta?.type === "permission_runtime") {
    const command = firstStringValue(meta.metadata, ["command", "cmd", "script", "path"]);
    push({ label: "Tool", value: meta.provider });
    push({ label: "Operation", value: meta.subject, mono: true });
    push({ label: "Target", value: command ?? meta.subject, mono: true });
  } else if (meta?.type === "goal_approval") {
    push({ label: "Approval", value: String(meta.kind).replace(/_/g, " ") });
    push({ label: "Goal", value: meta.goalId, mono: true });
    push({ label: "Generation", value: String(meta.generation) });
    push({ label: "Objective", value: meta.objective ?? "" });
  } else if (meta?.type) {
    push({ label: "Tool", value: meta.toolName });
    push({ label: "Operation", value: meta.scope });
    push({ label: "Target", value: meta.path, mono: true });
  } else if (req.hookMeta) {
    push({ label: "Tool", value: req.hookMeta.toolName });
    push({ label: "Operation", value: req.hookMeta.eventName ?? "hook approval" });
  }

  const risk = approvalRisk(req);
  push({
    label: "Risk",
    value: risk ?? "",
    tone: risk === "High" ? "danger" : risk === "Medium" ? "warning" : "default",
  });

  return rows;
}

function requestBelongsToProject(req: UIPendingRequest, projectSessionIds: Set<string>): boolean {
  return (
    projectSessionIds.has(req.sessionId) ||
    (!!req.parentSessionId && projectSessionIds.has(req.parentSessionId))
  );
}

type SessionNameSource = {
  sessionId: string;
  name?: string;
  firstMessage?: string;
  sessionPath?: string;
  parentSessionPath?: string | null;
  delegateType?: string | null;
};

type SubsessionNameSource = {
  sessionId: string;
  sessionPath?: string;
  description?: string;
  instruction?: string;
};

function getSessionDisplayName(session: SessionNameSource): string {
  const name = session.name?.trim();
  if (name) return name;
  const firstMessage = session.firstMessage?.trim();
  if (firstMessage) return firstMessage.slice(0, 30);
  return session.sessionId.slice(0, 8);
}

function getSubsessionDisplayName(sub: SubsessionNameSource): string {
  const description = sub.description?.trim();
  if (description) return description;
  const instruction = sub.instruction?.trim();
  if (instruction) return instruction.slice(0, 30);
  return sub.sessionId.slice(0, 8);
}

function buildSessionNameMap(
  sessionsByProject: Record<string, SessionNameSource[]>,
  subsessionsByParent: Record<string, SubsessionNameSource[]>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const sessions of Object.values(sessionsByProject)) {
    for (const session of sessions) {
      map.set(session.sessionId, getSessionDisplayName(session));
    }
  }
  for (const subsessions of Object.values(subsessionsByParent)) {
    for (const sub of subsessions) {
      map.set(sub.sessionId, getSubsessionDisplayName(sub));
    }
  }
  return map;
}

function buildSubtaskSessionIds(
  sessionsByProject: Record<string, SessionNameSource[]>,
  subsessionsByParent: Record<string, SubsessionNameSource[]>,
): Set<string> {
  const ids = new Set<string>();
  for (const sessions of Object.values(sessionsByProject)) {
    for (const session of sessions) {
      if (session.parentSessionPath || session.delegateType === "subagent") {
        ids.add(session.sessionId);
      }
    }
  }
  for (const subsessions of Object.values(subsessionsByParent)) {
    for (const sub of subsessions) {
      ids.add(sub.sessionId);
    }
  }
  return ids;
}

function collectDescendantSessionIds(
  activeSessionId: string | null,
  sessionsByProject: Record<string, SessionNameSource[]>,
  subsessionsByParent: Record<string, SubsessionNameSource[]>,
): Set<string> {
  const ids = new Set<string>();
  if (!activeSessionId) return ids;

  const pathBySessionId = new Map<string, string>();
  for (const sessions of Object.values(sessionsByProject)) {
    for (const session of sessions) {
      if (session.sessionPath) pathBySessionId.set(session.sessionId, session.sessionPath);
    }
  }
  for (const subsessions of Object.values(subsessionsByParent)) {
    for (const sub of subsessions) {
      if (sub.sessionPath) pathBySessionId.set(sub.sessionId, sub.sessionPath);
    }
  }

  const queue = [activeSessionId];
  while (queue.length > 0) {
    const sessionId = queue.shift();
    if (!sessionId || ids.has(sessionId)) continue;
    ids.add(sessionId);

    const sessionPath = pathBySessionId.get(sessionId);
    if (!sessionPath) continue;
    const children = subsessionsByParent[sessionPath] ?? [];
    for (const child of children) {
      if (!ids.has(child.sessionId)) queue.push(child.sessionId);
    }
  }

  return ids;
}

function requestBelongsToActiveSessionTree(
  req: UIPendingRequest,
  activeSessionId: string | null,
  activeTreeSessionIds: Set<string>,
): boolean {
  if (!activeSessionId) return false;
  return (
    activeTreeSessionIds.has(req.sessionId) ||
    (!!req.parentSessionId && activeTreeSessionIds.has(req.parentSessionId))
  );
}

type BatchApprovalAction = {
  requestId: string;
  allowResponse?: Record<string, unknown>;
  denyResponse?: Record<string, unknown>;
  denyWithDismiss?: boolean;
};

function buildBatchApprovalAction(req: UIPendingRequest): BatchApprovalAction | null {
  if (req.method === "select" && req.permissionMeta) {
    const allowValue = findOneTimePermissionActionValue(req.options, "allow");
    const denyValue = findOneTimePermissionActionValue(req.options, "deny");
    if (!allowValue && !denyValue) return null;
    return {
      requestId: req.requestId,
      allowResponse: allowValue ? { value: allowValue } : undefined,
      denyResponse: denyValue ? { value: denyValue } : undefined,
    };
  }

  if (req.method === "confirm" && req.hookMeta) {
    return {
      requestId: req.requestId,
      allowResponse: { confirmed: true },
      denyWithDismiss: true,
    };
  }

  return null;
}

function ApprovalContextSummary({
  req,
  sessionName,
}: {
  req: UIPendingRequest;
  sessionName?: string;
}) {
  const rows = buildApprovalSummaryRows(req, sessionName);
  if (rows.length <= 1) return null;

  return (
    <div className="mb-2.5 grid gap-1.5 rounded-md border border-status-warning/25 bg-bg-primary/70 px-2.5 py-2">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
          <span className="text-[10px] font-medium text-text-tertiary">{row.label}</span>
          <span
            className={`min-w-0 truncate text-[11px] ${row.mono ? "font-mono" : "font-medium"} ${
              row.tone === "danger"
                ? "text-status-error"
                : row.tone === "warning"
                  ? "text-status-warning"
                  : "text-text-primary"
            }`}
            title={row.value}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function BatchApprovalToolbar({ requests }: { requests: UIPendingRequest[] }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);

  const actions = useMemo(
    () => requests.map(buildBatchApprovalAction).filter(Boolean) as BatchApprovalAction[],
    [requests],
  );
  const allowActions = actions.filter((action) => action.allowResponse);
  const denyActions = actions.filter(
    (action) => action.denyResponse != null || action.denyWithDismiss === true,
  );

  if (allowActions.length === 0 && denyActions.length === 0) return null;

  const handleBatch = (intent: "allow" | "deny") => {
    const targetActions = intent === "allow" ? allowActions : denyActions;
    for (const action of targetActions) {
      if (intent === "allow" && action.allowResponse) {
        respondById(action.requestId, action.allowResponse);
      } else if (intent === "deny" && action.denyResponse) {
        respondById(action.requestId, action.denyResponse);
      } else if (intent === "deny" && action.denyWithDismiss) {
        dismissById(action.requestId);
      }
    }
  };

  return (
    <div className="border-b border-border-secondary bg-status-warning/5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[11px] text-text-secondary">
          {t("uiPending.batchApprovalsHint", { count: actions.length })}
        </span>
        <button
          type="button"
          disabled={allowActions.length === 0}
          onClick={() => handleBatch("allow")}
          className="rounded-md border border-status-success/30 bg-status-success/12 px-2.5 py-1 text-[11px] font-medium text-status-success transition-colors hover:bg-status-success/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("uiPending.batchAllowOnce", { count: allowActions.length })}
        </button>
        <button
          type="button"
          disabled={denyActions.length === 0}
          onClick={() => handleBatch("deny")}
          className="rounded-md border border-status-error/30 bg-status-error/10 px-2.5 py-1 text-[11px] font-medium text-status-error transition-colors hover:bg-status-error/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("uiPending.batchDenyOnce", { count: denyActions.length })}
        </button>
      </div>
    </div>
  );
}

function SourceContextHeader({
  sessionName,
  isSubtaskSource,
}: {
  sessionName?: string;
  isSubtaskSource?: boolean;
}) {
  const { t } = useTranslation("chat");
  if (!sessionName) return null;

  return (
    <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-border-secondary/35 bg-bg-primary/55 px-2 py-1.5 text-[10px] text-text-tertiary">
      <span className="shrink-0 font-medium">{t("uiPending.fromSession")}</span>
      <span
        className="min-w-0 flex-1 truncate font-semibold text-text-secondary"
        title={sessionName}
      >
        {sessionName}
      </span>
      {isSubtaskSource && (
        <span className="shrink-0 rounded bg-semantic-agent/10 px-1.5 py-0.5 font-medium text-semantic-agent">
          {t("uiPending.subtaskSource")}
        </span>
      )}
    </div>
  );
}

function PanelCard({
  req,
  sessionName,
  showSourceContext = false,
  isSubtaskSource = false,
}: {
  req: UIPendingRequest;
  sessionName?: string;
  showSourceContext?: boolean;
  isSubtaskSource?: boolean;
}) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);

  // All hooks must be called unconditionally (React rules of hooks)
  const [checkedSet, setCheckedSet] = useState<Set<number>>(new Set());
  const [customValue, setCustomValue] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [editorValue, setEditorValue] = useState(req.prefill ?? "");

  const methodLabel: Record<string, string> = {
    askUserQuestion: t("uiPending.askUserQuestion", "询问"),
    confirm: t("uiPending.confirm"),
    select: t("uiPending.select"),
    input: t("uiPending.inputLabel"),
    editor: t("uiPending.editor"),
  };

  const isSelect = req.method === "select";
  const isConfirm = req.method === "confirm";
  const isInput = req.method === "input";
  const isEditor = req.method === "editor";
  const isAskUserQuestion = req.method === "askUserQuestion";
  const options = req.options ?? [];
  const isMulti = !!req.multiple;
  const withSourceContext = (content: ReactNode) =>
    showSourceContext ? (
      <div>
        <SourceContextHeader sessionName={sessionName} isSubtaskSource={isSubtaskSource} />
        {content}
      </div>
    ) : (
      content
    );

  if (isAskUserQuestion) {
    return withSourceContext(
      <AskUserQuestionCard
        block={{
          type: "uiInteraction",
          id: req.requestId,
          method: req.method,
          status: "pending",
          title: req.title,
          message: req.message,
          questions: req.questions,
          sessionId: req.sessionId,
          permissionMeta: req.permissionMeta,
          timeout: req.timeout,
        }}
      />,
    );
  }

  if (isSelect && req.permissionMeta?.type === "path_boundary") {
    const meta = req.permissionMeta;
    const scopePattern = `${meta.path.split("/").slice(0, -1).join("/") || "/"}/\u2217\u2217`;
    const rememberScope: "project" | "session" = useStatusStore.getState().projectTrust?.trusted
      ? "project"
      : "session";
    const rememberOptions = [
      {
        id: "path-boundary-scope",
        label: "Path scope",
        subject: "file.write",
        pattern: scopePattern,
        scope: rememberScope,
        action: "allow" as const,
      },
    ];
    return (
      <div className="overflow-hidden rounded-lg border border-status-warning/30 bg-surface-dim/50 dark:bg-surface-code/50">
        <div className="flex items-center gap-1.5 border-b border-border-secondary/50 px-3 py-2">
          <ShieldAlert className="w-3.5 h-3.5 text-status-warning" />
          <span className="text-xs font-semibold text-status-warning">Path Access</span>
        </div>
        <div className="px-3 py-2">
          <ApprovalContextSummary req={req} sessionName={sessionName} />
          <PermissionActionButtons
            options={options}
            rememberOptions={rememberOptions}
            onSelect={(value) => respondById(req.requestId, { value })}
          />
          <AutoDenyHint timeout={req.timeout} />
        </div>
      </div>
    );
  }

  if (isSelect && req.permissionMeta?.type === "permission_runtime") {
    const meta = req.permissionMeta;
    return (
      <div className="rounded-md border border-border-secondary/60 bg-bg-primary/60 px-3 py-2 dark:bg-surface-code/45">
        <div className="mb-1.5 flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-status-warning" />
          <span className="min-w-0 truncate text-[11px] font-semibold text-status-warning">
            {req.title ?? "Permission Request"}
          </span>
        </div>
        {req.message && (
          <p className="mb-2 text-[11px] leading-relaxed text-text-secondary">{req.message}</p>
        )}
        <ApprovalContextSummary req={req} sessionName={sessionName} />
        <PermissionActionButtons
          options={options}
          rememberOptions={meta.rememberOptions}
          onSelect={(value) => respondById(req.requestId, { value })}
        />
      </div>
    );
  }

  if (isMulti || isSelect) {
    return (
      <div className="border border-border-secondary/40 rounded-xl overflow-hidden bg-surface-dim/50 dark:bg-surface-code/50">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-secondary/50">
          <span
            className={`text-[11px] font-medium ${req.method === "select" ? "text-status-info" : "text-status-success"}`}
          >
            {methodLabel[req.method] ?? req.method}
          </span>
          <span className="text-[10px] text-text-tertiary ml-auto">{req.title}</span>
        </div>
        <div className="px-3 py-2">
          {req.message && (
            <p className="text-[11px] text-text-secondary mb-2 leading-relaxed">{req.message}</p>
          )}
          <div className="space-y-0.5 mb-2">
            {options.map((opt, i) => {
              const descParts = opt.split(" ");
              const label = descParts[0] ?? opt;
              const desc = descParts.slice(1).join(" ");
              const checked = checkedSet.has(i);
              return (
                <button
                  key={i}
                  onClick={() =>
                    setCheckedSet((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors ${
                    checked
                      ? "bg-status-info/15 text-status-info"
                      : "hover:bg-surface-dim dark:hover:bg-surface-dim text-text-tertiary"
                  }`}
                >
                  {checked ? (
                    <CheckSquare className="w-3.5 h-3.5 shrink-0 text-status-info" />
                  ) : (
                    <Square className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px]">{label}</div>
                    {desc && <div className="text-[10px] text-text-tertiary">{desc}</div>}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 px-1 mt-2">
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder={req.placeholder ?? t("uiCard.customAnswer")}
              className="flex-1 bg-surface-code dark:bg-surface-dim border border-border-secondary rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-tertiary dark:placeholder:text-text-tertiary focus:outline-none focus:border-status-warning/50"
              onKeyDown={(e) =>
                e.key === "Enter" &&
                customValue.trim() &&
                respondById(req.requestId, { value: customValue.trim() })
              }
            />
            <button
              onClick={() => {
                if (checkedSet.size > 0)
                  respondById(req.requestId, {
                    value: Array.from(checkedSet).map((i) => options[i]),
                  });
                else if (customValue.trim())
                  respondById(req.requestId, { value: customValue.trim() });
              }}
              disabled={checkedSet.size === 0 && !customValue.trim()}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-status-warning/20 text-status-warning hover:bg-status-warning/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
            >
              <Send className="w-3 h-3" /> {t("uiPending.confirm")}
            </button>
            <button
              onClick={() => dismissById(req.requestId)}
              className="flex items-center justify-center px-3 py-1.5 rounded-md bg-surface-hover/30 text-text-tertiary hover:bg-border-secondary/50 dark:hover:bg-border-secondary/50 text-[11px] transition-colors"
            >
              {t("common:dismiss")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isConfirm) {
    const isHookConfirm = !!req.hookMeta;
    const confirmText = req.confirmText ?? req.hookMeta?.confirmText;
    const cancelText = req.cancelText ?? req.hookMeta?.cancelText;

    return (
      <div className="border border-border-secondary/40 rounded-xl overflow-hidden bg-surface-dim/50 dark:bg-surface-code/50">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-secondary/60">
          <span className="text-[11px] font-medium text-status-success">{methodLabel.confirm}</span>
          <span className="text-[10px] text-text-tertiary ml-auto">{req.title}</span>
        </div>
        <div className="px-3 py-2">
          {req.message && (
            <p className="text-[11px] text-text-secondary mb-2.5 leading-relaxed">{req.message}</p>
          )}
          <ApprovalContextSummary req={req} sessionName={sessionName} />
          {isHookConfirm &&
            req.hookMeta?.command &&
            req.hookMeta?.toolName === "bash" &&
            req.hookMeta?.description && (
              <div className="mb-2.5 space-y-1.5 rounded-md border border-status-warning/25 bg-bg-primary/70 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-status-warning">
                  <Terminal className="h-3 w-3" />
                  Command
                </div>
                <code className="block text-[11px] text-text-primary font-mono break-all leading-relaxed">
                  <span className="text-text-tertiary">$ </span>
                  {req.hookMeta.command}
                </code>
                <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 border-t border-border-secondary/35 pt-1.5">
                  <span className="text-[10px] text-text-tertiary">说明</span>
                  <span className="text-[11px] leading-relaxed text-text-secondary">
                    {req.hookMeta.description}
                  </span>
                  {req.hookMeta.matcher && (
                    <>
                      <span className="text-[10px] text-text-tertiary">Matcher</span>
                      <code className="break-all font-mono text-[10px] text-text-secondary">
                        {req.hookMeta.matcher}
                      </code>
                    </>
                  )}
                </div>
              </div>
            )}
          {isHookConfirm &&
            req.hookMeta?.command &&
            !(req.hookMeta?.toolName === "bash" && req.hookMeta?.description) && (
              <div className="mb-2.5 space-y-1.5 rounded-md border border-status-warning/25 bg-bg-primary/70 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-status-warning">
                  <Terminal className="h-3 w-3" />
                  Command
                </div>
                <code className="block break-all font-mono text-[11px] leading-relaxed text-text-primary">
                  <span className="text-text-tertiary">$ </span>
                  {req.hookMeta.command}
                </code>
                {req.hookMeta.matcher && (
                  <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 border-t border-border-secondary/35 pt-1.5">
                    <span className="text-[10px] text-text-tertiary">Matcher</span>
                    <code className="break-all font-mono text-[10px] text-text-secondary">
                      {req.hookMeta.matcher}
                    </code>
                  </div>
                )}
              </div>
            )}
          {isHookConfirm && req.hookMeta?.hookCommand && (
            <div className="mb-2.5 rounded-md bg-surface-dim/60 border border-border-secondary/40 px-2 py-1.5">
              <div className="text-[10px] text-text-tertiary mb-0.5">
                Hook 规则
                {req.hookMeta.eventName ? ` · ${req.hookMeta.eventName}` : ""}
                {req.hookMeta.source ? ` · ${req.hookMeta.source}` : ""}
              </div>
              <code className="block text-[10px] text-text-secondary font-mono break-all leading-relaxed">
                {req.hookMeta.hookCommand}
              </code>
            </div>
          )}
          {isHookConfirm && <AutoDenyHint timeout={req.timeout} />}
          <div className="flex gap-2">
            <button
              onClick={() => respondById(req.requestId, { confirmed: true })}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-status-success/20 text-status-success hover:bg-status-success/30 text-[11px] transition-colors"
            >
              {confirmText ?? (isHookConfirm ? t("uiCard.allowOnce") : t("uiPending.confirm"))}
            </button>
            <button
              onClick={() => dismissById(req.requestId)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-status-error/15 text-status-error hover:bg-status-error/25 text-[11px] transition-colors"
            >
              {cancelText ?? t("common:cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isInput) {
    return (
      <div className="border border-border-secondary/40 rounded-xl overflow-hidden bg-surface-dim/50 dark:bg-surface-code/50">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-secondary/60">
          <span className="text-[11px] font-medium text-status-warning">{methodLabel.input}</span>
          <span className="text-[10px] text-text-tertiary ml-auto">{req.title}</span>
        </div>
        <div className="px-3 py-2">
          {req.message && (
            <p className="text-[11px] text-text-secondary mb-2.5 leading-relaxed">{req.message}</p>
          )}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={req.placeholder ?? t("uiCard.pleaseInput")}
            className="w-full bg-surface-code dark:bg-surface-dim border border-border-secondary rounded px-2.5 py-1.5 text-[11px] text-text-primary placeholder:text-text-tertiary dark:placeholder:text-text-tertiary focus:outline-none focus:border-status-warning/50"
            onKeyDown={(e) =>
              e.key === "Enter" && respondById(req.requestId, { value: inputValue })
            }
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => respondById(req.requestId, { value: inputValue })}
              disabled={!inputValue.trim()}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-status-warning/20 text-status-warning hover:bg-status-warning/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
            >
              <Send className="w-3 h-3" /> {t("uiPending.confirm")}
            </button>
            <button
              onClick={() => dismissById(req.requestId)}
              className="flex items-center justify-center px-3 py-1.5 rounded-md bg-surface-hover/30 text-text-tertiary hover:bg-border-secondary/50 dark:hover:bg-border-secondary/50 text-[11px] transition-colors"
            >
              {t("common:dismiss")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isEditor) {
    return (
      <div className="border border-border-secondary/40 rounded-xl overflow-hidden bg-surface-dim/50 dark:bg-surface-code/50">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-secondary/60">
          <FileEdit className="w-3 h-3 text-status-info" />
          <span className="text-[11px] font-medium text-status-info">{methodLabel.editor}</span>
          <span className="text-[10px] text-text-tertiary ml-auto">{req.title}</span>
        </div>
        <div className="px-3 py-2">
          {req.message && (
            <p className="text-[11px] text-text-secondary mb-2 leading-relaxed">{req.message}</p>
          )}
          <textarea
            value={editorValue}
            onChange={(e) => setEditorValue(e.target.value)}
            placeholder={req.placeholder ?? t("uiCard.pleaseInput")}
            className="w-full bg-surface-code dark:bg-surface-dim border border-border-secondary rounded px-2.5 py-1.5 text-[11px] text-text-primary placeholder:text-text-tertiary dark:placeholder:text-text-tertiary focus:outline-none focus:border-status-info/50 font-mono resize-y"
            rows={Math.min(Math.max(editorValue.split("\n").length, 3), 8)}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => respondById(req.requestId, { value: editorValue })}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-status-info/20 text-status-info hover:bg-status-info/30 text-[11px] transition-colors"
            >
              <Send className="w-3 h-3" /> {t("uiPending.confirm")}
            </button>
            <button
              onClick={() => dismissById(req.requestId)}
              className="flex items-center justify-center px-3 py-1.5 rounded-md bg-surface-hover/30 text-text-tertiary hover:bg-border-secondary/50 dark:hover:bg-border-secondary/50 text-[11px] transition-colors"
            >
              {t("common:dismiss")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

interface SessionGroupProps {
  sessionId: string;
  sessionName: string;
  isSubtaskSource: boolean;
  requests: UIPendingRequest[];
  onGotoSession: (sessionId: string, requestId: string) => void;
}

function SessionGroup({
  sessionId,
  sessionName,
  isSubtaskSource,
  requests,
  onGotoSession,
}: SessionGroupProps) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(true);

  const methodLabel: Record<string, string> = {
    askUserQuestion: t("uiPending.askUserQuestion", "询问"),
    confirm: t("uiPending.confirm"),
    select: t("uiPending.select"),
    input: t("uiPending.inputLabel"),
    editor: t("uiPending.editor"),
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border-secondary/40">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 bg-surface-hover/20 px-3 py-2 transition-colors hover:bg-surface-hover/30"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        )}
        <span className="flex-1 truncate text-left text-xs font-semibold text-text-primary">
          {sessionName}
        </span>
        {isSubtaskSource && (
          <span
            className="max-w-[6rem] shrink-0 truncate rounded bg-semantic-agent/10 px-1.5 py-0.5 text-[10px] font-medium text-semantic-agent"
            title={sessionName}
          >
            ↳ {t("uiPending.subtaskSource")}
          </span>
        )}
        <span className="shrink-0 rounded-full bg-status-warning/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-status-warning">
          {requests.length}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 px-2.5 pb-2.5 pt-1.5">
          {requests.map((req) => (
            <div key={req.requestId} className="relative">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-status-warning/80">
                  {methodLabel[req.method] ?? req.method}
                </span>
                {req.title && (
                  <span className="text-[10px] text-text-tertiary truncate">{req.title}</span>
                )}
                <button
                  onClick={() => onGotoSession(sessionId, req.requestId)}
                  className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent/10"
                  title={t("uiPending.gotoSession")}
                >
                  {t("uiPending.gotoSession")}
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <PanelCard
                req={req}
                sessionName={sessionName}
                showSourceContext
                isSubtaskSource={isSubtaskSource}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UIPendingCenter() {
  const { t } = useTranslation("chat");
  const anchorRef = useRef<HTMLDivElement>(null);
  const allPending = useUIDialogStore((s) => s.pending);
  const panelOpen = useUIDialogStore((s) => s.panelOpen);
  const setPanelOpen = useUIDialogStore((s) => s.setPanelOpen);
  const togglePanel = useUIDialogStore((s) => s.togglePanel);

  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const subsessionsByParent = useSubagentStore((s) => s.subsessionsByParent);

  const projectPending = useMemo(() => {
    if (!activeProjectId) return [];
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return [];
    const projectSessions = sessionsByProject[tab.path] ?? [];
    const projectSessionIds = new Set(projectSessions.map((s) => s.sessionId));
    const parentPaths = projectSessions.map((s) => s.sessionPath).filter(Boolean);
    const pendingParentPaths = [...parentPaths];
    const visitedParentPaths = new Set<string>();

    while (pendingParentPaths.length > 0) {
      const parentPath = pendingParentPaths.shift();
      if (!parentPath || visitedParentPaths.has(parentPath)) continue;
      visitedParentPaths.add(parentPath);
      const children = subsessionsByParent[parentPath] ?? [];
      for (const child of children) {
        projectSessionIds.add(child.sessionId);
        if (child.sessionPath) pendingParentPaths.push(child.sessionPath);
      }
    }

    return allPending.filter((req) => requestBelongsToProject(req, projectSessionIds));
  }, [allPending, activeProjectId, projectTabs, sessionsByProject, subsessionsByParent]);

  const pendingCount = projectPending.length;

  // All hooks must be called before any early return (React rules of hooks)
  const sessionNameMap = useMemo(() => {
    if (!activeProjectId) return new Map<string, string>();
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return new Map<string, string>();
    return buildSessionNameMap(
      { [tab.path]: sessionsByProject[tab.path] ?? [] },
      subsessionsByParent,
    );
  }, [activeProjectId, projectTabs, sessionsByProject, subsessionsByParent]);

  const subtaskSessionIds = useMemo(() => {
    if (!activeProjectId) return new Set<string>();
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return new Set<string>();
    return buildSubtaskSessionIds(
      { [tab.path]: sessionsByProject[tab.path] ?? [] },
      subsessionsByParent,
    );
  }, [activeProjectId, projectTabs, sessionsByProject, subsessionsByParent]);

  const grouped = useMemo(() => {
    const groups = new Map<string, UIPendingRequest[]>();
    for (const req of projectPending) {
      const list = groups.get(req.sessionId) ?? [];
      list.push(req);
      groups.set(req.sessionId, list);
    }
    return groups;
  }, [projectPending]);

  useEffect(() => {
    if (!panelOpen || pendingCount > 0) return;
    setPanelOpen(false);
  }, [pendingCount, panelOpen, setPanelOpen]);

  if (!panelOpen && pendingCount === 0) return null;

  const handleGotoSession = (sessionId: string, requestId: string) => {
    setPanelOpen(false);
    void jumpToSessionById(sessionId);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-ui-request-id="${requestId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <div ref={anchorRef} className="relative inline-flex">
      <IconButton
        label={t("uiPending.pendingRequestsCount", { count: pendingCount })}
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          togglePanel();
        }}
        className="relative animate-pulse text-status-warning hover:text-status-warning"
      >
        <MessageCircleQuestion className="w-3.5 h-3.5" />
        {pendingCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[10px] h-[10px] flex items-center justify-center bg-status-warning rounded-full text-[7px] leading-none text-white font-bold px-[2px]">
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </IconButton>

      <AnchoredPopover
        anchorRef={anchorRef}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        placement="bottom"
        align="end"
        offset={8}
        viewportPadding={12}
        minWidth={448}
        maxWidth={448}
        maxHeight={560}
        className="overflow-hidden"
      >
        <div
          role="dialog"
          aria-modal="false"
          data-testid="ui-pending-center-panel"
          data-ui-pending-scope="chat"
          className="max-h-[inherit] overflow-hidden rounded-xl border border-border-secondary bg-surface-code shadow-2xl shadow-black/20 ring-1 ring-border-primary/30 dark:bg-surface-dim"
        >
          <div className="flex items-center gap-2 border-b border-border-secondary px-3 py-2">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-text-primary">
              <span>{t("uiPending.pendingRequestsTitle")}</span>
              <span className="px-1.5 py-0.5 rounded-full bg-status-warning/15 text-status-warning text-[11px] font-medium tabular-nums">
                {pendingCount}
              </span>
            </span>
            <IconButton
              label={t("common:close")}
              size="sm"
              onClick={() => setPanelOpen(false)}
              className="h-7 w-7"
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <BatchApprovalToolbar requests={projectPending} />
          <div className="max-h-[min(520px,70dvh)] space-y-2.5 overflow-y-auto px-3 pb-3 pt-2">
            {pendingCount === 0 ? (
              <div className="py-8 text-center text-[11px] text-text-tertiary">
                {t("uiPending.noPendingRequests")}
              </div>
            ) : (
              Array.from(grouped.entries()).map(([sessionId, requests]) => (
                <SessionGroup
                  key={sessionId}
                  sessionId={sessionId}
                  sessionName={sessionNameMap.get(sessionId) ?? sessionId.slice(0, 8)}
                  isSubtaskSource={
                    subtaskSessionIds.has(sessionId) ||
                    requests.some((request) => Boolean(request.parentSessionId))
                  }
                  requests={requests}
                  onGotoSession={handleGotoSession}
                />
              ))
            )}
          </div>
        </div>
      </AnchoredPopover>
    </div>
  );
}

export function ProjectRuntimePendingRequests({
  activeSessionId,
  placement = "inline",
}: {
  activeSessionId: string | null;
  placement?: "inline" | "composerOverlay";
}) {
  const { t } = useTranslation("chat");
  const allPending = useUIDialogStore((s) => s.pending);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject ?? {});
  const subsessionsByParent = useSubagentStore((s) => s.subsessionsByParent ?? {});
  const statusPanel = useLayoutStore((s) => s.statusPanel);
  const statusWidth = useLayoutStore((s) => s.statusWidth);
  const breakpoint = useLayoutStore((s) => s.breakpoint);

  const activeTreeSessionIds = useMemo(
    () => collectDescendantSessionIds(activeSessionId, sessionsByProject, subsessionsByParent),
    [activeSessionId, sessionsByProject, subsessionsByParent],
  );

  const sessionPending = useMemo(() => {
    return allPending.filter((req) =>
      requestBelongsToActiveSessionTree(req, activeSessionId, activeTreeSessionIds),
    );
  }, [allPending, activeSessionId, activeTreeSessionIds]);

  const sessionNameMap = useMemo(
    () => buildSessionNameMap(sessionsByProject, subsessionsByParent),
    [sessionsByProject, subsessionsByParent],
  );

  if (sessionPending.length === 0) return null;

  const methodLabel: Record<string, string> = {
    askUserQuestion: t("uiPending.askUserQuestion", "询问"),
    confirm: t("uiPending.confirm"),
    select: t("uiPending.select"),
    input: t("uiPending.inputLabel"),
    editor: t("uiPending.editor"),
  };

  const [primary, ...secondary] = sessionPending;
  const primarySessionName = sessionNameMap.get(primary.sessionId) ?? primary.sessionId;
  const primaryFromChild = activeSessionId !== null && primary.sessionId !== activeSessionId;
  const shouldAvoidRightOverlay = statusPanel === "visible" && breakpoint !== "mobile";
  const isComposerOverlay = placement === "composerOverlay";
  const rootClassName = isComposerOverlay
    ? "pointer-events-none absolute inset-x-0 bottom-full z-30 px-3 pb-2"
    : "px-3 py-1.5 flex-shrink-0";
  const bodyMaxHeightClassName = isComposerOverlay
    ? "max-h-[min(440px,54dvh)]"
    : "max-h-[min(560px,66vh)]";

  return (
    <div
      className={rootClassName}
      aria-live="polite"
      style={
        shouldAvoidRightOverlay ? { paddingRight: `calc(0.75rem + ${statusWidth}px)` } : undefined
      }
    >
      <div
        data-ui-request-id={primary.requestId}
        data-ui-dock-request-id={primary.requestId}
        data-placement={placement}
        className="pointer-events-auto overflow-hidden rounded-lg border border-status-warning/25 bg-bg-elevated/95 shadow-xl shadow-black/10 ring-1 ring-border-primary/35 backdrop-blur-md dark:bg-surface-dim/95"
      >
        <div className="flex items-center gap-2 border-b border-border-secondary/45 px-2.5 py-1.5">
          <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[11px] font-semibold text-status-warning">
            {t("uiPending.pendingRequestsTitle")}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
            {methodLabel[primary.method] ?? primary.method}
            {primary.title ? ` · ${primary.title}` : ""}
          </span>
          {primaryFromChild && (
            <span
              className="max-w-[9rem] shrink-0 truncate rounded bg-semantic-agent/10 px-1.5 py-0.5 text-[10px] font-medium text-semantic-agent"
              title={primarySessionName}
            >
              ↳ {primarySessionName}
            </span>
          )}
          <span className="shrink-0 rounded-full bg-status-warning/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-status-warning">
            {sessionPending.length}
          </span>
        </div>
        <div className={`${bodyMaxHeightClassName} overflow-y-auto px-2.5 py-2`}>
          <PanelCard req={primary} sessionName={primarySessionName} />
        </div>
        {secondary.length > 0 && (
          <div className="space-y-1 border-t border-border-secondary/50 px-2.5 py-2">
            {secondary.slice(0, 4).map((req) => {
              return (
                <div
                  key={req.requestId}
                  data-ui-request-id={req.requestId}
                  data-ui-dock-request-id={req.requestId}
                  className="flex items-center gap-2 rounded-md bg-surface-hover/30 px-2 py-1.5 text-xs"
                >
                  <span className="shrink-0 text-status-warning">
                    {methodLabel[req.method] ?? req.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text-secondary">
                    {req.title ?? req.message ?? req.requestId}
                  </span>
                  {activeSessionId !== null && req.sessionId !== activeSessionId && (
                    <span
                      className="max-w-[8rem] shrink-0 truncate text-[10px] text-semantic-agent"
                      title={sessionNameMap.get(req.sessionId) ?? req.sessionId}
                    >
                      ↳ {sessionNameMap.get(req.sessionId) ?? req.sessionId}
                    </span>
                  )}
                </div>
              );
            })}
            {secondary.length > 4 && (
              <div className="px-2 pt-0.5 text-[10px] text-text-tertiary">
                {t("uiPending.moreRequests", { count: secondary.length - 4 })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function useProjectPendingCount(): number {
  const allPending = useUIDialogStore((s) => s.pending);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject ?? {});
  const subsessionsByParent = useSubagentStore((s) => s.subsessionsByParent ?? {});

  return useMemo(() => {
    if (!activeProjectId) return 0;
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return 0;
    const projectSessions = sessionsByProject[tab.path] ?? [];
    const projectSessionIds = new Set(projectSessions.map((s) => s.sessionId));
    const pendingParentPaths = projectSessions.map((s) => s.sessionPath).filter(Boolean);
    const visitedParentPaths = new Set<string>();

    while (pendingParentPaths.length > 0) {
      const parentPath = pendingParentPaths.shift();
      if (!parentPath || visitedParentPaths.has(parentPath)) continue;
      visitedParentPaths.add(parentPath);
      const children = subsessionsByParent[parentPath] ?? [];
      for (const child of children) {
        projectSessionIds.add(child.sessionId);
        if (child.sessionPath) pendingParentPaths.push(child.sessionPath);
      }
    }

    return allPending.filter((req) => requestBelongsToProject(req, projectSessionIds)).length;
  }, [allPending, activeProjectId, projectTabs, sessionsByProject, subsessionsByParent]);
}

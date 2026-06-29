import { useEffect, useMemo, useRef, useState } from "react";
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
  FileWarning,
  FolderOpen,
  Clock,
  Eye,
  Pencil,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useUIDialogStore, type UIPendingRequest } from "../../stores/use-ui-dialog-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useStatusStore } from "../../stores/use-status-store";
import { IconButton, ModalDialog } from "../primitives";
import { PermissionActionButtons } from "./PermissionActionButtons";
import { AskUserQuestionCard } from "./tool-renderers/UICardRenderer";

function PanelCard({ req }: { req: UIPendingRequest }) {
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

  if (isAskUserQuestion) {
    return (
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
          timeout: req.timeout,
        }}
      />
    );
  }

  if (isSelect && req.permissionMeta?.type === "path_boundary") {
    const meta = req.permissionMeta;
    const ScopeIcon = meta.scope === "write" ? Pencil : Eye;
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
          <div className="mb-2.5 space-y-1.5 rounded-md border border-border-secondary/40 bg-bg-primary/70 px-2.5 py-2">
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <ScopeIcon className="h-3.5 w-3.5 shrink-0" />
                Tool
              </span>
              <span className="min-w-0 truncate text-xs font-medium capitalize text-text-primary">
                {meta.toolName}
              </span>
            </div>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <FileWarning className="h-3.5 w-3.5 shrink-0" />
                Path
              </span>
              <span
                className="min-w-0 truncate font-mono text-xs text-text-primary"
                title={meta.path}
              >
                {meta.path}
              </span>
            </div>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                Project
              </span>
              <span
                className="min-w-0 truncate font-mono text-xs text-text-secondary"
                title={meta.cwd}
              >
                {meta.cwd}
              </span>
            </div>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-status-warning" />
                Status
              </span>
              <span className="min-w-0 truncate text-xs text-status-warning">
                {meta.relativeTo}
              </span>
            </div>
          </div>
          <PermissionActionButtons
            options={options}
            rememberOptions={rememberOptions}
            onSelect={(value) => respondById(req.requestId, { value })}
          />
          {req.timeout != null && req.timeout > 0 && (
            <div className="flex items-center gap-1 mt-1.5 px-0.5">
              <Clock className="w-3 h-3 text-text-tertiary" />
              <span className="text-[10px] text-text-tertiary">
                {t("uiCard.autoDeny", { seconds: Math.ceil(req.timeout / 1000) })}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isSelect && req.permissionMeta?.type === "permission_runtime") {
    const meta = req.permissionMeta;
    const command =
      typeof meta.metadata?.command === "string"
        ? meta.metadata.command
        : typeof meta.metadata?.path === "string"
          ? meta.metadata.path
          : undefined;
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
        <div className="mb-2 space-y-1 rounded-md border border-border-secondary/40 bg-surface-dim/35 px-2 py-1.5">
          <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-[10px] text-text-tertiary">Provider</span>
            <span className="min-w-0 truncate text-[11px] font-medium text-text-primary">
              {meta.provider}
            </span>
          </div>
          <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-[10px] text-text-tertiary">Subject</span>
            <span className="min-w-0 truncate font-mono text-[11px] text-text-secondary">
              {meta.subject}
            </span>
          </div>
          {command && (
            <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2">
              <span className="text-[10px] text-text-tertiary">Command</span>
              <span
                className="min-w-0 truncate font-mono text-[11px] text-text-primary"
                title={command}
              >
                {command}
              </span>
            </div>
          )}
        </div>
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
  requests: UIPendingRequest[];
  onGotoSession: (sessionId: string, requestId: string) => void;
}

function SessionGroup({ sessionId, sessionName, requests, onGotoSession }: SessionGroupProps) {
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
                  className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-semantic-accent transition-colors hover:bg-semantic-accent/10"
                  title={t("uiPending.gotoSession")}
                >
                  {t("uiPending.gotoSession")}
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <PanelCard req={req} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UIPendingCenter() {
  const { t } = useTranslation("chat");
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

    return allPending.filter((req) => projectSessionIds.has(req.sessionId));
  }, [allPending, activeProjectId, projectTabs, sessionsByProject, subsessionsByParent]);

  const pendingCount = projectPending.length;
  const knownPendingIdsRef = useRef<Set<string>>(new Set());

  // All hooks must be called before any early return (React rules of hooks)
  const sessionNameMap = useMemo(() => {
    if (!activeProjectId) return new Map<string, string>();
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return new Map<string, string>();
    const sessions = sessionsByProject[tab.path] ?? [];
    const map = new Map<string, string>();
    for (const s of sessions) {
      map.set(s.sessionId, s.name || s.firstMessage?.slice(0, 30) || s.sessionId.slice(0, 8));
    }
    return map;
  }, [activeProjectId, projectTabs, sessionsByProject]);

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
    const previousIds = knownPendingIdsRef.current;
    const currentIds = new Set(projectPending.map((req) => req.requestId));
    const hasNewRequest = projectPending.some((req) => !previousIds.has(req.requestId));
    knownPendingIdsRef.current = currentIds;
    if (!panelOpen && hasNewRequest) {
      setPanelOpen(true);
    }
  }, [panelOpen, projectPending, setPanelOpen]);

  useEffect(() => {
    if (!panelOpen || pendingCount > 0) return;
    setPanelOpen(false);
  }, [pendingCount, panelOpen, setPanelOpen]);

  if (!panelOpen && pendingCount === 0) return null;

  const handleGotoSession = (sessionId: string, requestId: string) => {
    setPanelOpen(false);
    useSessionStore.getState().setActiveSession(sessionId);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-ui-request-id="${requestId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <>
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

      {panelOpen && (
        <ModalDialog
          title={
            <span className="flex items-center gap-2">
              <span>{t("uiPending.pendingRequestsTitle")}</span>
              <span className="px-1.5 py-0.5 rounded-full bg-status-warning/15 text-status-warning text-[11px] font-medium tabular-nums">
                {pendingCount}
              </span>
            </span>
          }
          onClose={() => setPanelOpen(false)}
          closeLabel={t("common:close")}
          size="md"
          className="max-w-lg bg-surface-code dark:bg-surface-dim max-h-[min(520px,80vh)]"
          bodyClassName="overflow-y-auto px-3 pb-3 pt-2 space-y-2.5"
        >
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
                requests={requests}
                onGotoSession={handleGotoSession}
              />
            ))
          )}
        </ModalDialog>
      )}
    </>
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
  const statusPanel = useLayoutStore((s) => s.statusPanel);
  const statusWidth = useLayoutStore((s) => s.statusWidth);
  const breakpoint = useLayoutStore((s) => s.breakpoint);

  const sessionPending = useMemo(() => {
    if (!activeSessionId) return [];
    return allPending.filter((req) => req.sessionId === activeSessionId);
  }, [allPending, activeSessionId]);

  if (sessionPending.length === 0) return null;

  const methodLabel: Record<string, string> = {
    askUserQuestion: t("uiPending.askUserQuestion", "询问"),
    confirm: t("uiPending.confirm"),
    select: t("uiPending.select"),
    input: t("uiPending.inputLabel"),
    editor: t("uiPending.editor"),
  };

  const [primary, ...secondary] = sessionPending;
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
          <span className="shrink-0 rounded-full bg-status-warning/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-status-warning">
            {sessionPending.length}
          </span>
        </div>
        <div className={`${bodyMaxHeightClassName} overflow-y-auto px-2.5 py-2`}>
          <PanelCard req={primary} />
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
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const subsessionsByParent = useSubagentStore((s) => s.subsessionsByParent);

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

    return allPending.filter((req) => projectSessionIds.has(req.sessionId)).length;
  }, [allPending, activeProjectId, projectTabs, sessionsByProject, subsessionsByParent]);
}

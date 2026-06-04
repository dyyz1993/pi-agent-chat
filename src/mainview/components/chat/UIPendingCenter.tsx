import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircleQuestion,
  X,
  ArrowRight,
  CheckSquare,
  Square,
  Send,
  ChevronDown,
  ChevronRight,
  FileEdit,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIDialogStore, type UIPendingRequest } from "../../stores/use-ui-dialog-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useFocusTrap } from "../../hooks/use-focus-trap";

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
    confirm: t("uiPending.confirm"),
    select: t("uiPending.select"),
    input: t("uiPending.inputLabel"),
    editor: t("uiPending.editor"),
  };

  const isSelect = req.method === "select";
  const isConfirm = req.method === "confirm";
  const isInput = req.method === "input";
  const isEditor = req.method === "editor";
  const options = req.options ?? [];
  const isMulti = !!req.multiple;

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
          <div className="flex gap-2">
            <button
              onClick={() => respondById(req.requestId, { confirmed: true })}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-status-success/20 text-status-success hover:bg-status-success/30 text-[11px] transition-colors"
            >
              {t("uiPending.confirm")}
            </button>
            <button
              onClick={() => dismissById(req.requestId)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-status-error/15 text-status-error hover:bg-status-error/25 text-[11px] transition-colors"
            >
              {t("common:cancel")}
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
    confirm: t("uiPending.confirm"),
    select: t("uiPending.select"),
    input: t("uiPending.inputLabel"),
    editor: t("uiPending.editor"),
  };

  return (
    <div className="border border-border-secondary/40 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface-hover/20 hover:bg-surface-hover/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        )}
        <span className="text-[12px] font-medium text-text-primary truncate flex-1 text-left">
          {sessionName}
        </span>
        <span className="px-1.5 py-0.5 rounded-full bg-status-warning/15 text-status-warning text-[10px] font-medium tabular-nums shrink-0">
          {requests.length}
        </span>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1.5 space-y-2">
          {requests.map((req) => (
            <div key={req.requestId} className="relative">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-medium text-status-warning/80 bg-status-warning/10 px-1.5 py-0.5 rounded">
                  {methodLabel[req.method] ?? req.method}
                </span>
                {req.title && (
                  <span className="text-[10px] text-text-tertiary truncate">{req.title}</span>
                )}
                <button
                  onClick={() => onGotoSession(sessionId, req.requestId)}
                  className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-semantic-accent hover:bg-semantic-accent/10 transition-colors shrink-0"
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { onEscape: () => setPanelOpen(false) });

  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);

  const projectPending = useMemo(() => {
    if (!activeProjectId) return [];
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return [];
    const projectSessions = sessionsByProject[tab.path] ?? [];
    const projectSessionIds = new Set(projectSessions.map((s) => s.sessionId));
    return allPending.filter((req) => projectSessionIds.has(req.sessionId));
  }, [allPending, activeProjectId, projectTabs, sessionsByProject]);

  const pendingCount = projectPending.length;

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
      <button
        onClick={(e) => {
          e.stopPropagation();
          togglePanel();
        }}
        className="p-1 rounded transition-colors text-status-warning hover:text-status-warning relative animate-pulse"
        title={t("uiPending.pendingRequestsCount", { count: pendingCount })}
      >
        <MessageCircleQuestion className="w-3.5 h-3.5" />
        {pendingCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[10px] h-[10px] flex items-center justify-center bg-status-warning rounded-full text-[7px] leading-none text-white font-bold px-[2px]">
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && setPanelOpen(false)}
        >
          <div
            ref={dialogRef}
            className="w-full max-w-lg bg-surface-code dark:bg-surface-dim border border-border-secondary rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{ maxHeight: "min(520px, 80vh)" }}
            role="dialog"
            aria-modal="true"
            aria-label={t("uiPending.pendingRequestsTitle")}
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-secondary/60 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-text-primary">
                  {t("uiPending.pendingRequestsTitle")}
                </span>
                <span className="px-1.5 py-0.5 rounded-full bg-status-warning/15 text-status-warning text-[11px] font-medium tabular-nums">
                  {pendingCount}
                </span>
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                className="text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary p-1 transition-colors"
                aria-label={t("common:close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-3 pb-3 pt-2 space-y-2.5 flex-1">
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
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function useProjectPendingCount(): number {
  const allPending = useUIDialogStore((s) => s.pending);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);

  return useMemo(() => {
    if (!activeProjectId) return 0;
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return 0;
    const projectSessions = sessionsByProject[tab.path] ?? [];
    const projectSessionIds = new Set(projectSessions.map((s) => s.sessionId));
    return allPending.filter((req) => projectSessionIds.has(req.sessionId)).length;
  }, [allPending, activeProjectId, projectTabs, sessionsByProject]);
}

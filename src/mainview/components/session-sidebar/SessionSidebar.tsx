import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Search,
  ChevronRight,
  ChevronDown,
  Copy,
  Pencil,
  Trash2,
  User,
  Check,
  X,
  Loader2,
  Bot,
  GitBranch,
  Pin,
  PinOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useAgentStore } from "../../stores/use-agent-store";
import { useGitStore } from "../../stores/use-git-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import type { SessionMeta, SubagentSessionInfo } from "../../types";
import { copyToClipboard } from "../../utils/clipboard";
import { ConfirmDialog } from "../explorer/ConfirmDialog";

const EMPTY: never[] = [];

export function groupSessions(
  rawSessions: SessionMeta[],
  searchQuery: string,
): { rootSessions: SessionMeta[]; childMap: Record<string, SessionMeta[]> } {
  const seen = new Set<string>();
  const deduped = rawSessions.filter((sess) => {
    if (seen.has(sess.sessionId)) return false;
    seen.add(sess.sessionId);
    return true;
  });

  const children: Record<string, SessionMeta[]> = {};
  const roots: SessionMeta[] = [];
  const q = searchQuery.trim().toLowerCase();

  for (const sess of deduped) {
    if (sess.parentSessionPath) {
      if (!children[sess.parentSessionPath]) children[sess.parentSessionPath] = [];
      children[sess.parentSessionPath].push(sess);
    } else {
      roots.push(sess);
    }
  }

  const sortPinnedFirst = (s: SessionMeta[]) =>
    [...s].sort((a, b) => {
      const getPriority = (sess: SessionMeta): number => {
        const isRunning =
          sess.status === "running" ||
          sess.sessionStatus === "streaming" ||
          sess.sessionStatus === "compacting" ||
          sess.sessionStatus === "retrying";
        if (isRunning) return 0;
        if (sess.pinned) return 1;
        return 2;
      };
      const priorityA = getPriority(a);
      const priorityB = getPriority(b);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return b.updatedAt - a.updatedAt;
    });

  if (q) {
    const filter = (s: SessionMeta[]) =>
      s.filter(
        (sess) =>
          sess.name?.toLowerCase().includes(q) ||
          sess.firstMessage?.toLowerCase().includes(q) ||
          sess.sessionId.toLowerCase().includes(q),
      );
    const filteredRoots = sortPinnedFirst(filter(roots));
    const filteredChildren: Record<string, SessionMeta[]> = {};
    for (const [parentPath, kids] of Object.entries(children)) {
      const filtered = filter(kids);
      if (filtered.length > 0) filteredChildren[parentPath] = filtered;
      else {
        const parentMatch = roots.find(
          (r) =>
            r.sessionPath === parentPath &&
            (r.name?.toLowerCase().includes(q) || r.firstMessage?.toLowerCase().includes(q)),
        );
        if (parentMatch) filteredChildren[parentPath] = filtered;
      }
    }
    return { rootSessions: filteredRoots, childMap: filteredChildren };
  }

  return { rootSessions: sortPinnedFirst(roots), childMap: children };
}

interface SessionSidebarProps {
  hideOuterHeader?: boolean;
}

export function SessionSidebar(_props: SessionSidebarProps) {
  const { t } = useTranslation("sidebar");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((sessionId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const expandSession = useCallback((sessionId: string) => {
    setExpandedIds((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-surface-code/50 dark:bg-surface-dim/50 rounded text-[11px] text-text-tertiary">
          <Search className="w-3 h-3 shrink-0" />
          <input
            data-testid="session-search"
            placeholder={t("searchSessions")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent outline-none flex-1 min-w-0 placeholder:text-text-tertiary dark:placeholder:text-text-secondary"
          />
        </div>
      </div>

      <SessionList
        searchQuery={searchQuery}
        expandedIds={expandedIds}
        onToggleExpand={toggleExpand}
        onExpandSession={expandSession}
      />
    </div>
  );
}

function SessionList({
  searchQuery,
  expandedIds,
  onToggleExpand,
  onExpandSession,
}: {
  searchQuery: string;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onExpandSession: (id: string) => void;
}) {
  const { t } = useTranslation(["sidebar", "common"]);
  const rawSessions = useSessionStore((s) => {
    const tab = s.projectTabs.find((t) => t.id === s.activeProjectId);
    if (!tab) return EMPTY;
    return s.sessionsByProject[tab.path] || EMPTY;
  });
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const loading = useSessionStore((s) => s.loading);

  const activeSessionPath = useMemo(() => {
    const sess = rawSessions.find((s) => s.sessionId === activeSessionId);
    return sess?.sessionPath ?? null;
  }, [rawSessions, activeSessionId]);

  useEffect(() => {
    if (!activeSessionPath) return;
    useSubagentStore.getState().loadSubsessions(activeSessionPath);
  }, [activeSessionPath]);

  const subsessionsByParent = useSubagentStore((s) => s.subsessionsByParent);
  const autoExpandedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeSessionId) return;
    if (autoExpandedRef.current.has(activeSessionId)) return;
    const sessionPath = rawSessions.find((s) => s.sessionId === activeSessionId)?.sessionPath ?? "";
    const subs = subsessionsByParent[sessionPath];
    if (subs && subs.length > 0) {
      autoExpandedRef.current.add(activeSessionId);
      onExpandSession(activeSessionId);
    }
  }, [subsessionsByParent, activeSessionId, rawSessions, onExpandSession]);

  const { rootSessions, childMap } = useMemo(
    () => groupSessions(rawSessions, searchQuery),
    [rawSessions, searchQuery],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-xs p-4">
        <div className="w-3 h-3 border-2 border-border-secondary border-t-transparent rounded-full animate-spin mr-2" />
        {t("common:loading")}
      </div>
    );
  }

  if (rootSessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-xs p-4 text-center">
        {searchQuery ? t("sidebar:noMatchingSessions") : t("sidebar:noSessions")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-0.5 divide-y divide-border-secondary dark:divide-surface-dim/50">
      {rootSessions.map((sess) => (
        <SessionItem
          key={sess.sessionId}
          session={sess}
          isActive={sess.sessionId === activeSessionId}
          children={childMap[sess.sessionPath]}
          isExpanded={expandedIds.has(sess.sessionId)}
          onToggleExpand={() => onToggleExpand(sess.sessionId)}
        />
      ))}
    </div>
  );
}

function StatusBadge({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation("common");
  const status = useSessionStore((s) => s.sessionStatusMap[sessionId]);

  if (status === "streaming" || status === "compacting") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-warning/15 text-status-warning border border-status-warning/20">
        <span className="w-1 h-1 rounded-full bg-status-warning animate-pulse" />
        {t("working")}
      </span>
    );
  }
  if (status === "permission") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-error/15 text-status-error border border-status-error/20">
        <span className="w-1 h-1 rounded-full bg-status-error" />
        {t("needHelp")}
      </span>
    );
  }
  if (status === "retrying") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-error/15 text-status-error border border-status-error/20">
        <span className="w-1 h-1 rounded-full bg-status-error animate-pulse" />
        {t("retrying")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-success/10 text-status-success/80 border border-status-success/15">
      <span className="w-1 h-1 rounded-full bg-status-success/60" />
      {t("idle")}
    </span>
  );
}

function WorkspaceBadge({
  workspace,
}: {
  workspace: { path: string; branch: string; isMain: boolean };
}) {
  const name = workspace.isMain ? workspace.path.split("/").pop() : workspace.branch;
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-semantic-tool/15 text-semantic-tool border border-semantic-tool/20">
      {!workspace.isMain && <GitBranch className="w-2.5 h-2.5" />}
      {name}
    </span>
  );
}

function SubagentStatusBadge({ sub }: { sub: SubagentSessionInfo }) {
  const { t } = useTranslation("common");
  if (sub.exitCode === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-success/15 text-status-success border border-status-success/20">
        <span className="w-1 h-1 rounded-full bg-status-success" />
        {t("idle")}
      </span>
    );
  }
  if (sub.error || (sub.exitCode !== undefined && sub.exitCode !== 0)) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-error/15 text-status-error border border-status-error/20">
        {t("error")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-warning/15 text-status-warning border border-status-warning/20">
      <span className="w-1 h-1 rounded-full bg-status-warning animate-pulse" />
      {t("running")}
    </span>
  );
}

function SessionItem({
  session,
  isActive,
  children,
  isExpanded,
  onToggleExpand,
}: {
  session: SessionMeta;
  isActive: boolean;
  children?: SessionMeta[];
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const { t } = useTranslation(["sidebar", "common"]);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const renameSession = useSessionStore((s) => s.renameSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const togglePinSession = useSessionStore((s) => s.togglePinSession);
  const subsessions = useSubagentStore((s) => s.subsessionsByParent[session.sessionPath]);
  const loadingSubs = useSubagentStore((s) => s.loadingByParent[session.sessionPath]);
  const worktrees = useGitStore((s) => s.worktrees);
  const currentAgentName = useAgentStore((s) => s.currentAgentBySession[session.sessionId] ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasPiChildren = !!(children && children.length > 0);
  const hasSubagents = !!(subsessions && subsessions.length > 0);
  const hasExpandableChildren = Boolean(hasPiChildren) || Boolean(hasSubagents);
  const workspaceInfo = useMemo(
    () =>
      worktrees.find((wt) => session.projectPath === wt.path) ??
      [...worktrees]
        .sort((a, b) => b.path.length - a.path.length)
        .find((wt) => session.projectPath.startsWith(wt.path)) ??
      null,
    [worktrees, session.projectPath],
  );

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (isEditing) return;
    setActiveSession(session.sessionId);
    useSubagentStore.getState().setActiveSubsession(session.sessionId, null);
    if (hasExpandableChildren && !isExpanded) {
      onToggleExpand();
    }
    const layout = useLayoutStore.getState();
    if (layout.breakpoint === "mobile" && layout.sessionPanel === "visible") {
      layout.hideSession();
    }
  };

  const handleCopyId = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      copyToClipboard(session.sessionId);
    },
    [session.sessionId],
  );

  const handleStartRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditName(session.name || "");
      setIsEditing(true);
    },
    [session.name],
  );

  const handleConfirmRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== session.name) {
      renameSession(session.sessionId, trimmed);
    }
    setIsEditing(false);
  }, [editName, session.name, session.sessionId, renameSession]);

  const handleCancelRename = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    deleteSession(session.sessionId);
    setDeleteConfirm(false);
  }, [session.sessionId, deleteSession]);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirm(false);
  }, []);

  const handleTogglePin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      togglePinSession(session.sessionId);
    },
    [session.sessionId, togglePinSession],
  );

  const displayName = session.name || session.firstMessage || t("sidebar:emptySession");

  return (
    <div className="py-1 first:pt-0.5 last:pb-0.5">
      <div
        data-testid={`session-item-${session.sessionId}`}
        className={`group w-full text-left px-2.5 py-2 rounded-lg text-[11px] transition-all duration-150 cursor-pointer ${
          isActive
            ? "bg-[var(--color-accent)]/[0.15] text-[var(--color-accent-text)] shadow-sm shadow-[var(--color-accent)]/5 border border-[var(--color-accent)]/20"
            : "text-text-tertiary hover:bg-bg-elevated/[0.04] dark:hover:bg-surface-dim/50 hover:text-text-primary dark:hover:text-text-primary border border-transparent hover:border-border-secondary/30 dark:hover:border-border-secondary/30"
        } ${isActive ? "ring-1 ring-[var(--color-accent)]/20" : ""}`}
        onClick={handleClick}
      >
        <div className="flex items-center gap-1.5">
          <div
            className={`flex items-center justify-center w-5 h-5 rounded-md shrink-0 transition-colors ${
              isActive
                ? "bg-[var(--color-accent)]/20 text-[var(--color-accent-text)]"
                : "bg-surface-hover text-text-tertiary group-hover:bg-surface-hover dark:bg-surface-dim/60 dark:group-hover:bg-surface-hover/60 dark:group-hover:text-text-tertiary"
            }`}
          >
            <User className="w-3 h-3" />
          </div>
          {isEditing ? (
            <div
              className="flex items-center gap-1 flex-1 min-w-0"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirmRename();
                  if (e.key === "Escape") handleCancelRename();
                }}
                className="flex-1 bg-bg-elevated dark:bg-surface-dim border border-semantic-accent/50 rounded px-1.5 py-0.5 text-[11px] text-text-primary outline-none"
              />
              <button
                onClick={handleConfirmRename}
                className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-status-success"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={handleCancelRename}
                className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <>
              {session.pinned && <Pin className="w-3 h-3 shrink-0 text-semantic-accent" />}
              <span
                className={`truncate font-medium leading-tight flex-1 min-w-0 ${isActive ? "text-[var(--color-accent-text)]" : ""}`}
              >
                {displayName}
              </span>
              {currentAgentName && (
                <span
                  className="text-[9px] px-1 py-0.5 rounded font-mono shrink-0 ml-1 bg-[var(--color-accent)]/10 text-[var(--color-accent-text)]"
                  title={t("sidebar:currentAgent", "Current Agent")}
                >
                  {currentAgentName}
                </span>
              )}
            </>
          )}
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1.5 mt-1.5">
            {hasExpandableChildren && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand();
                }}
                className="shrink-0 p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            <StatusBadge sessionId={session.sessionId} />
            {workspaceInfo && !workspaceInfo.isMain && <WorkspaceBadge workspace={workspaceInfo} />}
            <div className="ml-auto flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleTogglePin}
                className={`p-1 rounded-md hover:bg-surface-hover/60 dark:hover:bg-surface-hover/60 transition-colors ${session.pinned ? "text-semantic-accent" : "text-text-secondary hover:text-text-secondary"}`}
                title={session.pinned ? t("sidebar:unpin") : t("sidebar:pin")}
              >
                {session.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </button>
              <button
                onClick={handleCopyId}
                className="p-1 rounded-md hover:bg-surface-hover/60 dark:hover:bg-surface-hover/60 text-text-secondary hover:text-text-secondary transition-colors"
                title={t("sidebar:copyId")}
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={handleStartRename}
                className="p-1 rounded-md hover:bg-surface-hover/60 dark:hover:bg-surface-hover/60 text-text-secondary hover:text-text-secondary transition-colors"
                title={t("common:rename")}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={handleDelete}
                className="p-1 rounded-md hover:bg-status-error/40 text-text-secondary hover:text-status-error transition-colors"
                title={t("common:delete")}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {isExpanded && hasExpandableChildren && (
        <div className="ml-4 pl-3 border-l border-border-secondary dark:border-surface-code/60 mt-0.5 space-y-0">
          {loadingSubs && (
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-text-tertiary dark:text-text-secondary">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t("sidebar:loadingSubagents")}
            </div>
          )}
          {!loadingSubs &&
            hasPiChildren &&
            children?.map((child) => (
              <SessionItem
                key={child.sessionId}
                session={child}
                isActive={false}
                isExpanded={false}
                onToggleExpand={() => {}}
              />
            ))}
          {!loadingSubs &&
            hasSubagents &&
            subsessions?.map((sub) => (
              <SubagentItem key={sub.sessionId} sub={sub} parentSessionId={session.sessionId} />
            ))}
        </div>
      )}

      {deleteConfirm && (
        <ConfirmDialog
          title={t("common:delete")}
          message={t("sidebar:deleteSessionConfirm", {
            name: session.name || t("sidebar:emptySession"),
          })}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  );
}

function SubagentItem({
  sub,
  parentSessionId,
}: {
  sub: SubagentSessionInfo;
  parentSessionId: string;
}) {
  const { t } = useTranslation(["sidebar", "common"]);
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const isActive = activeSubId === sub.sessionId;
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (isEditing) return;
    useSubagentStore.getState().setActiveSubsession(parentSessionId, sub.sessionId);
    const layout = useLayoutStore.getState();
    if (layout.breakpoint === "mobile" && layout.sessionPanel === "visible") {
      layout.hideSession();
    }
  };

  const handleCopyId = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      copyToClipboard(sub.sessionId);
    },
    [sub.sessionId],
  );

  const handleStartRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditName(sub.description || "");
      setIsEditing(true);
    },
    [sub.description],
  );

  const handleConfirmRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== sub.description) {
      const { subsessionsByParent } = useSubagentStore.getState();
      for (const [path, subs] of Object.entries(subsessionsByParent)) {
        if (subs.some((s) => s.sessionId === sub.sessionId)) {
          useSubagentStore.getState().renameSubagent(path, sub.sessionId, trimmed);
          break;
        }
      }
    }
    setIsEditing(false);
  }, [editName, sub.description, sub.sessionId]);

  const handleCancelRename = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    const { subsessionsByParent } = useSubagentStore.getState();
    for (const [path, subs] of Object.entries(subsessionsByParent)) {
      if (subs.some((s) => s.sessionId === sub.sessionId)) {
        useSubagentStore.getState().deleteSubagent(path, sub.sessionId);
        break;
      }
    }
    setDeleteConfirm(false);
  }, [sub.sessionId]);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirm(false);
  }, []);

  const displayName = sub.description || sub.instruction.slice(0, 80);

  return (
    <div className="py-1 first:pt-0.5 last:pb-0.5">
      <div
        className={`group w-full text-left px-2.5 py-2 rounded-lg text-[11px] cursor-pointer transition-all duration-150 ${
          isActive
            ? "border-l-2 border-l-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.08] text-[var(--color-accent-text)]"
            : "text-text-tertiary hover:bg-bg-elevated/[0.04] dark:hover:bg-surface-dim/50 hover:text-text-secondary border border-transparent hover:border-border-secondary/30 dark:hover:border-border-secondary/30"
        }`}
        onClick={handleClick}
      >
        <div className="flex items-center gap-1.5">
          <div
            className={`flex items-center justify-center w-5 h-5 rounded-md shrink-0 transition-colors ${
              isActive
                ? "bg-[var(--color-accent)]/20 text-[var(--color-accent-text)]"
                : "bg-surface-hover text-text-tertiary group-hover:bg-surface-hover dark:bg-surface-dim/60 group-hover:text-text-tertiary"
            }`}
          >
            <Bot className="w-3 h-3" />
          </div>
          {isEditing ? (
            <div
              className="flex items-center gap-1 flex-1 min-w-0"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirmRename();
                  if (e.key === "Escape") handleCancelRename();
                }}
                className="flex-1 bg-bg-elevated dark:bg-surface-dim border border-semantic-agent/50 rounded px-1.5 py-0.5 text-[11px] text-text-primary outline-none"
              />
              <button
                onClick={handleConfirmRename}
                className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-status-success"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={handleCancelRename}
                className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <>
              <span
                className={`truncate leading-tight flex-1 min-w-0 ${isActive ? "text-[var(--color-accent-text)]" : ""}`}
              >
                {displayName}
              </span>
              {sub.agent && (
                <span
                  className="text-[9px] px-1 py-0.5 rounded font-mono shrink-0 ml-1 bg-[var(--color-accent)]/10 text-[var(--color-accent-text)]"
                  title={sub.agent}
                >
                  {sub.agent}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <SubagentStatusBadge sub={sub} />
          <div className="ml-auto flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopyId}
              className="p-1 rounded-md hover:bg-surface-hover/60 dark:hover:bg-surface-hover/60 text-text-secondary hover:text-text-secondary transition-colors"
              title={t("sidebar:copyId")}
            >
              <Copy className="w-3 h-3" />
            </button>
            <button
              onClick={handleStartRename}
              className="p-1 rounded-md hover:bg-surface-hover/60 dark:hover:bg-surface-hover/60 text-text-secondary hover:text-text-secondary transition-colors"
              title={t("common:rename")}
            >
              <Copy className="w-3 h-3" />
            </button>
            <button
              onClick={handleStartRename}
              className="p-1 rounded-md hover:bg-surface-hover/60 text-text-secondary hover:text-text-secondary transition-colors"
              title={t("common:rename")}
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={handleDelete}
              className="p-1 rounded-md hover:bg-status-error/40 text-text-secondary hover:text-status-error transition-colors"
              title={t("common:delete")}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {deleteConfirm && (
        <ConfirmDialog
          title={t("common:delete")}
          message={t("sidebar:deleteSubagentConfirm", {
            name: sub.description || sub.instruction.slice(0, 30),
          })}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  );
}

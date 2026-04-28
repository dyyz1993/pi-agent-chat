import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Search, ChevronRight, ChevronDown, Copy, Pencil, Trash2, User, Check, X, Loader2, Bot, GitBranch, Pin, PinOff } from "lucide-react";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useGitStore } from "../../stores/use-git-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import type { SessionMeta, SubagentSessionInfo } from "../../types";
import { copyToClipboard } from "../../utils/clipboard";

const EMPTY: never[] = [];

interface SessionSidebarProps {
  hideOuterHeader?: boolean;
}

export function SessionSidebar(_props: SessionSidebarProps) {
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
        <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/50 rounded text-[11px] text-gray-500">
          <Search className="w-3 h-3 shrink-0" />
          <input
            placeholder="搜索会话..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent outline-none flex-1 min-w-0 placeholder:text-gray-600"
          />
        </div>
      </div>

      <SessionList searchQuery={searchQuery} expandedIds={expandedIds} onToggleExpand={toggleExpand} onExpandSession={expandSession} />
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
    const sessionPath = rawSessions.find((s) => s.sessionId === activeSessionId)?.sessionPath || "";
    const subs = subsessionsByParent[sessionPath];
    if (subs && subs.length > 0) {
      autoExpandedRef.current.add(activeSessionId);
      onExpandSession(activeSessionId);
    }
  }, [subsessionsByParent, activeSessionId, rawSessions, onExpandSession]);

  const { rootSessions, childMap } = useMemo(() => {
    const children: Record<string, SessionMeta[]> = {};
    const roots: SessionMeta[] = [];
    const q = searchQuery.trim().toLowerCase();

    for (const sess of rawSessions) {
      if (sess.parentSessionPath) {
        if (!children[sess.parentSessionPath]) children[sess.parentSessionPath] = [];
        children[sess.parentSessionPath].push(sess);
      } else {
        roots.push(sess);
      }
    }

    const sortPinnedFirst = (s: SessionMeta[]) =>
      [...s].sort((a, b) => {
        if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });

    if (q) {
      const filter = (s: SessionMeta[]) =>
        s.filter(
          (sess) =>
            sess.name?.toLowerCase().includes(q) ||
            sess.firstMessage?.toLowerCase().includes(q) ||
            sess.sessionId.toLowerCase().includes(q)
        );
      const filteredRoots = sortPinnedFirst(filter(roots));
      const filteredChildren: Record<string, SessionMeta[]> = {};
      for (const [parentPath, kids] of Object.entries(children)) {
        const filtered = filter(kids);
        if (filtered.length > 0) filteredChildren[parentPath] = filtered;
        else {
          const parentMatch = roots.find((r) => r.sessionPath === parentPath && (r.name?.toLowerCase().includes(q) || r.firstMessage?.toLowerCase().includes(q)));
          if (parentMatch) filteredChildren[parentPath] = filtered;
        }
      }
      return { rootSessions: filteredRoots, childMap: filteredChildren };
    }

    return { rootSessions: sortPinnedFirst(roots), childMap: children };
  }, [rawSessions, searchQuery]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-xs p-4">
        <div className="w-3 h-3 border-2 border-gray-600 border-t-transparent rounded-full animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  if (rootSessions.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-gray-600 text-xs p-4 text-center">{searchQuery ? "无匹配会话" : "暂无会话"}</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-1 space-y-1">
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
  const status = useSessionStore((s) => s.sessionStatusMap[sessionId]);

  if (status === "streaming" || status === "compacting") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
        <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
        工作中
      </span>
    );
  }
  if (status === "permission") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20">
        <span className="w-1 h-1 rounded-full bg-red-400" />
        需要协助
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
      <span className="w-1 h-1 rounded-full bg-emerald-400" />
      空闲
    </span>
  );
}

function WorktreeBranchBadge({ branch }: { branch: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
      <GitBranch className="w-2.5 h-2.5" />
      {branch}
    </span>
  );
}

function SubagentStatusBadge({ sub }: { sub: SubagentSessionInfo }) {
  if (sub.exitCode === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
        <span className="w-1 h-1 rounded-full bg-emerald-400" />
        空闲
      </span>
    );
  }
  if (sub.error || (sub.exitCode !== undefined && sub.exitCode !== 0)) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20">
        出错
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
      <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
      运行中
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
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const renameSession = useSessionStore((s) => s.renameSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const togglePinSession = useSessionStore((s) => s.togglePinSession);
  const subsessions = useSubagentStore((s) => s.subsessionsByParent[session.sessionPath]);
  const loadingSubs = useSubagentStore((s) => s.loadingByParent[session.sessionPath]);
  const worktrees = useGitStore((s) => s.worktrees);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hasPiChildren = children && children.length > 0;
  const hasSubagents = subsessions && subsessions.length > 0;
  const hasExpandableChildren = hasPiChildren || hasSubagents;
  const worktreeInfo = useMemo(
    () => worktrees.find((wt) => !wt.isMain && session.projectPath.startsWith(wt.path)),
    [worktrees, session.projectPath]
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

  const handleCopyId = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(session.sessionId);
  }, [session.sessionId]);

  const handleStartRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(session.name || "");
    setIsEditing(true);
  }, [session.name]);

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
    if (confirm(`确定删除会话 "${session.name || "空会话"}" 吗？`)) {
      deleteSession(session.sessionId);
    }
  }, [session.name, session.sessionId, deleteSession]);

  const handleTogglePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    togglePinSession(session.sessionId);
  }, [session.sessionId, togglePinSession]);

  const displayName = session.name || session.firstMessage || "空会话";

  return (
    <div>
      <div
        className={`group w-full text-left px-2.5 py-2 rounded text-[11px] transition-colors cursor-pointer ${isActive
            ? "bg-indigo-600/20 text-indigo-200"
            : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
          } ${isActive ? "border-l-2 border-indigo-500 -ml-[2px] pl-[calc(0.625rem+2px)]" : ""}`}
        onClick={handleClick}
      >
        <div className="flex items-center justify-center gap-1.5">
          <User className="w-4 h-4 shrink-0 text-gray-500 group-hover:text-gray-400" />
          {isEditing ? (
            <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirmRename();
                  if (e.key === "Escape") handleCancelRename();
                }}
                className="flex-1 bg-gray-800 border border-indigo-500/50 rounded px-1.5 py-0.5 text-[11px] text-gray-200 outline-none"
              />
              <button onClick={handleConfirmRename} className="p-0.5 rounded hover:bg-gray-700 text-emerald-400">
                <Check className="w-3 h-3" />
              </button>
              <button onClick={handleCancelRename} className="p-0.5 rounded hover:bg-gray-700 text-gray-500">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <>
              {session.pinned && <Pin className="w-3 h-3 shrink-0 text-indigo-400" />}
              <span className="truncate font-medium leading-tight flex-1 min-w-0">{displayName}</span>
            </>
          )}
        </div>

        {!isEditing && (
          <div className="flex items-center justify-center gap-1.5 mt-1">
            {hasExpandableChildren && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
                className="shrink-0 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
                title={isExpanded ? "收起子代理" : "展开子代理"}
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            )}
            <StatusBadge sessionId={session.sessionId} />
            {worktreeInfo && <WorktreeBranchBadge branch={worktreeInfo.branch} />}
            <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={handleTogglePin} className={`p-1 rounded hover:bg-gray-700 ${session.pinned ? "text-indigo-400" : "text-gray-500 hover:text-gray-300"}`} title={session.pinned ? "取消置顶" : "置顶"}>
                {session.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </button>
              <button onClick={handleCopyId} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300" title="复制 ID">
                <Copy className="w-3 h-3" />
              </button>
              <button onClick={handleStartRename} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300" title="重命名">
                <Pencil className="w-3 h-3" />
              </button>
              <button onClick={handleDelete} className="p-1 rounded hover:bg-red-900/50 text-gray-500 hover:text-red-400" title="删除">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {isExpanded && hasExpandableChildren && (
        <div className="ml-4 pl-2 border-l border-gray-800 mt-1 space-y-1">
          {loadingSubs && (
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-gray-600">
              <Loader2 className="w-3 h-3 animate-spin" />
              加载子代理...
            </div>
          )}
          {!loadingSubs && hasPiChildren && children!.map((child) => (
            <SessionItem
              key={child.sessionId}
              session={child}
              isActive={false}
              isExpanded={false}
              onToggleExpand={() => { }}
            />
          ))}
          {!loadingSubs && hasSubagents && subsessions!.map((sub) => (
            <SubagentItem
              key={sub.sessionId}
              sub={sub}
              parentSessionId={session.sessionId}
            />
          ))}
        </div>
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
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const isActive = activeSubId === sub.sessionId;

  const handleClick = () => {
    useSubagentStore.getState().setActiveSubsession(parentSessionId, sub.sessionId);
    const layout = useLayoutStore.getState();
    if (layout.breakpoint === "mobile" && layout.sessionPanel === "visible") {
      layout.hideSession();
    }
  };

  const handleCopyId = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(sub.sessionId);
  }, [sub.sessionId]);

  const displayName = sub.description || sub.instruction.slice(0, 80);

  return (
    <div
      className={`group w-full text-left px-2.5 py-2 rounded text-[11px] cursor-pointer transition-colors ${isActive
          ? "bg-purple-600/20 text-purple-200"
          : "text-gray-500 hover:bg-gray-800/60 hover:text-gray-300"
        }`}
      onClick={handleClick}
    >
      <div className="flex items-center justify-center gap-1.5">
        <Bot className="w-4 h-4 shrink-0 text-purple-500/70 group-hover:text-purple-400" />
        <span className="truncate leading-tight flex-1 min-w-0">{displayName}</span>
      </div>
      <div className="flex items-center justify-center gap-1.5 mt-1">
        <SubagentStatusBadge sub={sub} />
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={handleCopyId} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300" title="复制 ID">
            <Copy className="w-3 h-3" />
          </button>
          <button className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300" title="重命名">
            <Pencil className="w-3 h-3" />
          </button>
          <button className="p-1 rounded hover:bg-red-900/50 text-gray-500 hover:text-red-400" title="删除">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

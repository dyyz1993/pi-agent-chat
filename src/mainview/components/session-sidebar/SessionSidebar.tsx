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
import type { SessionMeta, SessionStatus, SubagentSessionInfo } from "../../types";
import { ConfirmDialog } from "../explorer/ConfirmDialog";
import { DropdownSelect, useCopyFeedback } from "../primitives";
import { agentColorStyle } from "../../utils/agent-color";
import { AgentAvatar } from "../agent-avatar/AgentAvatar";
import { jumpToSessionById } from "../chat/primitives/useJumpToSession";
import { ChatReloadButton } from "../chat/SessionReloadButton";

const EMPTY: never[] = [];

export type SessionSidebarFilterType = "main" | "delegate" | "subagent";
type GroupSessionFilterType = SessionSidebarFilterType | "all" | "normal";

function isDelegateSession(session: SessionMeta): boolean {
  return session.delegateType === "coordinator" || session.sessionId.startsWith("sess_coord_");
}

function isSubagentSession(session: SessionMeta): boolean {
  return session.delegateType === "subagent" || session.sessionId.startsWith("sess_sub_");
}

function isMainSession(session: SessionMeta): boolean {
  return (
    !session.delegateParentSessionId && !isDelegateSession(session) && !isSubagentSession(session)
  );
}

export function getSidebarFocusForActiveSelection({
  activeSessionId,
  activeSubsessionId,
  sessions,
}: {
  activeSessionId: string | null | undefined;
  activeSubsessionId: string | null | undefined;
  sessions: SessionMeta[];
}): { filterType: SessionSidebarFilterType; expandSessionId?: string } | null {
  if (activeSubsessionId) {
    return {
      filterType: "subagent",
      expandSessionId: activeSessionId ?? undefined,
    };
  }

  const activeSession = activeSessionId
    ? sessions.find((session) => session.sessionId === activeSessionId)
    : null;
  if (!activeSession) return null;

  if (isSubagentSession(activeSession)) {
    return {
      filterType: "subagent",
      expandSessionId: activeSession.delegateParentSessionId ?? undefined,
    };
  }

  if (isDelegateSession(activeSession)) {
    return { filterType: "delegate" };
  }

  return {
    filterType: "main",
    expandSessionId: activeSession.sessionId,
  };
}

export function groupSessions(
  rawSessions: SessionMeta[],
  searchQuery: string,
  filterType: GroupSessionFilterType = "all",
  filterAgent?: string | null,
  agentBySession?: Record<string, string>,
  statusBySession?: Record<string, SessionStatus>,
): { rootSessions: SessionMeta[]; childMap: Record<string, SessionMeta[]> } {
  const seen = new Set<string>();
  const deduped = rawSessions.filter((sess) => {
    if (seen.has(sess.sessionId)) return false;
    seen.add(sess.sessionId);
    return true;
  });

  const idToPath = new Map<string, string>();
  for (const sess of deduped) {
    idToPath.set(sess.sessionId, sess.sessionPath);
  }

  const children: Record<string, SessionMeta[]> = {};
  const roots: SessionMeta[] = [];
  const q = searchQuery.trim().toLowerCase();

  for (const sess of deduped) {
    const isSubagent = sess.sessionId.startsWith("sess_sub_");
    if (isSubagent && sess.delegateParentSessionId) {
      const parentPath = idToPath.get(sess.delegateParentSessionId);
      if (parentPath) {
        if (!children[parentPath]) children[parentPath] = [];
        children[parentPath].push(sess);
      } else {
        roots.push(sess);
      }
    } else if (!sess.delegateParentSessionId && sess.parentSessionPath) {
      if (!children[sess.parentSessionPath]) children[sess.parentSessionPath] = [];
      children[sess.parentSessionPath].push(sess);
    } else {
      roots.push(sess);
    }
  }

  const isWorkingSession = (sess: SessionMeta): boolean => {
    const status = statusBySession?.[sess.sessionId] ?? sess.sessionStatus ?? sess.status;
    return (
      status === "running" ||
      status === "streaming" ||
      status === "compacting" ||
      status === "retrying"
    );
  };

  const sortPinnedFirst = (s: SessionMeta[]) =>
    [...s].sort((a, b) => {
      const getPriority = (sess: SessionMeta): number => {
        const isEmpty = sess.messageCount === 0 && !sess.firstMessage;
        if (isWorkingSession(sess)) return 0;
        if (sess.pinned) return 1;
        if (isEmpty) return 3; // 空占位会话不应压过最近聊过的普通会话
        return 2;
      };
      const priorityA = getPriority(a);
      const priorityB = getPriority(b);
      if (priorityA !== priorityB) return priorityA - priorityB;

      const aWorking = isWorkingSession(a);
      const bWorking = isWorkingSession(b);
      if (aWorking && bWorking) {
        const createdDiff = a.createdAt - b.createdAt;
        if (createdDiff !== 0) return createdDiff;
      }

      // 相同优先级按更新时间降序（最新的在上面）
      return b.updatedAt - a.updatedAt;
    });

  let resultRoots: SessionMeta[];
  let resultChildMap: Record<string, SessionMeta[]>;

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
    resultRoots = filteredRoots;
    resultChildMap = filteredChildren;
  } else {
    resultRoots = sortPinnedFirst(roots);
    resultChildMap = children;
  }

  if (filterType === "delegate") {
    resultRoots = resultRoots.filter(isDelegateSession);
    resultChildMap = {};
  } else if (filterType === "main" || filterType === "normal") {
    resultRoots = resultRoots.filter(isMainSession);
  } else if (filterType === "subagent") {
    resultRoots = sortPinnedFirst(
      deduped.filter((session) => {
        if (!isSubagentSession(session)) return false;
        if (!q) return true;
        return (
          session.name?.toLowerCase().includes(q) ||
          session.firstMessage?.toLowerCase().includes(q) ||
          session.sessionId.toLowerCase().includes(q)
        );
      }),
    );
    resultChildMap = {};
  }

  if (filterAgent) {
    resultRoots = resultRoots.filter((r) => agentBySession?.[r.sessionId] === filterAgent);
  }

  return { rootSessions: resultRoots, childMap: resultChildMap };
}

export function getStandaloneSubagentItems(
  subsessionsByParent: Record<string, SubagentSessionInfo[]>,
  rawSessions: SessionMeta[],
  searchQuery: string,
  subagentStatusMap: Record<string, SessionStatus | undefined> = {},
  sessionStatusMap: Record<string, SessionStatus | undefined> = {},
): Array<{ sub: SubagentSessionInfo; parentSessionId: string }> {
  const q = searchQuery.trim().toLowerCase();
  const parentIdByPath = new Map(
    rawSessions.map((session) => [session.sessionPath, session.sessionId]),
  );
  const items: Array<{ sub: SubagentSessionInfo; parentSessionId: string }> = [];

  for (const [parentPath, subsessions] of Object.entries(subsessionsByParent)) {
    const parentSessionId = parentIdByPath.get(parentPath);
    if (!parentSessionId) continue;

    for (const sub of subsessions) {
      if (
        q &&
        !sub.sessionId.toLowerCase().includes(q) &&
        !sub.description.toLowerCase().includes(q) &&
        !sub.instruction.toLowerCase().includes(q)
      ) {
        continue;
      }
      items.push({ sub, parentSessionId });
    }
  }

  return items.sort(
    (a, b) =>
      compareSubagentsForSidebar(a.sub, b.sub, subagentStatusMap, sessionStatusMap) ||
      a.parentSessionId.localeCompare(b.parentSessionId),
  );
}

function getSubagentSidebarSortPriority(
  status: ReturnType<typeof getSubagentSidebarStatus>,
): number {
  switch (status) {
    case "permission":
      return 0;
    case "retrying":
      return 1;
    case "running":
      return 2;
    case "error":
      return 3;
    case "idle":
      return 4;
  }
}

function compareSubagentsForSidebar(
  a: SubagentSessionInfo,
  b: SubagentSessionInfo,
  subagentStatusMap: Record<string, SessionStatus | undefined>,
  sessionStatusMap: Record<string, SessionStatus | undefined>,
): number {
  const aStatus = getSubagentSidebarStatus(
    a,
    subagentStatusMap[a.sessionId],
    sessionStatusMap[a.sessionId],
  );
  const bStatus = getSubagentSidebarStatus(
    b,
    subagentStatusMap[b.sessionId],
    sessionStatusMap[b.sessionId],
  );
  const priorityDiff =
    getSubagentSidebarSortPriority(aStatus) - getSubagentSidebarSortPriority(bStatus);
  if (priorityDiff !== 0) return priorityDiff;

  return b.startedAt - a.startedAt;
}

export function sortSubagentsForSidebar(
  subsessions: SubagentSessionInfo[] | undefined,
  subagentStatusMap: Record<string, SessionStatus | undefined> = {},
  sessionStatusMap: Record<string, SessionStatus | undefined> = {},
): SubagentSessionInfo[] {
  return [...(subsessions ?? [])].sort((a, b) =>
    compareSubagentsForSidebar(a, b, subagentStatusMap, sessionStatusMap),
  );
}

export function getVisibleDelegateChildren(
  children: SessionMeta[] | undefined,
  subsessions: SubagentSessionInfo[] | undefined,
): SessionMeta[] {
  if (!children?.length) return [];
  if (!subsessions?.length) return children;

  const indexedSubagentIds = new Set(subsessions.map((sub) => sub.sessionId));
  return children.filter(
    (child) => !(isSubagentSession(child) && indexedSubagentIds.has(child.sessionId)),
  );
}

interface SessionSidebarProps {
  hideOuterHeader?: boolean;
}

export function SessionSidebar(_props: SessionSidebarProps) {
  const { t } = useTranslation("sidebar");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<SessionSidebarFilterType>("main");
  const [filterAgent, setFilterAgent] = useState<string | null>(null);

  const newSessionCreatedAt = useSessionStore((s) => s.newSessionCreatedAt);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectSessions = useSessionStore((s) => {
    const tab = s.projectTabs.find((t) => t.id === s.activeProjectId);
    if (!tab) return EMPTY;
    return s.sessionsByProject[tab.path] || EMPTY;
  });
  const fetchProjectSessionStatuses = useSessionStore((s) => s.fetchProjectSessionStatuses);
  const activeSubsessionId = useSubagentStore((s) => s.activeSubsessionId);
  const subagentStatusMap = useSubagentStore((s) => s.subagentStatusMap);
  const sessionStatusMap = useSessionStore((s) => s.sessionStatusMap);
  const lastAutoFocusKeyRef = useRef("");
  const reloadSessionId = activeSubsessionId ?? activeSessionId;
  const reloadStatus = activeSubsessionId
    ? (subagentStatusMap[activeSubsessionId] ?? sessionStatusMap[activeSubsessionId])
    : activeSessionId
      ? sessionStatusMap[activeSessionId]
      : undefined;

  useEffect(() => {
    if (newSessionCreatedAt > 0) {
      setExpandedIds(new Set());
    }
  }, [newSessionCreatedAt]);

  useEffect(() => {
    const focus = getSidebarFocusForActiveSelection({
      activeSessionId,
      activeSubsessionId,
      sessions: activeProjectSessions,
    });
    if (!focus) return;

    const focusKey = `${activeProjectId ?? ""}:${activeSessionId ?? ""}:${activeSubsessionId ?? ""}`;
    if (lastAutoFocusKeyRef.current === focusKey) return;
    lastAutoFocusKeyRef.current = focusKey;

    setFilterType(focus.filterType);
    setSearchQuery("");
    setFilterAgent(null);
    if (focus.expandSessionId) {
      setExpandedIds((prev) => {
        if (prev.has(focus.expandSessionId!)) return prev;
        const next = new Set(prev);
        next.add(focus.expandSessionId!);
        return next;
      });
    }
  }, [activeProjectId, activeProjectSessions, activeSessionId, activeSubsessionId]);

  // Lazy fetch: only when sidebar is visible, fetch current project's session statuses
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return;
    fetchedRef.current = true;
    fetchProjectSessionStatuses(tab.path);
  }, [activeProjectId, projectTabs, fetchProjectSessionStatuses]);

  const toggleExpand = useCallback((sessionId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-elevated/70 border border-border-primary/70 rounded-md text-[11px] text-text-tertiary">
          <Search className="w-3 h-3 shrink-0" />
          <input
            data-testid="session-search"
            placeholder={t("searchSessions")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent outline-none flex-1 min-w-0 placeholder:text-text-tertiary"
          />
        </div>
      </div>

      <div className="px-2 py-0.5 flex min-w-0 items-center gap-1">
        {(["main", "delegate", "subagent"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
              filterType === type
                ? "bg-semantic-accent/15 text-accent-text"
                : "text-text-tertiary hover:bg-surface-hover/40 hover:text-text-secondary"
            }`}
          >
            {type === "main"
              ? t("sidebar:filterMain", "主会话")
              : type === "delegate"
                ? t("sidebar:filterDelegate", "委派")
                : t("sidebar:filterSubagent", "子任务")}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ChatReloadButton sessionId={reloadSessionId} status={reloadStatus} />
          <AgentFilterDropdown selectedAgent={filterAgent} onSelectAgent={setFilterAgent} />
        </div>
      </div>

      <SessionList
        searchQuery={searchQuery}
        filterType={filterType}
        filterAgent={filterAgent}
        expandedIds={expandedIds}
        onToggleExpand={toggleExpand}
      />
    </div>
  );
}

function SessionList({
  searchQuery,
  filterType,
  filterAgent,
  expandedIds,
  onToggleExpand,
}: {
  searchQuery: string;
  filterType: SessionSidebarFilterType;
  filterAgent: string | null;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
}) {
  const { t } = useTranslation(["sidebar", "common"]);
  const rawSessions = useSessionStore((s) => {
    const tab = s.projectTabs.find((t) => t.id === s.activeProjectId);
    if (!tab) return EMPTY;
    return s.sessionsByProject[tab.path] || EMPTY;
  });
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const newSessionCreatedAt = useSessionStore((s) => s.newSessionCreatedAt);
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const loading = useSessionStore((s) => s.loading);
  const sessionStatusMap = useSessionStore((s) => s.sessionStatusMap);
  const agentBySession = useAgentStore((s) => s.currentAgentBySession);
  const subagentStatusMap = useSubagentStore((s) => s.subagentStatusMap);
  const listRef = useRef<HTMLDivElement>(null);

  const activeSessionPath = useMemo(() => {
    const sess = rawSessions.find((s) => s.sessionId === activeSessionId);
    return sess?.sessionPath ?? null;
  }, [rawSessions, activeSessionId]);

  useEffect(() => {
    if (!activeSessionPath) return;
    useSubagentStore.getState().loadSubsessions(activeSessionPath);
  }, [activeSessionPath]);

  const subsessionsByParent = useSubagentStore((s) => s.subsessionsByParent);

  const { rootSessions, childMap } = useMemo(
    () =>
      groupSessions(
        rawSessions,
        searchQuery,
        filterType,
        filterAgent,
        agentBySession,
        sessionStatusMap,
      ),
    [rawSessions, searchQuery, filterType, filterAgent, agentBySession, sessionStatusMap],
  );

  const standaloneSubagents = useMemo(() => {
    if (filterType !== "subagent") return [];
    const rawSubagentIds = new Set(rootSessions.map((session) => session.sessionId));
    return getStandaloneSubagentItems(
      subsessionsByParent,
      rawSessions,
      searchQuery,
      subagentStatusMap,
      sessionStatusMap,
    ).filter((item) => !rawSubagentIds.has(item.sub.sessionId));
  }, [
    filterType,
    rootSessions,
    subsessionsByParent,
    rawSessions,
    searchQuery,
    subagentStatusMap,
    sessionStatusMap,
  ]);

  const rootBadgeStatusBySession = useMemo(() => {
    const childStatusCache = new Map<string, Array<SessionStatus | undefined>>();
    const next: Record<string, SidebarBadgeStatus> = {};
    for (const session of rootSessions) {
      const childStatuses = collectChildSidebarStatuses(
        session.sessionPath,
        subsessionsByParent,
        subagentStatusMap,
        sessionStatusMap,
        childStatusCache,
      );
      next[session.sessionId] = getSessionSidebarStatus(
        session,
        sessionStatusMap[session.sessionId],
        childStatuses,
      );
    }
    return next;
  }, [rootSessions, subsessionsByParent, subagentStatusMap, sessionStatusMap]);

  const hasVisibleItems = rootSessions.length > 0 || standaloneSubagents.length > 0;

  useEffect(() => {
    if (!activeSessionId || newSessionCreatedAt <= 0) return;
    const activeNode = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-session-id]") ?? [],
    ).find((node) => node.dataset.sessionId === activeSessionId);
    activeNode?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSessionId, newSessionCreatedAt, rootSessions, standaloneSubagents]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-xs p-4">
        <div className="w-3 h-3 border-2 border-border-secondary border-t-transparent rounded-full animate-spin mr-2" />
        {t("common:loading")}
      </div>
    );
  }

  if (!hasVisibleItems) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-xs p-4 text-center">
        {searchQuery ? t("sidebar:noMatchingSessions") : t("sidebar:noSessions")}
      </div>
    );
  }

  return (
    <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-2 py-0.5 space-y-1">
      {rootSessions.map((sess) => (
        <SessionItem
          key={sess.sessionId}
          session={sess}
          isActive={sess.sessionId === activeSessionId && !activeSubId}
          children={childMap[sess.sessionPath]}
          isExpanded={expandedIds.has(sess.sessionId)}
          onToggleExpand={() => onToggleExpand(sess.sessionId)}
          badgeStatus={rootBadgeStatusBySession[sess.sessionId] ?? "idle"}
        />
      ))}
      {standaloneSubagents.map(({ sub, parentSessionId }) => (
        <SubagentItem key={sub.sessionId} sub={sub} parentSessionId={parentSessionId} />
      ))}
    </div>
  );
}

export function getSessionSidebarStatus(
  session: Pick<SessionMeta, "status" | "sessionStatus">,
  runtimeStatus?: SessionStatus,
  childStatuses: Array<SessionStatus | undefined> = [],
): SidebarBadgeStatus {
  if (runtimeStatus === "permission") return "permission";
  if (childStatuses.includes("permission")) return "permission";
  if (runtimeStatus === "retrying") return "retrying";
  if (childStatuses.includes("retrying")) return "retrying";
  if (
    runtimeStatus === "streaming" ||
    runtimeStatus === "compacting" ||
    childStatuses.includes("streaming") ||
    childStatuses.includes("compacting") ||
    session.sessionStatus === "streaming" ||
    session.sessionStatus === "compacting" ||
    session.sessionStatus === "retrying" ||
    session.status === "running"
  ) {
    return "working";
  }
  return "idle";
}

type SidebarBadgeStatus = "working" | "permission" | "retrying" | "idle";

function collectChildSidebarStatuses(
  parentSessionPath: string,
  subsessionsByParent: Record<string, SubagentSessionInfo[]>,
  subagentStatusMap: Record<string, SessionStatus | undefined>,
  sessionStatusMap: Record<string, SessionStatus | undefined>,
  cache = new Map<string, Array<SessionStatus | undefined>>(),
  visiting = new Set<string>(),
): Array<SessionStatus | undefined> {
  const cached = cache.get(parentSessionPath);
  if (cached) return cached;

  const result: Array<SessionStatus | undefined> = [];
  if (visiting.has(parentSessionPath)) return result;
  visiting.add(parentSessionPath);

  const children = subsessionsByParent[parentSessionPath] ?? [];
  for (const child of children) {
    const childRuntimeStatus = subagentStatusMap[child.sessionId];
    const childSessionRuntimeStatus = sessionStatusMap[child.sessionId];
    const childSidebarStatus = getSubagentSidebarStatus(
      child,
      childRuntimeStatus,
      childSessionRuntimeStatus,
    );
    if (childSidebarStatus === "permission") result.push("permission");
    else if (childSidebarStatus === "retrying") result.push("retrying");
    else if (childSidebarStatus === "running") result.push("streaming");

    if (child.sessionPath) {
      result.push(
        ...collectChildSidebarStatuses(
          child.sessionPath,
          subsessionsByParent,
          subagentStatusMap,
          sessionStatusMap,
          cache,
          visiting,
        ),
      );
    }
  }

  visiting.delete(parentSessionPath);
  cache.set(parentSessionPath, result);
  return result;
}

function StatusBadge({ badgeStatus }: { badgeStatus: SidebarBadgeStatus }) {
  const { t } = useTranslation("common");
  if (badgeStatus === "working") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-warning/15 text-status-warning border border-status-warning/20 whitespace-nowrap">
        <span className="w-1 h-1 rounded-full bg-status-warning animate-pulse" />
        {t("working")}
      </span>
    );
  }
  if (badgeStatus === "permission") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-error/15 text-status-error border border-status-error/20 whitespace-nowrap">
        <span className="w-1 h-1 rounded-full bg-status-error" />
        {t("needHelp")}
      </span>
    );
  }
  if (badgeStatus === "retrying") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-error/15 text-status-error border border-status-error/20 whitespace-nowrap">
        <span className="w-1 h-1 rounded-full bg-status-error animate-pulse" />
        {t("retrying")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-success/15 text-status-success border border-status-success/25 whitespace-nowrap">
      <span className="w-1 h-1 rounded-full bg-status-success" />
      {t("idle")}
    </span>
  );
}

export const WORKSPACE_BADGE_CLASS =
  "inline-flex min-w-[1.25rem] max-w-[5.75rem] shrink items-center gap-0.5 overflow-hidden whitespace-nowrap rounded border border-semantic-tool/20 bg-semantic-tool/15 px-1.5 py-0.5 text-[10px] font-medium text-semantic-tool";
export const WORKSPACE_BADGE_LABEL_CLASS = "min-w-0 truncate";

export function getWorkspaceBadgeName(workspace: {
  path: string;
  branch: string;
  isMain: boolean;
}): string {
  return workspace.isMain
    ? (workspace.path.split("/").filter(Boolean).pop() ?? workspace.path)
    : workspace.branch;
}

function WorkspaceBadge({
  workspace,
}: {
  workspace: { path: string; branch: string; isMain: boolean };
}) {
  const name = getWorkspaceBadgeName(workspace);
  return (
    <span className={WORKSPACE_BADGE_CLASS} title={`${name} · ${workspace.path}`}>
      {!workspace.isMain && <GitBranch className="h-2.5 w-2.5 shrink-0" />}
      <span className={WORKSPACE_BADGE_LABEL_CLASS}>{name}</span>
    </span>
  );
}

export function getSubagentSidebarStatus(
  sub: SubagentSessionInfo,
  runtimeStatus?: SessionStatus,
  sessionRuntimeStatus?: SessionStatus,
): "running" | "permission" | "retrying" | "idle" | "error" {
  if (sessionRuntimeStatus === "permission") return "permission";
  if (sessionRuntimeStatus === "retrying") return "retrying";
  if (
    sessionRuntimeStatus === "idle" &&
    (runtimeStatus === "streaming" || runtimeStatus === "compacting")
  ) {
    return "idle";
  }
  if (runtimeStatus === "permission") return "permission";
  if (runtimeStatus === "retrying") return "retrying";
  if (runtimeStatus === "streaming" || runtimeStatus === "compacting") return "running";
  if (sessionRuntimeStatus === "streaming" || sessionRuntimeStatus === "compacting") {
    return "running";
  }
  if (sub.error || (sub.exitCode !== undefined && sub.exitCode !== 0)) return "error";
  if (
    sessionRuntimeStatus === "idle" ||
    runtimeStatus === "idle" ||
    sub.completedAt ||
    sub.exitCode === 0
  ) {
    return "idle";
  }
  return "running";
}

function SubagentStatusBadge({ sub }: { sub: SubagentSessionInfo }) {
  const { t } = useTranslation("common");
  const runtimeStatus = useSubagentStore((s) => s.subagentStatusMap[sub.sessionId]);
  const sessionRuntimeStatus = useSessionStore((s) => s.sessionStatusMap[sub.sessionId]);
  const badgeStatus = getSubagentSidebarStatus(sub, runtimeStatus, sessionRuntimeStatus);
  if (badgeStatus === "permission") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-error/15 text-status-error border border-status-error/20 whitespace-nowrap">
        <span className="w-1 h-1 rounded-full bg-status-error" />
        {t("needHelp")}
      </span>
    );
  }
  if (badgeStatus === "retrying") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-error/15 text-status-error border border-status-error/20 whitespace-nowrap">
        <span className="w-1 h-1 rounded-full bg-status-error animate-pulse" />
        {t("retrying")}
      </span>
    );
  }
  if (badgeStatus === "running") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-warning/15 text-status-warning border border-status-warning/20 whitespace-nowrap">
        <span className="w-1 h-1 rounded-full bg-status-warning animate-pulse" />
        {t("running")}
      </span>
    );
  }
  if (badgeStatus === "error") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-error/15 text-status-error border border-status-error/20 whitespace-nowrap">
        {t("error")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-status-success/15 text-status-success border border-status-success/20 whitespace-nowrap">
      <span className="w-1 h-1 rounded-full bg-status-success" />
      {t("idle")}
    </span>
  );
}

function DelegateChildItem({ session }: { session: SessionMeta }) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionStatusMap = useSessionStore((s) => s.sessionStatusMap);
  const badgeStatus = getSessionSidebarStatus(session, sessionStatusMap[session.sessionId]);
  return (
    <SessionItem
      key={session.sessionId}
      session={session}
      isActive={session.sessionId === activeSessionId}
      isExpanded={false}
      onToggleExpand={() => {}}
      isChild
      badgeStatus={badgeStatus}
    />
  );
}

function SessionItem({
  session,
  isActive,
  children,
  isExpanded,
  onToggleExpand,
  isChild = false,
  badgeStatus,
}: {
  session: SessionMeta;
  isActive: boolean;
  children?: SessionMeta[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  isChild?: boolean;
  badgeStatus: SidebarBadgeStatus;
}) {
  const { t } = useTranslation(["sidebar", "common"]);
  const renameSession = useSessionStore((s) => s.renameSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const togglePinSession = useSessionStore((s) => s.togglePinSession);
  const subsessions = useSubagentStore((s) => s.subsessionsByParent[session.sessionPath]);
  const loadingSubs = useSubagentStore((s) => s.loadingByParent[session.sessionPath]);
  const subagentStatusMap = useSubagentStore((s) => s.subagentStatusMap);
  const sessionStatusMap = useSessionStore((s) => s.sessionStatusMap);
  const worktrees = useGitStore((s) => s.worktrees);
  const currentAgentName = useAgentStore((s) => s.currentAgentBySession[session.sessionId] ?? "");
  const agents = useAgentStore((s) => s.agents);
  const currentAgentInfo = useMemo(
    () => agents.find((agent) => agent.name === currentAgentName) ?? null,
    [agents, currentAgentName],
  );
  const currentAgentColor = agentColorStyle(currentAgentInfo?.color);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyWithFeedback = useCopyFeedback();
  const [copiedId, setCopiedId] = useState(false);
  const visibleDelegateChildren = useMemo(
    () => getVisibleDelegateChildren(children, subsessions),
    [children, subsessions],
  );
  const hasPiChildren = visibleDelegateChildren.length > 0;
  const hasSubagents = !!(subsessions && subsessions.length > 0);
  const sortedSubsessions = useMemo(
    () => sortSubagentsForSidebar(subsessions, subagentStatusMap, sessionStatusMap),
    [subsessions, subagentStatusMap, sessionStatusMap],
  );
  const isDelegate = session.sessionId.startsWith("sess_coord_");
  const isSubtask = session.sessionId.startsWith("sess_sub_");
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
    void jumpToSessionById(session.sessionId);
    const layout = useLayoutStore.getState();
    if (layout.breakpoint === "mobile" && layout.sessionPanel === "visible") {
      layout.hideSession();
    }
  };

  const handleCopyId = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      copyWithFeedback(session.sessionId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    },
    [copyWithFeedback, session.sessionId],
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
        data-session-id={session.sessionId}
        className={`group w-full text-left px-2.5 py-2 rounded-lg text-[11px] transition-all duration-150 cursor-pointer ${
          isActive
            ? "bg-semantic-accent/10 text-accent-text shadow-sm border border-semantic-accent/20 border-l-2 border-l-semantic-accent/50"
            : "text-text-tertiary hover:bg-surface-hover/40 hover:text-text-primary border border-transparent hover:border-border-primary/80"
        } ${isActive ? "ring-1 ring-semantic-accent/20" : ""}`}
        onClick={handleClick}
      >
        <div className="flex items-center gap-1.5">
          <div
            className={`flex items-center justify-center w-5 h-5 rounded-md shrink-0 transition-colors ${
              isActive
                ? "bg-semantic-accent/20 text-accent-text"
                : "bg-surface-hover/70 text-text-tertiary group-hover:bg-surface-hover"
            }`}
            style={
              currentAgentColor
                ? { backgroundColor: currentAgentColor.bg, color: currentAgentColor.color }
                : undefined
            }
          >
            <AgentAvatar
              avatar={currentAgentInfo?.avatar}
              agentFilePath={currentAgentInfo?.filePath}
              color={currentAgentInfo?.color}
              fallbackIcon={User}
              className="w-4 h-4 rounded-md shrink-0 text-[10px]"
              fallbackClassName="text-current"
              title={currentAgentName || displayName}
            />
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
                className="flex-1 bg-bg-elevated border border-semantic-accent/50 rounded px-1.5 py-0.5 text-[11px] text-text-primary outline-none"
              />
              <button
                onClick={handleConfirmRename}
                className="p-0.5 rounded hover:bg-surface-hover text-status-success"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={handleCancelRename}
                className="p-0.5 rounded hover:bg-surface-hover text-text-tertiary"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <>
              {session.pinned && <Pin className="w-3 h-3 shrink-0 text-semantic-accent" />}
              <span
                className={`truncate font-medium leading-tight flex-1 min-w-0 ${isActive ? "text-accent-text" : ""}`}
              >
                {displayName}
              </span>
              {currentAgentName && (
                <span
                  className="max-w-[4.5rem] truncate whitespace-nowrap text-[9px] px-1 py-0.5 rounded font-mono shrink-0 ml-1 bg-semantic-accent/10 text-accent-text"
                  title={t("sidebar:currentAgent", "Current Agent")}
                  style={
                    currentAgentColor
                      ? { backgroundColor: currentAgentColor.bg, color: currentAgentColor.color }
                      : undefined
                  }
                >
                  {currentAgentName}
                </span>
              )}
              {isDelegate && (
                <span className="text-[9px] px-1 py-0.5 rounded font-medium shrink-0 ml-1 bg-semantic-notify/15 text-semantic-notify border border-semantic-notify/20 whitespace-nowrap">
                  {t("sidebar:delegateTag", "委派")}
                </span>
              )}
              {isSubtask && (
                <span className="text-[9px] px-1 py-0.5 rounded font-medium shrink-0 ml-1 bg-semantic-agent/15 text-semantic-agent border border-semantic-agent/20 whitespace-nowrap">
                  {t("sidebar:subtaskTag", "子任务")}
                </span>
              )}
            </>
          )}
        </div>

        {!isEditing && (
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            {!isChild && (
              <div className="shrink-0 w-[18px]">
                {hasExpandableChildren && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpand();
                    }}
                    className="p-0.5 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            )}
            <StatusBadge badgeStatus={badgeStatus} />
            {workspaceInfo && !workspaceInfo.isMain && <WorkspaceBadge workspace={workspaceInfo} />}
            <div className="ml-auto flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleTogglePin}
                className={`p-1 rounded-md hover:bg-surface-hover/60 transition-colors ${session.pinned ? "text-semantic-accent" : "text-text-secondary hover:text-text-primary"}`}
                title={session.pinned ? t("sidebar:unpin") : t("sidebar:pin")}
              >
                {session.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </button>
              <button
                onClick={handleCopyId}
                className="p-1 rounded-md hover:bg-surface-hover/60 text-text-secondary hover:text-text-primary transition-colors"
                title={t("sidebar:copyId")}
              >
                {copiedId ? (
                  <Check className="w-3 h-3 text-status-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              <button
                onClick={handleStartRename}
                className="p-1 rounded-md hover:bg-surface-hover/60 text-text-secondary hover:text-text-primary transition-colors"
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
        <div className="ml-2 pl-2 border-l border-border-primary/50 mt-0.5 space-y-0">
          {loadingSubs && (
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-text-tertiary">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t("sidebar:loadingSubagents")}
            </div>
          )}
          {!loadingSubs &&
            hasPiChildren &&
            visibleDelegateChildren.map((child) => (
              <DelegateChildItem key={child.sessionId} session={child} />
            ))}
          {!loadingSubs &&
            hasSubagents &&
            sortedSubsessions.map((sub) => (
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

function formatDuration(startMs: number, endMs: number): string {
  const diffMs = endMs - startMs;
  if (diffMs < 0) return "0s";
  if (diffMs < 1000) return `${Math.round(diffMs)}ms`;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  return remainSec > 0 ? `${min}m${remainSec}s` : `${min}m`;
}

function SubagentDuration({ sub }: { sub: SubagentSessionInfo }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (sub.completedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [sub.completedAt]);

  const end = sub.completedAt ?? now;
  const text = formatDuration(sub.startedAt, end);

  return <span className="text-[9px] text-text-tertiary tabular-nums">{text}</span>;
}

export async function openSidebarSubagentSession(
  parentSessionId: string,
  subSessionId: string,
): Promise<void> {
  await jumpToSessionById(subSessionId, { subagentParentSessionId: parentSessionId });
}

export function isSubagentSidebarItemActive(options: {
  activeSessionId: string | null | undefined;
  activeSubsessionId: string | null | undefined;
  subSessionId: string;
}): boolean {
  return (
    options.activeSubsessionId === options.subSessionId ||
    options.activeSessionId === options.subSessionId
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
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const isActive = isSubagentSidebarItemActive({
    activeSessionId,
    activeSubsessionId: activeSubId,
    subSessionId: sub.sessionId,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyWithFeedback = useCopyFeedback();
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (isEditing) return;
    void openSidebarSubagentSession(parentSessionId, sub.sessionId);
    const layout = useLayoutStore.getState();
    if (layout.breakpoint === "mobile" && layout.sessionPanel === "visible") {
      layout.hideSession();
    }
  };

  const handleCopyId = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      copyWithFeedback(sub.sessionId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    },
    [copyWithFeedback, sub.sessionId],
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
        data-testid={`subagent-item-${sub.sessionId}`}
        className={`group w-full text-left px-2.5 py-2 rounded-lg text-[11px] cursor-pointer transition-all duration-150 ${
          isActive
            ? "border-l-2 border-l-semantic-accent/40 bg-semantic-accent/10 text-accent-text"
            : "text-text-tertiary hover:bg-surface-hover/40 hover:text-text-secondary border border-transparent hover:border-border-primary/80"
        }`}
        onClick={handleClick}
      >
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 shrink-0">
            <div
              className={`flex items-center justify-center w-5 h-5 rounded-md transition-colors ${
                isActive
                  ? "bg-semantic-accent/20 text-accent-text"
                  : "bg-surface-hover/70 text-text-tertiary group-hover:bg-surface-hover group-hover:text-text-tertiary"
              }`}
            >
              <Bot className="w-3 h-3" />
            </div>
            <span className="text-[8px] font-medium leading-none px-1 py-0.5 rounded-sm bg-semantic-agent/10 text-text-tertiary select-none">
              {t("toolLabels.subagent")}
            </span>
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
                className="flex-1 bg-bg-elevated border border-semantic-agent/50 rounded px-1.5 py-0.5 text-[11px] text-text-primary outline-none"
              />
              <button
                onClick={handleConfirmRename}
                className="p-0.5 rounded hover:bg-surface-hover text-status-success"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={handleCancelRename}
                className="p-0.5 rounded hover:bg-surface-hover text-text-tertiary"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <>
              <span
                className={`truncate leading-tight flex-1 min-w-0 ${isActive ? "text-accent-text" : ""}`}
              >
                {displayName}
              </span>
              {sub.agent && (
                <span
                  className="text-[9px] px-1 py-0.5 rounded font-mono shrink-0 ml-1 bg-semantic-accent/10 text-accent-text"
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
          <SubagentDuration sub={sub} />
          <div className="ml-auto flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopyId}
              className="p-1 rounded-md hover:bg-surface-hover/60 text-text-secondary hover:text-text-primary transition-colors"
              title={t("sidebar:copyId")}
            >
              {copiedId ? (
                <Check className="w-3 h-3 text-status-success" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
            <button
              onClick={handleStartRename}
              className="p-1 rounded-md hover:bg-surface-hover/60 text-text-secondary hover:text-text-primary transition-colors"
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

function AgentFilterDropdown({
  selectedAgent,
  onSelectAgent,
}: {
  selectedAgent: string | null;
  onSelectAgent: (agent: string | null) => void;
}) {
  const { t } = useTranslation("sidebar");
  const agentBySession = useAgentStore((s) => s.currentAgentBySession);
  const uniqueAgents = useMemo(() => {
    const names = new Set(Object.values(agentBySession));
    return [...names].filter(Boolean).sort();
  }, [agentBySession]);

  if (uniqueAgents.length === 0) return null;

  return (
    <DropdownSelect
      value={selectedAgent ?? ""}
      onChange={(next) => onSelectAgent(next || null)}
      ariaLabel={t("sidebar:filterAllAgents", "全部角色")}
      className="ml-auto h-6 max-w-[5.75rem] rounded border-border-primary/70 bg-bg-elevated/70 px-1.5 py-0.5 text-[10px] whitespace-nowrap"
      options={[
        { value: "", label: t("sidebar:filterAllAgents", "全部角色") },
        ...uniqueAgents.map((agent) => ({ value: agent, label: agent })),
      ]}
    />
  );
}

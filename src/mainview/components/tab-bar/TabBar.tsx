import {
  Bot,
  Cable,
  CloudCog,
  GitFork,
  Plus,
  X,
  Settings,
  MessageCircleQuestion,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../shared/lib/logger";
import { useSessionStore } from "../../stores/use-session-store";
import { useStatusStore } from "../../stores/use-status-store";
import { useUIDialogStore } from "../../stores/use-ui-dialog-store";
import { apiClient } from "../../lib/api-client";
import { SettingsPanel } from "../settings/SettingsPanel";
import { Button, ModalDialog } from "../primitives";
import { resolveDotClass, hasPermissionPending } from "./tab-dot";
import { getSessionIdentity, type SessionIdentity } from "../../lib/session-identity";

const log = createLogger("tab-bar");

function getProjectPendingCount(
  sessions: { sessionId: string }[],
  allPending: { sessionId: string }[],
): number {
  const sessionIds = new Set(sessions.map((s) => s.sessionId));
  return allPending.filter((r) => sessionIds.has(r.sessionId)).length;
}

const LONG_PRESS_MS = 800;
const MOVE_THRESHOLD = 5;
const TAB_NAME_MAX_CHARS = 32;
const TAB_NAME_OMISSION = "***";
const TAB_NAME_BOUNDARY_RE = /[-_.\s/]/;

const logger = createLogger("session");

function isRemoteProjectLocalPath(projectPath: string): boolean {
  return /\/(?:\.pi-agent-chat|\.pi\/chat)\/remote-projects\/ssh-[^/]+$/.test(projectPath);
}

function sessionIdentityClass(identity: SessionIdentity): string {
  if (identity.kind === "subagent") {
    return "border-status-info/30 bg-status-info/10 text-status-info";
  }
  if (identity.kind === "fork") {
    return "border-semantic-accent/30 bg-semantic-accent/10 text-semantic-accent";
  }
  return "border-status-warning/30 bg-status-warning/10 text-status-warning";
}

function clipPrefixAtBoundary(value: string, budget: number): string {
  if (value.length <= budget) return value;
  const minBoundary = Math.max(4, Math.floor(budget * 0.55));
  for (let i = budget; i >= minBoundary; i--) {
    if (TAB_NAME_BOUNDARY_RE.test(value[i] ?? "")) {
      return value.slice(0, i);
    }
  }
  return value.slice(0, budget);
}

function clipSuffixAtBoundary(value: string, budget: number): string {
  if (value.length <= budget) return value;
  const start = value.length - budget;
  const maxBoundary = Math.min(value.length - 4, start + Math.floor(budget * 0.45));
  for (let i = start; i <= maxBoundary; i++) {
    if (TAB_NAME_BOUNDARY_RE.test(value[i] ?? "")) {
      return value.slice(i);
    }
  }
  return value.slice(start);
}

export function formatTabName(name: string, maxChars = TAB_NAME_MAX_CHARS): string {
  const value = name.trim();
  if (value.length <= maxChars) return value;
  if (maxChars <= TAB_NAME_OMISSION.length) return TAB_NAME_OMISSION.slice(0, maxChars);

  const contentBudget = maxChars - TAB_NAME_OMISSION.length;
  const suffixBudget = Math.ceil(contentBudget * 0.48);
  const prefixBudget = contentBudget - suffixBudget;
  const prefix = clipPrefixAtBoundary(value, prefixBudget);
  const suffix = clipSuffixAtBoundary(value, suffixBudget);
  const boundaryResult = `${prefix}${TAB_NAME_OMISSION}${suffix}`;
  if (prefix && suffix && boundaryResult.length <= maxChars) {
    return boundaryResult;
  }

  return `${value.slice(0, prefixBudget)}${TAB_NAME_OMISSION}${value.slice(value.length - suffixBudget)}`;
}

export function TabBar({ onAddProject }: { onAddProject: () => void }) {
  const { t } = useTranslation("sidebar");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeConfirmTab, setCloseConfirmTab] = useState<{
    id: string;
    name: string;
    runningSessionIds: string[];
  } | null>(null);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const removeProjectTab = useSessionStore((s) => s.removeProjectTab);
  const reorderProjectTabs = useSessionStore((s) => s.reorderProjectTabs);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const sessionStatusMap = useSessionStore((s) => s.sessionStatusMap);
  const lastActiveSessionByProject = useSessionStore((s) => s.lastActiveSessionByProject ?? {});
  const remoteRuntimeBySession = useStatusStore((s) => s.remoteRuntimeBySession);
  const loadSessionsForProject = useSessionStore((s) => s.loadSessionsForProject);
  const allPending = useUIDialogStore((s) => s.pending);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [pressingIndex, setPressingIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const pressStartPos = useRef({ x: 0, y: 0 });
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragCleanup = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    return () => {
      dragCleanup.current?.();
    };
  }, []);

  // 初始化非活跃项目的 sessions 列表。
  // 同一 RPC (project.scanSessions) 会顺带把每个 session 的实时 status 一起带回来，
  // 写到 sessionStatusMap，所以 TabBar 一渲染就能拿到所有项目的运行/权限状态，
  // 不需要再延迟 3s 调一次 fetchAllProjectsSessionsStatus。
  // 后续状态变化由 setupProjectStatusSubscription 通过 agent.session_status_changed 推送。
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const tabsToInit = projectTabs.filter((tab) => !sessionsByProject[tab.path]);
    if (tabsToInit.length === 0) return;

    Promise.all(tabsToInit.map((tab) => loadSessionsForProject(tab.path))).catch((err) => {
      log.error("[TabBar] Failed to initialize projects:", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }, [projectTabs, sessionsByProject, loadSessionsForProject]);

  useEffect(() => {
    if (!activeProjectId) return;
    const idx = projectTabs.findIndex((t) => t.id === activeProjectId);
    if (idx < 0) return;
    const el = tabRefs.current[idx];
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeProjectId, projectTabs]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setPressingIndex(null);
  }, []);

  const startDragListeners = useCallback(
    (index: number) => {
      isDragging.current = true;
      didDrag.current = true;
      dragIndexRef.current = index;
      dropIndexRef.current = index;
      setDragIndex(index);
      setDropIndex(index);
      setPressingIndex(null);

      const onMove = (ev: PointerEvent) => {
        const di = dragIndexRef.current;
        if (di === null) return;
        let newDropIndex = di;
        for (let i = 0; i < tabRefs.current.length; i++) {
          const el = tabRefs.current[i];
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const midX = rect.left + rect.width / 2;
          if (ev.clientX >= midX) {
            newDropIndex = i;
          }
        }
        if (newDropIndex !== dropIndexRef.current) {
          dropIndexRef.current = newDropIndex;
          setDropIndex(newDropIndex);
        }
      };

      const cleanup = () => {
        const di = dragIndexRef.current;
        const dpi = dropIndexRef.current;
        if (di !== null && dpi !== null && di !== dpi) {
          reorderProjectTabs(di, dpi);
        }
        isDragging.current = false;
        dragIndexRef.current = null;
        dropIndexRef.current = null;
        setDragIndex(null);
        setDropIndex(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        dragCleanup.current = null;
      };

      const onUp = () => cleanup();
      const onCancel = () => {
        didDrag.current = false;
        cleanup();
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      dragCleanup.current = cleanup;
    },
    [reorderProjectTabs],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      if (e.button !== 0) return;
      pressStartPos.current = { x: e.clientX, y: e.clientY };
      isDragging.current = false;
      didDrag.current = false;
      setPressingIndex(index);

      longPressTimer.current = setTimeout(() => {
        startDragListeners(index);
      }, LONG_PRESS_MS);
    },
    [startDragListeners],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isDragging.current) return;
      if (longPressTimer.current) {
        const dx = e.clientX - pressStartPos.current.x;
        const dy = e.clientY - pressStartPos.current.y;
        if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
          cancelLongPress();
        }
      }
    },
    [cancelLongPress],
  );

  const handlePointerUp = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  const handlePointerCancel = useCallback(() => {
    cancelLongPress();
  }, [cancelLongPress]);

  const handleTabClick = (tabId: string) => {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    if (activeProjectId === tabId) return;
    setActiveProject(tabId);
  };

  const getRunningSessionIds = useCallback(
    (tabId: string) => {
      const tab = projectTabs.find((t) => t.id === tabId);
      if (!tab) return [];
      const sessions = sessionsByProject[tab.path] || [];
      return sessions
        .filter((s) => {
          const st = sessionStatusMap[s.sessionId];
          return st === "streaming" || st === "compacting" || st === "retrying";
        })
        .map((s) => s.sessionId);
    },
    [projectTabs, sessionsByProject, sessionStatusMap],
  );

  const handleCloseClick = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const tab = projectTabs.find((t) => t.id === tabId);
    const runningIds = getRunningSessionIds(tabId);
    setCloseConfirmTab({
      id: tabId,
      name: tab?.name ?? "",
      runningSessionIds: runningIds,
    });
  };

  const handleStopAndClose = async () => {
    if (!closeConfirmTab) return;
    for (const sid of closeConfirmTab.runningSessionIds) {
      try {
        await apiClient.call("agent.stop", { sessionId: sid });
      } catch (e) {
        logger.warn("Failed to stop agent session", { sessionId: sid, error: String(e) });
      }
    }
    removeProjectTab(closeConfirmTab.id);
    setCloseConfirmTab(null);
  };

  const handleKeepRunning = () => {
    if (!closeConfirmTab) return;
    removeProjectTab(closeConfirmTab.id);
    setCloseConfirmTab(null);
  };

  return (
    <div
      data-testid="tab-bar"
      className="app-tab-bar h-9 bg-bg-secondary border-b border-border-primary flex items-center flex-shrink-0"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(2.25rem + env(safe-area-inset-top))",
      }}
    >
      <div
        aria-hidden="true"
        className="electrobun-titlebar-spacer electrobun-webkit-app-region-drag"
      />
      <div
        className={`flex-1 flex items-center gap-1 px-1.5 min-w-0 ${
          dragIndex !== null ? "overflow-x-hidden" : "overflow-x-auto"
        }`}
      >
        {projectTabs.map((tab, index) => {
          // 区分"未加载"和"已加载但都 idle"：
          //   - sessionsByProject[tab.path] === undefined → unknown → 中性色
          //   - sessionsByProject[tab.path] === []       → loaded  → 按 session 计算颜色
          // 这样首屏进入时不会从"绿点（误判为 idle）"跳到"其他色"。
          const sessionsForTab = sessionsByProject[tab.path];
          const knowledge: "unknown" | "loaded" =
            sessionsForTab === undefined ? "unknown" : "loaded";
          const sessions = sessionsForTab ?? [];
          const dotClass = resolveDotClass(knowledge, sessions, sessionStatusMap);
          const isActive = activeProjectId === tab.id;
          const visibleSessionId =
            (isActive ? activeSessionId : undefined) ??
            lastActiveSessionByProject[tab.path] ??
            sessions[0]?.sessionId;
          const visibleSession = visibleSessionId
            ? sessions.find((session) => session.sessionId === visibleSessionId)
            : undefined;
          const sessionIdentity = getSessionIdentity(visibleSession);
          const remoteRuntime = visibleSessionId
            ? remoteRuntimeBySession[visibleSessionId]
            : undefined;
          const remoteHost =
            typeof remoteRuntime?.host === "string" ? remoteRuntime.host : (tab.remote?.host ?? "");
          const remotePath =
            typeof remoteRuntime?.remoteCwd === "string"
              ? remoteRuntime.remoteCwd
              : (tab.remote?.remotePath ?? "");
          const isRemoteProject =
            tab.runtime === "ssh" ||
            Boolean(tab.remote) ||
            Boolean(remoteRuntime?.enabled) ||
            isRemoteProjectLocalPath(tab.path);
          const remoteRuntimeKind =
            tab.remote?.sshRuntimeKind ??
            (remoteRuntime?.enabled ? "ssh-command" : "remote-agent-child");
          const RemoteRuntimeIcon = remoteRuntimeKind === "ssh-command" ? Cable : CloudCog;
          const remoteRuntimeTitle =
            remoteHost || remotePath
              ? t(
                  remoteRuntimeKind === "ssh-command"
                    ? "remoteRuntimeActiveQuick"
                    : "remoteRuntimeActiveStandard",
                  {
                    host: remoteHost,
                    path: remotePath,
                  },
                )
              : remoteRuntimeKind === "ssh-command"
                ? t("remoteRuntimeQuick")
                : t("remoteRuntimeStandard");
          const isDragSource = dragIndex === index;
          const isPressing = pressingIndex === index;
          const displayName = formatTabName(tab.name);
          const showLeftIndicator = dropIndex === index && dragIndex !== null && dragIndex > index;
          const showRightIndicator =
            dropIndex === index &&
            dragIndex !== null &&
            dragIndex < index &&
            index < projectTabs.length - 1;
          const isLastDropTarget =
            dropIndex === index &&
            dragIndex !== null &&
            dragIndex < index &&
            index === projectTabs.length - 1;

          return (
            <div
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              role="tab"
              tabIndex={0}
              title={tab.name}
              aria-label={tab.name}
              aria-selected={isActive}
              onClick={() => handleTabClick(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleTabClick(tab.id);
                }
              }}
              onPointerDown={(e) => handlePointerDown(e, index)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onContextMenu={(e) => e.preventDefault()}
              className={`group flex items-center gap-1.5 px-3 py-1 text-[13px] rounded-md transition-all duration-150 relative cursor-pointer select-none shrink-0 ${
                isActive
                  ? "bg-bg-elevated text-text-primary shadow-sm ring-1 ring-border-primary"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover/60"
              } ${isPressing ? "scale-[0.97] opacity-90" : ""} ${
                isDragSource
                  ? "scale-105 shadow-lg ring-2 ring-semantic-accent/50 bg-semantic-accent/10 dark:bg-semantic-accent/5 z-10"
                  : ""
              }`}
            >
              {showLeftIndicator && (
                <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-semantic-accent rounded-full" />
              )}
              <span className={`w-2 h-2 rounded-full ${dotClass} flex-shrink-0`} />
              {hasPermissionPending(knowledge, sessions, sessionStatusMap) && (
                <span className="relative flex-shrink-0" title={t("hasPendingPermissions")}>
                  <MessageCircleQuestion className="w-3 h-3 text-status-warning" />
                  {(() => {
                    const cnt = getProjectPendingCount(sessions, allPending);
                    return cnt > 0 ? (
                      <span className="absolute -top-1 -right-1 min-w-[8px] h-[8px] flex items-center justify-center bg-status-warning rounded-full text-[6px] leading-none text-white font-bold px-[1px]">
                        {cnt > 9 ? "9+" : cnt}
                      </span>
                    ) : null;
                  })()}
                </span>
              )}
              {isRemoteProject && (
                <span
                  data-testid="tab-remote-runtime-indicator"
                  data-runtime-kind={remoteRuntimeKind}
                  className={`inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded border px-1 ${
                    remoteRuntimeKind === "ssh-command"
                      ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
                      : "border-status-info/30 bg-status-info/10 text-status-info"
                  }`}
                  title={remoteRuntimeTitle}
                  aria-label={remoteRuntimeTitle}
                >
                  <RemoteRuntimeIcon className="h-3.5 w-3.5" />
                </span>
              )}
              {sessionIdentity && (
                <span
                  data-testid="tab-session-identity-badge"
                  data-session-kind={sessionIdentity.kind}
                  className={`inline-flex h-5 flex-shrink-0 items-center gap-1 rounded border px-1 text-[10px] font-medium ${sessionIdentityClass(sessionIdentity)}`}
                  title={sessionIdentity.title}
                  aria-label={sessionIdentity.title}
                >
                  {sessionIdentity.kind === "fork" ? (
                    <GitFork className="h-3 w-3" />
                  ) : (
                    <Bot className="h-3 w-3" />
                  )}
                  <span>{sessionIdentity.shortLabel}</span>
                </span>
              )}
              <span className="min-w-[60px] max-w-[220px] whitespace-nowrap overflow-hidden">
                {displayName}
              </span>
              <button
                data-testid={`tab-close-${index}`}
                onClick={(e) => handleCloseClick(e, tab.id)}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1 rounded hover:bg-surface-hover transition-all pointer-events-auto"
                aria-label="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
              {(showRightIndicator || isLastDropTarget) && (
                <span className="absolute right-0 top-1 bottom-1 w-0.5 bg-semantic-accent rounded-full" />
              )}
            </div>
          );
        })}
        <div
          aria-hidden="true"
          className="electrobun-titlebar-drag-fill electrobun-webkit-app-region-drag"
        />
      </div>

      <div className="flex items-center gap-1 px-2 shrink-0 border-l border-border-primary h-full">
        <button
          data-testid="settings-open-btn"
          onClick={() => setSettingsOpen(true)}
          className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors cursor-pointer"
          title={t("settings")}
          aria-label={t("settings")}
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={onAddProject}
          className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors cursor-pointer"
          title={t("addProject")}
          aria-label={t("addProject")}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {closeConfirmTab && (
        <ModalDialog
          title={t("closeProjectTitle")}
          onClose={() => setCloseConfirmTab(null)}
          closeLabel={t("cancel", { ns: "common" })}
          size="sm"
          bodyClassName="px-4 py-4"
          footer={
            closeConfirmTab.runningSessionIds.length > 0 ? (
              <>
                <Button size="md" variant="secondary" onClick={handleKeepRunning}>
                  {t("closeProjectContinue")}
                </Button>
                <Button size="md" variant="danger" onClick={handleStopAndClose}>
                  {t("closeProjectStop")}
                </Button>
              </>
            ) : (
              <>
                <Button size="md" variant="secondary" onClick={() => setCloseConfirmTab(null)}>
                  {t("cancel", { ns: "common" })}
                </Button>
                <Button size="md" variant="danger" onClick={handleKeepRunning}>
                  {t("closeProjectClose")}
                </Button>
              </>
            )
          }
        >
          <p className="text-sm text-text-secondary">
            {closeConfirmTab.runningSessionIds.length > 0
              ? t("closeProjectRunningMessage", { name: closeConfirmTab.name })
              : t("closeProjectIdleMessage", { name: closeConfirmTab.name })}
          </p>
        </ModalDialog>
      )}
    </div>
  );
}

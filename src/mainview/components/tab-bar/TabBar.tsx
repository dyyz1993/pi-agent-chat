import { Plus, X, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/use-session-store";
import { apiClient } from "../../lib/api-client";
import { SettingsPanel } from "../settings/SettingsPanel";
import type { SessionStatus } from "../../types";

function resolveDotClass(
  sessions: { sessionId: string }[],
  statusMap: Record<string, SessionStatus | undefined>,
): string {
  for (const s of sessions) {
    const st = statusMap[s.sessionId];
    if (st === "permission" || st === "retrying") return "bg-status-error";
    if (st === "streaming" || st === "compacting") return "bg-status-warning animate-pulse";
  }
  return "bg-status-success";
}

const LONG_PRESS_MS = 800;
const MOVE_THRESHOLD = 5;

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
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const removeProjectTab = useSessionStore((s) => s.removeProjectTab);
  const reorderProjectTabs = useSessionStore((s) => s.reorderProjectTabs);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const sessionStatusMap = useSessionStore((s) => s.sessionStatusMap);
  const loadSessionsForProject = useSessionStore((s) => s.loadSessionsForProject);
  const fetchAllSessionStatuses = useSessionStore((s) => s.fetchAllSessionStatuses);

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

  // 初始化所有项目的 sessions 和状态
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initAllProjects = async () => {
      const tabsToInit = projectTabs.filter((tab) => !sessionsByProject[tab.path]);

      if (tabsToInit.length === 0) {
        // 所有项目都已加载 sessions，只拉取状态
        await fetchAllSessionStatuses();
        return;
      }

      // 并行加载所有项目的 sessions
      await Promise.all(tabsToInit.map((tab) => loadSessionsForProject(tab.path)));

      // 拉取所有 session 状态
      await fetchAllSessionStatuses();
    };

    initAllProjects().catch((err) => {
      console.error("[TabBar] Failed to initialize projects:", err);
    });
  }, [projectTabs, sessionsByProject, loadSessionsForProject, fetchAllSessionStatuses]);

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
      } catch {
        /* ignore */
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
      className="h-9 bg-surface-dim dark:bg-surface-code border-b border-border-secondary dark:border-border-secondary flex items-center flex-shrink-0"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(2.25rem + env(safe-area-inset-top))",
      }}
    >
      <div
        className={`flex-1 flex items-center gap-0.5 px-1 min-w-0 ${
          dragIndex !== null ? "overflow-x-hidden" : "overflow-x-auto"
        }`}
      >
        {projectTabs.map((tab, index) => {
          const sessions = sessionsByProject[tab.path] || [];
          const dotClass = resolveDotClass(sessions, sessionStatusMap);
          const isActive = activeProjectId === tab.id;
          const isDragSource = dragIndex === index;
          const isPressing = pressingIndex === index;
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
              className={`group flex items-center gap-1.5 px-3 py-1 text-xs rounded-t transition-all duration-150 relative cursor-pointer select-none shrink-0 ${
                isActive
                  ? "bg-bg-elevated dark:bg-surface-code text-text-primary dark:text-text-primary border-t-2 border-t-semantic-accent"
                  : "text-text-secondary dark:text-text-tertiary hover:text-text-primary dark:hover:text-text-primary hover:bg-surface-hover/50 dark:hover:bg-surface-dim/50"
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
              <span className="min-w-[60px] whitespace-nowrap">{tab.name}</span>
              <button
                data-testid={`tab-close-${index}`}
                onClick={(e) => handleCloseClick(e, tab.id)}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-hover transition-all pointer-events-auto"
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
      </div>

      <div className="flex items-center gap-0.5 px-2 shrink-0 border-l border-border-secondary dark:border-border-secondary h-full">
        <button
          data-testid="settings-open-btn"
          onClick={() => setSettingsOpen(true)}
          className="p-1 rounded text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-dim transition-colors cursor-pointer"
          title={t("settings")}
          aria-label={t("settings")}
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={onAddProject}
          className="p-1 rounded text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-dim transition-colors cursor-pointer"
          title={t("addProject")}
          aria-label={t("addProject")}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {closeConfirmTab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCloseConfirmTab(null);
          }}
        >
          <div
            className="bg-bg-elevated dark:bg-surface-dim border border-border-secondary dark:border-border-secondary rounded-lg shadow-2xl p-4 min-w-[300px] max-w-[400px]"
            role="dialog"
            aria-modal="true"
            aria-label={t("closeProjectTitle")}
          >
            <h3 className="text-sm font-semibold text-text-primary dark:text-text-primary mb-2">
              {t("closeProjectTitle")}
            </h3>
            <p className="text-xs text-text-secondary dark:text-text-secondary mb-4">
              {closeConfirmTab.runningSessionIds.length > 0
                ? t("closeProjectRunningMessage", { name: closeConfirmTab.name })
                : t("closeProjectIdleMessage", { name: closeConfirmTab.name })}
            </p>
            <div className="flex justify-end gap-2">
              {closeConfirmTab.runningSessionIds.length > 0 ? (
                <>
                  <button
                    className="px-3 py-1.5 text-xs bg-surface-hover dark:bg-surface-hover hover:bg-surface-hover dark:hover:bg-surface-hover rounded transition-colors text-text-primary dark:text-text-primary"
                    onClick={handleKeepRunning}
                  >
                    {t("closeProjectContinue")}
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs bg-status-error hover:bg-status-error/80 rounded transition-colors text-white"
                    onClick={handleStopAndClose}
                  >
                    {t("closeProjectStop")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="px-3 py-1.5 text-xs bg-surface-hover dark:bg-surface-hover hover:bg-surface-hover dark:hover:bg-surface-hover rounded transition-colors text-text-primary dark:text-text-primary"
                    onClick={() => setCloseConfirmTab(null)}
                  >
                    {t("cancel", { ns: "common" })}
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs bg-status-error hover:bg-status-error/80 rounded transition-colors text-white"
                    onClick={handleKeepRunning}
                  >
                    {t("closeProjectClose")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { Plus, X, Settings } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/use-session-store";
import { SettingsPanel } from "../settings/SettingsPanel";
import type { SessionStatus } from "../../types";

function resolveDotClass(
  sessions: { sessionId: string }[],
  statusMap: Record<string, SessionStatus | undefined>,
): string {
  for (const s of sessions) {
    const st = statusMap[s.sessionId];
    if (st === "permission" || st === "retrying") return "bg-red-400";
    if (st === "streaming" || st === "compacting") return "bg-yellow-400 animate-pulse";
  }
  return "bg-green-400";
}

const LONG_PRESS_MS = 300;

export function TabBar({ onAddProject }: { onAddProject: () => void }) {
  const { t } = useTranslation("sidebar");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const removeProjectTab = useSessionStore((s) => s.removeProjectTab);
  const reorderProjectTabs = useSessionStore((s) => s.reorderProjectTabs);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const sessionStatusMap = useSessionStore((s) => s.sessionStatusMap);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = useRef(false);
  const pressStartPos = useRef({ x: 0, y: 0 });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;
    pressStartPos.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;

    longPressTimer.current = setTimeout(() => {
      isDragging.current = true;
      setDragIndex(index);
      setDropIndex(index);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, LONG_PRESS_MS);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current || dragIndex === null) return;

      const containerRect = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
      if (!containerRect) return;

      let newDropIndex = dragIndex;
      for (let i = 0; i < tabRefs.current.length; i++) {
        const el = tabRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (e.clientX >= midX) {
          newDropIndex = i;
        }
      }

      if (newDropIndex !== dropIndex) {
        setDropIndex(newDropIndex);
      }
    },
    [dragIndex, dropIndex],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent, _index: number) => {
      cancelLongPress();

      if (
        isDragging.current &&
        dragIndex !== null &&
        dropIndex !== null &&
        dragIndex !== dropIndex
      ) {
        reorderProjectTabs(dragIndex, dropIndex);
      }

      isDragging.current = false;
      setDragIndex(null);
      setDropIndex(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* pointer capture may already be released */
      }
    },
    [cancelLongPress, dragIndex, dropIndex, reorderProjectTabs],
  );

  const handlePointerCancel = useCallback(() => {
    cancelLongPress();
    isDragging.current = false;
    setDragIndex(null);
    setDropIndex(null);
  }, [cancelLongPress]);

  const handleTabClick = (tabId: string) => {
    if (isDragging.current) return;
    if (activeProjectId === tabId) return;
    setActiveProject(tabId);
  };

  const handleCloseClick = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    e.preventDefault();
    removeProjectTab(tabId);
  };

  return (
    <div
      data-testid="tab-bar"
      className="h-9 bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center flex-shrink-0"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(2.25rem + env(safe-area-inset-top))",
      }}
    >
      {/* Left: scrollable tabs */}
      <div className="flex-1 flex items-center gap-0.5 px-1 overflow-x-auto min-w-0">
        {projectTabs.map((tab, index) => {
          const sessions = sessionsByProject[tab.path] || [];
          const dotClass = resolveDotClass(sessions, sessionStatusMap);
          const isActive = activeProjectId === tab.id;
          const isDragSource = dragIndex === index;
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
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              onClick={() => handleTabClick(tab.id)}
              onPointerDown={(e) => handlePointerDown(e, index)}
              onPointerMove={handlePointerMove}
              onPointerUp={(e) => handlePointerUp(e, index)}
              onPointerCancel={handlePointerCancel}
              className={`group flex items-center gap-1.5 px-3 py-1 text-xs rounded-t transition-colors relative cursor-pointer select-none ${
                isActive
                  ? "bg-white dark:bg-gray-950 text-gray-900 dark:text-white border-t-2 border-t-indigo-500"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
              } ${isDragSource ? "opacity-40 scale-95" : ""}`}
              style={{ touchAction: "none" }}
            >
              {showLeftIndicator && (
                <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-indigo-400 rounded-full" />
              )}
              <span className={`w-2 h-2 rounded-full ${dotClass} flex-shrink-0`} />
              <span className="min-w-[60px]">{tab.name}</span>
              <span
                data-testid={`tab-close-${index}`}
                onClick={(e) => handleCloseClick(e, tab.id)}
                onMouseDown={(e) => e.stopPropagation()}
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-700 transition-all pointer-events-auto"
              >
                <X className="w-3 h-3" />
              </span>
              {(showRightIndicator || isLastDropTarget) && (
                <span className="absolute right-0 top-1 bottom-1 w-0.5 bg-indigo-400 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right: fixed action buttons */}
      <div className="flex items-center gap-0.5 px-2 shrink-0 border-l border-gray-200 dark:border-gray-700 h-full">
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-1 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          title={t("settings")}
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={onAddProject}
          className="p-1 rounded text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          title={t("addProject")}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

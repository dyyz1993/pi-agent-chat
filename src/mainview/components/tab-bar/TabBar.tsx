import { Plus, X } from "lucide-react";
import { useSessionStore } from "../../stores/use-session-store";
import type { SessionStatus } from "../../types";

function resolveDotClass(sessions: { sessionId: string }[], statusMap: Record<string, SessionStatus | undefined>): string {
  for (const s of sessions) {
    const st = statusMap[s.sessionId];
    if (st === "permission") return "bg-red-400";
    if (st === "streaming" || st === "compacting") return "bg-yellow-400 animate-pulse";
  }
  return "bg-green-400";
}

export function TabBar({ onAddProject }: { onAddProject: () => void }) {
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const removeProjectTab = useSessionStore((s) => s.removeProjectTab);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const sessionStatusMap = useSessionStore((s) => s.sessionStatusMap);

  const handleTabClick = (tabId: string) => {
    // 如果已经选中，不做任何操作
    if (activeProjectId === tabId) return;
    setActiveProject(tabId);
  };

  const handleCloseClick = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    e.preventDefault();
    removeProjectTab(tabId);
  };

  return (
    <div className="h-9 bg-gray-900 border-b border-gray-800 flex items-center px-1 gap-0.5 flex-shrink-0 overflow-x-auto">
      {projectTabs.map((tab) => {
        const sessions = sessionsByProject[tab.path] || [];
        const dotClass = resolveDotClass(sessions, sessionStatusMap);
        const isActive = activeProjectId === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={`group flex items-center gap-1.5 px-3 py-1 text-xs rounded-t transition-colors relative cursor-pointer ${
              isActive
                ? "bg-gray-950 text-white border-t-2 border-t-indigo-500"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${dotClass} flex-shrink-0`} />
            <span className="truncate max-w-[120px]">{tab.name}</span>
            <span
              onClick={(e) => handleCloseClick(e, tab.id)}
              onMouseDown={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700 transition-all pointer-events-auto"
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        );
      })}
      <button
        onClick={onAddProject}
        className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors cursor-pointer"
        title="添加项目"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

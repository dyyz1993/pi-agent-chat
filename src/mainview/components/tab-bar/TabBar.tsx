import { Plus, X } from "lucide-react";
import { useSessionStore } from "../../stores/use-session-store";

interface TabBarProps {
  onAddProject: () => void;
}

export function TabBar({ onAddProject }: TabBarProps) {
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const removeProjectTab = useSessionStore((s) => s.removeProjectTab);

  return (
    <div className="h-9 bg-gray-900 border-b border-gray-800 flex items-center px-1 gap-0.5 flex-shrink-0 overflow-x-auto">
      {projectTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveProject(tab.id)}
          className={`group flex items-center gap-1.5 px-3 py-1 text-xs rounded-t transition-colors relative ${
            activeProjectId === tab.id
              ? "bg-gray-950 text-white border-t-2 border-t-indigo-500"
              : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
          }`}
        >
          <span className="truncate max-w-[120px]">{tab.name}</span>
          <span
            onClick={(e) => { e.stopPropagation(); removeProjectTab(tab.id); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700 transition-all"
          >
            <X className="w-3 h-3" />
          </span>
        </button>
      ))}
      <button
        onClick={onAddProject}
        className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
        title="添加项目"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

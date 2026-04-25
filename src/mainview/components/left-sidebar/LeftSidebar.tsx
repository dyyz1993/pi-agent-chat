import { Pin, Plus, PanelLeft } from "lucide-react";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useSessionStore } from "../../stores/use-session-store";
import { SessionSidebar } from "../session-sidebar/SessionSidebar";

interface LeftSidebarProps {
  width: number;
  overlay: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
}

export function LeftSidebar({ width, overlay, onResizeStart }: LeftSidebarProps) {
  const sessionPanel = useLayoutStore((s) => s.sessionPanel);
  const toggleSession = useLayoutStore((s) => s.toggleSession);

  const isPinned = sessionPanel === "pinned";
  const isMobile = useLayoutStore((s) => s.breakpoint) === "mobile";
  const hideSession = useLayoutStore((s) => s.hideSession);

  return (
    <div
      className={`flex flex-col bg-gray-900 border-r border-gray-800 overflow-hidden z-20 ${
        overlay ? "animate-slide-in-left shadow-xl shadow-black/30 will-change-transform" : ""
      }`}
      style={
        overlay
          ? { position: "absolute", left: 0, top: 0, bottom: 0, width }
          : { width }
      }
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/80 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-200 tracking-wide">会话</span>
          <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-full font-mono">
            {useSessionCount()}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); useSessionStore.getState().createNewSession(); }}
            className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
            title="新建会话"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {isMobile && overlay && (
            <button
              onClick={(e) => { e.stopPropagation(); hideSession(); }}
              className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
              title="关闭"
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
          )}
          {!isMobile && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleSession(); }}
              className={`p-1 rounded transition-colors ${isPinned ? "text-indigo-400" : "text-gray-600 hover:text-gray-400"}`}
              title={isPinned ? "取消固定" : "固定面板"}
            >
              <Pin className="w-3.5 h-3.5" fill={isPinned ? "currentColor" : "none"} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <SessionSidebar />
      </div>

      {!overlay && (
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-10"
          onMouseDown={onResizeStart}
          style={{ position: "absolute", right: -1 }}
        />
      )}
    </div>
  );
}

function useSessionCount(): number {
  const sessions = useSessionStore((s) => {
    const tab = s.projectTabs.find((t) => t.id === s.activeProjectId);
    if (!tab) return 0;
    return (s.sessionsByProject[tab.path] || []).length;
  });
  return sessions;
}
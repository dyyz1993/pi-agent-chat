import { Pin, Plus, PanelLeft } from "lucide-react";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useGitStore } from "../../stores/use-git-store";
import { SessionSidebar } from "../session-sidebar/SessionSidebar";
import { SidebarBottomControls } from "./SidebarBottomControls";

interface LeftSidebarProps {
  width: number;
  overlay: boolean;
}

export function LeftSidebar({ width, overlay }: LeftSidebarProps) {
  const sessionPanel = useLayoutStore((s) => s.sessionPanel);
  const toggleSession = useLayoutStore((s) => s.toggleSession);

  const isPinned = sessionPanel === "pinned";
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
            onClick={(e) => {
              e.stopPropagation();
              const state = useSessionStore.getState();
              const worktrees = useGitStore.getState().worktrees;
              const activeSession = state.activeSessionId
                ? Object.values(state.sessionsByProject)
                    .flat()
                    .find((s) => s.sessionId === state.activeSessionId)
                : null;
              const workspace = activeSession
                ? worktrees.find((wt) => activeSession.projectPath.startsWith(wt.path))
                : null;
              state.createNewSession(workspace?.path);
            }}
            className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
            title="新建会话"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); toggleSession(); }}
            className={`p-1 rounded transition-colors max-sm:hidden ${isPinned ? "text-indigo-400" : "text-gray-600 hover:text-gray-400"}`}
            title={isPinned ? "取消固定" : "固定面板"}
          >
            <Pin className="w-3.5 h-3.5" fill={isPinned ? "currentColor" : "none"} />
          </button>
          {overlay && (
            <button
              onClick={(e) => { e.stopPropagation(); hideSession(); }}
              className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
              title="关闭面板"
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <SessionSidebar />
      </div>

      <SidebarBottomControls />
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
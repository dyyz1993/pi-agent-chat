import { Pin } from "lucide-react";
import { useLayoutStore } from "../../layouts/use-layout-store";
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

  return (
    <div
      className={`flex flex-col bg-gray-900 border-r border-gray-800 overflow-hidden z-20 ${
        overlay ? "animate-slide-in-left shadow-xl shadow-black/30" : ""
      }`}
      style={
        overlay
          ? { position: "absolute", left: 0, top: 0, bottom: 0, width }
          : { width }
      }
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header + pin */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-medium text-gray-300">会话</span>
        <button
          onClick={(e) => { e.stopPropagation(); toggleSession(); }}
          className={`p-1 rounded transition-colors ${isPinned ? "text-indigo-400" : "text-gray-600 hover:text-gray-400"}`}
          title={isPinned ? "取消固定" : "固定面板"}
        >
          <Pin className="w-3.5 h-3.5" fill={isPinned ? "currentColor" : "none"} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <SessionSidebar hideOuterHeader />
      </div>

      {/* Resize handle — only when pinned */}
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

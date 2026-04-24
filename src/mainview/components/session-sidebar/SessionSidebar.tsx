import { Plus, Search } from "lucide-react";
import { useSessionStore } from "../../stores/use-session-store";

const EMPTY: never[] = [];

interface SessionSidebarProps {
  hideOuterHeader?: boolean;
}

export function SessionSidebar({ hideOuterHeader }: SessionSidebarProps) {
  const handleNewSession = () => {
    useSessionStore.getState().setActiveSession(null);
  };

  if (!hideOuterHeader) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-300">会话</span>
          <button onClick={handleNewSession} className="p-1 rounded hover:bg-gray-800 text-gray-400">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <SessionList />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800/50 rounded text-[11px] text-gray-500">
          <Search className="w-3 h-3 shrink-0" />
          <input placeholder="搜索会话..." className="bg-transparent outline-none flex-1 min-w-0" />
        </div>
      </div>

      <div className="px-2 pb-1">
        <button
          onClick={handleNewSession}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
        >
          <Plus className="w-3 h-3" />
          新建会话
        </button>
      </div>

      <SessionList />
    </div>
  );
}

function SessionList() {
  const sessions = useSessionStore((s) => {
    const tab = s.projectTabs.find((t) => t.id === s.activeProjectId);
    if (!tab) return EMPTY;
    return s.sessionsByProject[tab.path] || EMPTY;
  });
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const loading = useSessionStore((s) => s.loading);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-xs p-4">
        <div className="w-3 h-3 border-2 border-gray-600 border-t-transparent rounded-full animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  if (sessions.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-gray-600 text-xs p-4 text-center">暂无会话</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto px-1 space-y-0.5">
      {sessions.map((sess) => (
        <button
          key={sess.sessionId}
          onClick={() => setActiveSession(sess.sessionId)}
          className={`w-full text-left px-2 py-1.5 rounded text-[11px] transition-colors ${
            activeSessionId === sess.sessionId
              ? "bg-indigo-600/20 text-indigo-300"
              : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
          }`}
        >
          <div className="truncate">{sess.name || sess.firstMessage || "空会话"}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            {sess.messageCount} 条消息 · {new Date(sess.updatedAt).toLocaleDateString()}
          </div>
        </button>
      ))}
    </div>
  );
}

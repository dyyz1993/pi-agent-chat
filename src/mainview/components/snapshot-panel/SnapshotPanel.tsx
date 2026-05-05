import { useEffect } from "react";
import { Camera, RotateCcw, RefreshCw, File } from "lucide-react";
import { useSnapshotStore } from "../../stores/use-snapshot-store";
import { useSessionStore } from "../../stores/use-session-store";

export function SnapshotPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const snapshotsBySession = useSnapshotStore((s) => s.snapshotsBySession);
  const loading = useSnapshotStore((s) => s.loading);
  const fetchSnapshots = useSnapshotStore((s) => s.fetchSnapshots);
  const rollback = useSnapshotStore((s) => s.rollback);
  const unrevert = useSnapshotStore((s) => s.unrevert);

  const sessionId = activeSessionId ?? "";
  const snapshots = sessionId ? (snapshotsBySession[sessionId] ?? []) : [];

  useEffect(() => {
    if (sessionId) {
      fetchSnapshots(sessionId);
    }
  }, [sessionId, fetchSnapshots]);

  function formatTime(ts: string): string {
    return new Date(ts).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const fileCount = (snap: (typeof snapshots)[number]) => Object.keys(snap.files).length;

  const diffSummary = (snap: (typeof snapshots)[number]) => {
    const { added, modified, deleted } = snap.diff;
    const parts: string[] = [];
    if (added.length) parts.push(`+${added.length}`);
    if (modified.length) parts.push(`~${modified.length}`);
    if (deleted.length) parts.push(`-${deleted.length}`);
    return parts.join(" ");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Camera className="w-3.5 h-3.5" />
          <span>快照 ({snapshots.length})</span>
        </div>
        <button
          onClick={() => sessionId && fetchSnapshots(sessionId)}
          disabled={!sessionId || loading}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-30"
          title="刷新"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!sessionId && (
          <div className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-600">
            没有活跃会话
          </div>
        )}

        {sessionId && snapshots.length === 0 && !loading && (
          <div className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-600">
            暂无快照
          </div>
        )}

        {snapshots.map((snap) => (
          <div
            key={snap.id}
            className={`px-3 py-2 border-b border-gray-200/50 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/40 transition-colors ${
              snap.rolledBack ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {snap.rolledBack ? (
                    <RotateCcw className="w-3 h-3 text-amber-400 shrink-0" />
                  ) : (
                    <Camera className="w-3 h-3 text-indigo-400 shrink-0" />
                  )}
                  <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
                    Step #{snap.stepIndex}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500 dark:text-gray-500">
                  <span>{formatTime(snap.timestamp)}</span>
                  <span className="flex items-center gap-0.5">
                    <File className="w-2.5 h-2.5" />
                    {fileCount(snap)}
                  </span>
                  <span>{diffSummary(snap)}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {snap.rolledBack ? (
                  <button
                    onClick={() => unrevert(sessionId, snap.id)}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-amber-400 hover:text-amber-300 transition-colors"
                    title="取消回滚"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    onClick={() => rollback(sessionId, snap.id)}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    title="回滚到此快照"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

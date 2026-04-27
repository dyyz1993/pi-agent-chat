import { memo, useState, useCallback } from "react";
import { RotateCcw, CheckCircle2, Plus, Pencil, Minus, ChevronDown } from "lucide-react";
import type { SnapshotInfo } from "../../types";

interface SnapshotToolbarProps {
  snapshot: SnapshotInfo;
  sessionId: string;
  onRollback?: (snapshotId: string, selectedFiles: string[]) => void;
}

export const SnapshotToolbar = memo(function SnapshotToolbar({ snapshot, onRollback }: SnapshotToolbarProps) {
  const [restored, setRestored] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleRollback = useCallback(() => {
    if (onRollback) {
      const allFiles = [
        ...snapshot.diff.added,
        ...snapshot.diff.modified,
        ...snapshot.diff.deleted,
      ];
      onRollback(snapshot.id, allFiles);
      setRestored(true);
    }
  }, [onRollback, snapshot.id, snapshot.diff]);

  const totalFiles = snapshot.diff.added.length + snapshot.diff.modified.length + snapshot.diff.deleted.length;

  return (
    <div
      className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] text-gray-400 transition-colors ${
        restored
          ? "border-green-500/30 bg-green-950/10 border"
          : "bg-gray-900/85 border border-indigo-500/10 hover:border-indigo-500/25 hover:bg-gray-900/95"
      }`}
    >
      <span className="inline-flex items-center justify-center w-5 h-4 rounded-full text-[10px] font-bold bg-purple-600/15 text-purple-400 border border-purple-500/25">
        {snapshot.stepIndex}
      </span>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 min-w-0 flex-1"
      >
        {snapshot.diff.added.length > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-green-400 bg-green-500/10 border-green-500/20 border">
            <Plus className="w-3 h-3" />
            {snapshot.diff.added.length}
          </span>
        )}
        {snapshot.diff.modified.length > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-yellow-400 bg-yellow-500/10 border-yellow-500/20 border">
            <Pencil className="w-3 h-3" />
            {snapshot.diff.modified.length}
          </span>
        )}
        {snapshot.diff.deleted.length > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-red-400 bg-red-500/10 border-red-500/20 border">
            <Minus className="w-3 h-3" />
            {snapshot.diff.deleted.length}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 text-gray-600 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      <span className="text-[10px] text-gray-600 font-mono hidden lg:inline truncate max-w-[100px]">
        {snapshot.treeHash.slice(0, 8)}
      </span>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {restored ? (
          <span className="w-5 h-5 rounded flex items-center justify-center text-green-400" title="已回滚">
            <CheckCircle2 className="w-3.5 h-3.5" />
          </span>
        ) : (
          <button
            onClick={handleRollback}
            className="w-5 h-5 rounded flex items-center justify-center hover:bg-yellow-500/10 hover:text-yellow-400 text-gray-500 transition-colors"
            title={`回滚快照 #${snapshot.stepIndex} (${totalFiles} 个文件)`}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="absolute left-0 right-0 top-full mt-1 p-2 rounded-lg bg-gray-900 border border-gray-800 shadow-xl z-10 min-w-[280px]">
          <div className="space-y-0.5">
            {snapshot.diff.added.map((f) => (
              <div key={f} className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-green-400/80">
                <Plus className="w-3 h-3 shrink-0" />
                <span className="font-mono truncate">{f}</span>
              </div>
            ))}
            {snapshot.diff.modified.map((f) => (
              <div key={f} className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-yellow-400/80">
                <Pencil className="w-3 h-3 shrink-0" />
                <span className="font-mono truncate">{f}</span>
              </div>
            ))}
            {snapshot.diff.deleted.map((f) => (
              <div key={f} className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-red-400/80">
                <Minus className="w-3 h-3 shrink-0" />
                <span className="font-mono truncate">{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

import { useState, useCallback, useEffect, useRef } from "react";
import { X, Check, Zap, Plus, Pencil, Minus, Loader2 } from "lucide-react";
import type { SnapshotInfo } from "../../types";

interface RollbackModalProps {
  open: boolean;
  snapshot: SnapshotInfo | null;
  sessionId: string;
  onClose: () => void;
  onConfirm: (snapshotId: string, selectedFiles: string[]) => Promise<void>;
}

type TabMode = "select" | "quick";

type FileItem = {
  path: string;
  status: "added" | "modified" | "deleted";
};

function buildFileList(snapshot: SnapshotInfo): FileItem[] {
  return [
    ...snapshot.diff.added.map((p) => ({ path: p, status: "added" as const })),
    ...snapshot.diff.modified.map((p) => ({ path: p, status: "modified" as const })),
    ...snapshot.diff.deleted.map((p) => ({ path: p, status: "deleted" as const })),
  ];
}

const STATUS_CONFIG: Record<FileItem["status"], { label: string; cls: string; Icon: typeof Plus }> = {
  added: { label: "新增", cls: "text-green-400 bg-green-500/10 border-green-500/20", Icon: Plus },
  modified: { label: "修改", cls: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20", Icon: Pencil },
  deleted: { label: "删除", cls: "text-red-400 bg-red-500/10 border-red-500/20", Icon: Minus },
};

export function RollbackModal({ open, snapshot, sessionId: _sessionId, onClose, onConfirm }: RollbackModalProps) {
  const [tab, setTab] = useState<TabMode>("select");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [executing, setExecuting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedFiles(new Set());
    setTab("select");
    setExecuting(false);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (snapshot) {
      const files = buildFileList(snapshot);
      setSelectedFiles(new Set(files.map((f) => f.path)));
    }
  }, [snapshot]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const toggleFile = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!snapshot) return;
    setSelectedFiles(new Set(buildFileList(snapshot).map((f) => f.path)));
  }, [snapshot]);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const switchTab = useCallback(
    (t: TabMode) => {
      setTab(t);
      selectAll();
    },
    [selectAll],
  );

  const handleConfirm = useCallback(async () => {
    if (!snapshot || executing) return;
    setExecuting(true);
    try {
      await onConfirm(snapshot.id, Array.from(selectedFiles));
      onClose();
    } catch {
      setExecuting(false);
    }
  }, [snapshot, selectedFiles, executing, onConfirm, onClose]);

  if (!open || !snapshot) return null;

  const fileList = buildFileList(snapshot);
  const totalFiles = fileList.length;
  const selectedCount = selectedFiles.size;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} className="w-[520px] max-h-[70vh] bg-gray-900 border border-indigo-500/20 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-4 rounded-full text-[10px] font-bold bg-purple-600/15 text-purple-400 border border-purple-500/25">
              {snapshot.stepIndex}
            </span>
            <span className="text-xs font-medium text-gray-200">回滚快照 #{snapshot.stepIndex}</span>
            <span className="text-[10px] text-gray-600 font-mono">{snapshot.treeHash.slice(0, 8)}</span>
          </div>
          <button onClick={onClose} className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex gap-0.5 p-0.5 bg-gray-800/60 rounded-lg mx-4 mt-3 shrink-0">
          <button
            onClick={() => switchTab("select")}
            className={`flex-1 py-1.5 rounded-md text-[11px] cursor-pointer transition-colors ${
              tab === "select" ? "bg-indigo-500/15 text-indigo-300 font-semibold" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            选择文件
          </button>
          <button
            onClick={() => switchTab("quick")}
            className={`flex-1 py-1.5 rounded-md text-[11px] cursor-pointer transition-colors ${
              tab === "quick" ? "bg-indigo-500/15 text-indigo-300 font-semibold" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            快速整轮回滚
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-3 min-h-0">
          {tab === "select" ? (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2 text-[10px]">
                  <button onClick={selectAll} className="text-indigo-400 hover:text-indigo-300 cursor-pointer">全选</button>
                  <span className="text-gray-600">/</span>
                  <button onClick={deselectAll} className="text-gray-500 hover:text-gray-300 cursor-pointer">取消全选</button>
                </div>
                <span className="text-[10px] text-gray-500">{selectedCount}/{totalFiles}</span>
              </div>
              <div className="space-y-0.5">
                {fileList.map((item) => {
                  const checked = selectedFiles.has(item.path);
                  const cfg = STATUS_CONFIG[item.status];
                  const StatusIcon = cfg.Icon;
                  return (
                    <div
                      key={item.path}
                      onClick={() => toggleFile(item.path)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                        checked ? "bg-indigo-500/10 border border-indigo-500/30" : "hover:bg-gray-800 border border-transparent"
                      }`}
                    >
                      <span
                        className={`w-[15px] h-[15px] rounded border flex items-center justify-center shrink-0 transition-colors ${
                          checked ? "bg-indigo-500 border-indigo-500" : "border-gray-600 bg-transparent"
                        }`}
                      >
                        {checked && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                      </span>
                      <span className="font-mono text-[11px] text-gray-300 truncate flex-1 min-w-0">{item.path}</span>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] ${cfg.cls} border shrink-0`}>
                        <StatusIcon className="w-2.5 h-2.5" />
                        {cfg.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-center">
              <div className="w-full p-6 rounded-lg border border-dashed border-yellow-500/25 bg-yellow-500/5 flex flex-col items-center gap-3 text-center">
                <div className="w-10 h-10 rounded-full bg-yellow-500/10 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <div className="text-sm font-medium text-yellow-400">整轮回滚</div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    将回滚全部 {totalFiles} 个文件到快照 #{snapshot.stepIndex} 的状态
                  </div>
                </div>
                <div className="text-[10px] text-yellow-500/60 bg-yellow-500/8 px-3 py-1.5 rounded-md">
                  此操作不可撤销，请确认后执行
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-800 bg-gray-900/50 shrink-0">
          <button onClick={onClose} disabled={executing} className="text-gray-400 hover:text-gray-200 hover:bg-gray-800 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50">
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={executing || selectedCount === 0}
            className="bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 hover:bg-yellow-500/25 px-4 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {executing && <Loader2 className="w-3 h-3 animate-spin" />}
            回滚选中 ({selectedCount} 个文件)
          </button>
        </div>
      </div>
    </div>
  );
}

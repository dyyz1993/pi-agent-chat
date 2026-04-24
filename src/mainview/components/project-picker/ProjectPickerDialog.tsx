import { useState, useEffect, useCallback } from "react";
import {
  X,
  FolderOpen,
  Folder,
  Search,
  ChevronRight,
  Home,
  HardDrive,
  Star,
  Trash2,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import type { RecentProject } from "../../types";

interface ProjectPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string, name: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function ProjectPickerDialog({ open, onClose, onSelect }: ProjectPickerDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      return;
    }
    setLoading(true);
    apiClient
      .call("project.listRecent", {})
      .then((result) => {
        setRecents((result.projects as RecentProject[]) || []);
      })
      .catch(() => setRecents([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = recents.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelect = useCallback(
    (project: RecentProject) => {
      onSelect(project.path, project.name);
      onClose();
    },
    [onClose, onSelect]
  );

  const handleRemove = useCallback(async (e: React.MouseEvent, projectPath: string) => {
    e.stopPropagation();
    try {
      await apiClient.call("project.removeRecent", { projectPath });
      setRecents((prev) => prev.filter((r) => r.path !== projectPath));
    } catch {}
  }, []);

  if (!open) return null;

  const projectList = (projects: RecentProject[], mobile?: boolean) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2">
          <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
          加载中...
        </div>
      );
    }
    if (projects.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
          <FolderOpen className={mobile ? "w-10 h-10 opacity-30" : "w-8 h-8 opacity-30"} />
          <span className="text-sm">{searchQuery ? "没有匹配的项目" : "暂无最近打开的项目"}</span>
        </div>
      );
    }
    return projects.map((proj) => (
      <div
        key={proj.path}
        role="button"
        tabIndex={0}
        onClick={() => handleSelect(proj)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSelect(proj); }}
        className={`w-full flex items-center gap-3 text-left group transition-colors cursor-pointer ${
          mobile
            ? "px-4 py-3.5 rounded-xl active:bg-gray-800/80"
            : "px-3 py-2.5 rounded-lg hover:bg-gray-800/60"
        }`}
      >
        <Folder className={mobile ? "w-5 h-5 text-indigo-400/70 shrink-0" : "w-4 h-4 text-indigo-400/70 shrink-0"} />
        <div className="flex-1 min-w-0">
          <div className={mobile ? "text-sm font-medium text-gray-200 truncate" : "text-[12px] font-medium text-gray-200 truncate"}>
            {proj.name}
          </div>
          <div className={mobile ? "text-[11px] text-gray-500 truncate" : "text-[10px] text-gray-500 truncate"}>
            {proj.path}
          </div>
          {proj.sessionCount > 0 && (
            <div className="text-[10px] text-gray-600">{proj.sessionCount} 个会话</div>
          )}
        </div>
        <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(proj.lastOpened)}</span>
        <button
          onClick={(e) => handleRemove(e, proj.path)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-600/20 text-gray-600 hover:text-red-400 transition-all shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    ));
  };

  return (
    <>
      {/* Mobile view */}
      <div className="md:hidden fixed inset-0 z-[100] bg-gray-950 flex flex-col animate-slide-in-up">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-white">选择项目</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-800 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2.5 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索项目..."
              className="w-full pl-9 pr-4 py-2.5 bg-gray-800/60 border border-gray-700/50 rounded-xl text-sm text-gray-200 placeholder:text-gray-500 outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
          {projectList(filtered, true)}
        </div>
      </div>

      {/* Desktop view */}
      <div className="hidden md:flex fixed inset-0 z-[100] items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        <div className="relative w-full max-w-4xl max-h-[85vh] mx-4 bg-gray-900 rounded-xl border border-gray-700/50 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
            <h2 className="text-sm font-semibold text-white">选择项目</h2>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Left — Browse */}
            <div className="w-[45%] min-w-[260px] border-r border-gray-800 flex flex-col">
              <div className="px-4 py-3 border-b border-gray-800">
                <p className="text-xs font-medium text-gray-300 mb-0.5">浏览文件夹</p>
                <p className="text-[10px] text-gray-500">选择电脑上的任意文件夹</p>
              </div>

              <button
                onClick={() => alert("浏览文件夹功能在桌面端可用")}
                className="mx-4 mt-3 mb-2 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-lg text-sm text-indigo-300 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                浏览文件夹
              </button>

              <div className="px-4 mt-2 space-y-1">
                {[{ icon: Home, label: "主目录" }, { icon: HardDrive, label: "文档" }, { icon: Star, label: "收藏夹" }].map(({ icon: Icon, label }) => (
                  <button key={label} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 rounded-lg transition-colors">
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    <ChevronRight className="w-3 h-3 ml-auto opacity-40" />
                  </button>
                ))}
              </div>
            </div>

            {/* Right — Recent */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-xs font-medium text-gray-300">最近的文件夹</p>
                  <p className="text-[10px] text-gray-500">{filtered.length} 个文件夹可用</p>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索..."
                    className="pl-7 pr-3 py-1 w-36 bg-gray-800/50 border border-gray-700/50 rounded-md text-[11px] text-gray-300 placeholder:text-gray-600 outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
                {projectList(filtered)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

import { useState, useEffect, useCallback } from "react";
import {
  X,
  FolderOpen,
  Folder,
  Search,
  ChevronRight,
  ChevronLeft,
  Home,
  FileText,
  Loader2,
  Check,
} from "lucide-react";
import { apiClient } from "../../lib/api-client";
import type { MergedProject, ConfiguredPath } from "../../types";

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

type ViewMode = "list" | "browse";

export function ProjectPickerDialog({ open, onClose, onSelect }: ProjectPickerDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [projects, setProjects] = useState<MergedProject[]>([]);
  const [configuredPaths, setConfiguredPaths] = useState<ConfiguredPath[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [currentBrowsePath, setCurrentBrowsePath] = useState<string | null>(null);
  const [browseContents, setBrowseContents] = useState<Array<{ name: string; path: string; type: "file" | "directory" }>>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseHistory, setBrowseHistory] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setViewMode("list");
      setCurrentBrowsePath(null);
      setBrowseHistory([]);
      return;
    }
    setLoading(true);
    Promise.all([
      apiClient.call("project.listAllProjects", {}),
      apiClient.call("project.listConfiguredPaths", {}),
    ])
      .then(([projectsResult, pathsResult]) => {
        setProjects((projectsResult.projects as MergedProject[]) || []);
        setConfiguredPaths((pathsResult.paths as ConfiguredPath[]) || []);
      })
      .catch(() => {
        setProjects([]);
        setConfiguredPaths([]);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const handleBrowsePath = useCallback(async (path: string, isInitial?: boolean) => {
    setBrowseLoading(true);
    setCurrentBrowsePath(path);
    if (!isInitial) {
      setBrowseHistory((prev) => [...prev, path]);
    } else {
      setBrowseHistory([path]);
    }
    try {
      const result = await apiClient.call("file.listDir", { path });
      setBrowseContents((result.entries as Array<{ name: string; path: string; type: "file" | "directory" }>) || []);
    } catch {
      setBrowseContents([]);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const handleSelectProject = useCallback(
    (project: MergedProject) => {
      onSelect(project.path, project.name);
      onClose();
    },
    [onClose, onSelect]
  );

  const handleSelectBrowseItem = useCallback(
    (item: { name: string; path: string; type: "file" | "directory" }, e?: React.MouseEvent) => {
      if (item.type === "directory") {
        if (e?.detail === 2) {
          onSelect(item.path, item.name);
          onClose();
        } else {
          handleBrowsePath(item.path);
        }
      } else {
        onSelect(item.path, item.name);
        onClose();
      }
    },
    [onClose, onSelect, handleBrowsePath]
  );

  const handleSelectCurrentFolder = useCallback(() => {
    if (currentBrowsePath) {
      const name = currentBrowsePath.split("/").pop() || currentBrowsePath;
      onSelect(currentBrowsePath, name);
      onClose();
    }
  }, [currentBrowsePath, onClose, onClose]);

  const handleBrowseFolder = useCallback(() => {
    setViewMode("browse");
    if (configuredPaths.length > 0) {
      handleBrowsePath(configuredPaths[0].path, true);
    }
  }, [configuredPaths, handleBrowsePath]);

  const handleBackToList = useCallback(() => {
    setViewMode("list");
    setCurrentBrowsePath(null);
    setBrowseHistory([]);
  }, []);

  const handleGoBack = useCallback(() => {
    if (browseHistory.length > 1) {
      const newHistory = browseHistory.slice(0, -1);
      const previousPath = newHistory[newHistory.length - 1];
      setBrowseHistory(newHistory);
      setCurrentBrowsePath(previousPath);
      setBrowseLoading(true);
      apiClient.call("file.listDir", { path: previousPath })
        .then((result) => {
          setBrowseContents((result.entries as Array<{ name: string; path: string; type: "file" | "directory" }>) || []);
        })
        .catch(() => setBrowseContents([]))
        .finally(() => setBrowseLoading(false));
    } else {
      setViewMode("list");
      setCurrentBrowsePath(null);
      setBrowseHistory([]);
    }
  }, [browseHistory]);

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getSourceIcon = (source: MergedProject["source"]) => {
    switch (source) {
      case "pi":
        return <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />;
      case "recent":
        return <Folder className="w-4 h-4 text-indigo-400/70 shrink-0" />;
      case "configured":
        return <FolderOpen className="w-4 h-4 text-blue-400/70 shrink-0" />;
    }
  };

  const renderProjectItem = (proj: MergedProject, mobile?: boolean) => (
    <div
      key={proj.path}
      role="button"
      tabIndex={0}
      onClick={() => handleSelectProject(proj)}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleSelectProject(proj);
      }}
      className={`w-full flex items-center gap-3 text-left group transition-colors cursor-pointer ${
        mobile
          ? "px-4 py-3.5 rounded-xl active:bg-gray-800/80"
          : "px-3 py-2.5 rounded-lg hover:bg-gray-800/60"
      }`}
    >
      {getSourceIcon(proj.source)}
      <div className="flex-1 min-w-0">
        <div className={mobile ? "text-sm font-medium text-gray-200 truncate" : "text-[12px] font-medium text-gray-200 truncate"}>
          {proj.name}
        </div>
        <div className={mobile ? "text-[11px] text-gray-500 truncate" : "text-[10px] text-gray-500 truncate"}>
          {proj.path}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {proj.sessionCount > 0 && (
            <span className="text-[10px] text-gray-600">{proj.sessionCount} 个会话</span>
          )}
          {proj.source === "pi" && proj.hasActiveSession && (
            <span className="text-[10px] text-green-500/80">运行中</span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(proj.lastModified)}</span>
    </div>
  );

  const renderBrowseContent = () => {
    if (browseLoading) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      );
    }

    if (browseContents.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
          <FolderOpen className="w-8 h-8 opacity-30" />
          <span className="text-sm">该文件夹为空</span>
        </div>
      );
    }

    return browseContents
      .filter((item) => item.type === "directory" && !item.name.startsWith("."))
      .map((item) => (
        <div
          key={item.path}
          role="button"
          tabIndex={0}
          onClick={() => handleSelectBrowseItem(item)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSelectBrowseItem(item);
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/60 text-left cursor-pointer transition-colors"
        >
          <Folder className="w-4 h-4 text-yellow-500/70 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-gray-200 truncate">{item.name}</div>
            <div className="text-[10px] text-gray-500 truncate">{item.path}</div>
          </div>
          <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
        </div>
      ));
  };

  if (!open) return null;

  const renderDesktopView = () => (
    <div className="hidden md:flex fixed inset-0 z-[100] items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-4xl max-h-[85vh] mx-4 bg-gray-900 rounded-xl border border-gray-700/50 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-white">选择项目</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {viewMode === "browse" ? (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="w-full flex flex-col">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                <button
                  onClick={browseHistory.length > 1 ? handleGoBack : handleBackToList}
                  className="p-1.5 rounded-md hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-400 truncate flex-1">{currentBrowsePath}</span>
                <button
                  onClick={handleSelectCurrentFolder}
                  className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-md transition-colors"
                >
                  <Check className="w-3 h-3" />
                  选择此文件夹
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
                {renderBrowseContent()}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="w-[45%] min-w-[260px] border-r border-gray-800 flex flex-col">
              <div className="px-4 py-3 border-b border-gray-800">
                <p className="text-xs font-medium text-gray-300 mb-0.5">浏览文件夹</p>
                <p className="text-[10px] text-gray-500">从配置的路径浏览</p>
              </div>

              <button
                onClick={handleBrowseFolder}
                className="mx-4 mt-3 mb-2 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-lg text-sm text-indigo-300 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                浏览文件夹
              </button>

              <div className="px-4 mt-2 space-y-1">
                <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">快速访问</p>
                {configuredPaths.map((cp) => (
                  <button
                    key={cp.path}
                    onClick={() => handleBrowsePath(cp.path)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 rounded-lg transition-colors"
                  >
                    {cp.type === "home" && <Home className="w-3.5 h-3.5 shrink-0" />}
                    {cp.type === "documents" && <FileText className="w-3.5 h-3.5 shrink-0" />}
                    {cp.type === "custom" && <Folder className="w-3.5 h-3.5 shrink-0" />}
                    <span className="truncate">{cp.name}</span>
                    <ChevronRight className="w-3 h-3 ml-auto opacity-40 shrink-0" />
                  </button>
                ))}
              </div>

              <div className="px-4 mt-4 space-y-1">
                <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">Pi 项目</p>
                <p className="text-[10px] text-gray-600 px-3">
                  {projects.filter((p) => p.source === "pi").length} 个项目来自 Pi Sessions
                </p>
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-xs font-medium text-gray-300">所有项目</p>
                  <p className="text-[10px] text-gray-500">{filtered.length} 个项目</p>
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
                {loading ? (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    加载中...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                    <FolderOpen className="w-8 h-8 opacity-30" />
                    <span className="text-sm">{searchQuery ? "没有匹配的项目" : "暂无项目"}</span>
                  </div>
                ) : (
                  filtered.map((proj) => renderProjectItem(proj))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderMobileView = () => (
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
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
            <FolderOpen className="w-10 h-10 opacity-30" />
            <span className="text-sm">{searchQuery ? "没有匹配的项目" : "暂无最近打开的项目"}</span>
          </div>
        ) : (
          filtered.map((proj) => renderProjectItem(proj, true))
        )}
      </div>
    </div>
  );

  return (
    <>
      {renderMobileView()}
      {renderDesktopView()}
    </>
  );
}

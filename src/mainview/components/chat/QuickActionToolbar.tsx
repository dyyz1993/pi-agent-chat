import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Paperclip,
  Image as ImageIcon,
  AtSign,
  Slash,
  Bot,
  File,
  Folder,
  Loader2,
  Sparkles,
  Puzzle,
  FileText,
  ChevronRight,
  X,
  Brain,
  BookOpen,
} from "lucide-react";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useSessionStore } from "../../stores/use-session-store";
import { apiClient } from "../../lib/api-client";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useMemoryStore } from "../../stores/use-memory-store";
import type { TreeNode } from "../../types";

type PopupMode = "at" | "slash" | null;
type AtTab = "agents" | "files" | "memory";
type SlashCategory = "commands" | "skills";

interface ExtensionInfo {
  path: string;
  toolNames: string[];
}

interface SkillInfo {
  filePath: string;
  name: string;
  description?: string;
}

interface CommandInfo {
  name: string;
  source: string;
  description?: string;
}

interface DirEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  isIgnored?: boolean;
}

interface PopupItem {
  id: string;
  label: string;
  description?: string;
  icon: "bot" | "file" | "folder" | "sparkles" | "puzzle" | "filetext" | "brain" | "book";
  accentColor: string;
  insertText: string;
  isFolder?: boolean;
  folderPath?: string;
}

interface FileBreadcrumb {
  path: string;
  label: string;
}

export function QuickActionToolbar() {
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const isMobileOrTablet = breakpoint === "mobile" || breakpoint === "tablet";
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const [popupMode, setPopupMode] = useState<PopupMode>(null);
  const [atTab, setAtTab] = useState<AtTab>("agents");
  const [slashCategory, setSlashCategory] = useState<SlashCategory>("commands");
  const [items, setItems] = useState<PopupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileBreadcrumbs, setFileBreadcrumbs] = useState<FileBreadcrumb[]>([]);
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [cachedItems, setCachedItems] = useState<PopupItem[]>([]);
  const inputText = useChatStore((s) => s.inputText);
  const setInputText = useChatStore((s) => s.setInputText);
  const panelRef = useRef<HTMLDivElement>(null);

  const query = useMemo(() => {
    if (!popupMode) return "";
    const trigger = popupMode === "at" ? "@" : "/";
    const idx = inputText.lastIndexOf(trigger);
    if (idx < 0) return "";
    return inputText.slice(idx + 1);
  }, [inputText, popupMode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePopup();
      }
    }
    if (popupMode) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [popupMode]);

  const closePopup = useCallback(() => {
    setPopupMode(null);
    setAtTab("agents");
    setSlashCategory("commands");
    setFileBreadcrumbs([]);
    setCurrentDir(null);
    setCachedItems([]);
    setItems([]);
  }, []);

  const fetchAtAgents = useCallback(async () => {
    if (!activeSessionId) return;
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      const extRes = await apiClient.call("agent.getExtensions", { sessionId: activeSessionId }) as { extensions: ExtensionInfo[] };
      for (const ext of extRes.extensions) {
        for (const toolName of ext.toolNames) {
          result.push({
            id: `tool-${ext.path}-${toolName}`,
            label: toolName,
            description: ext.path,
            icon: "bot",
            accentColor: "text-purple-400",
            insertText: `@${toolName}`,
          });
        }
      }
      const skillsRaw = await apiClient.call("agent.getSkills", { sessionId: activeSessionId }) as SkillInfo[] | { skills: SkillInfo[] };
      const skillsArr: SkillInfo[] = Array.isArray(skillsRaw) ? skillsRaw : (skillsRaw.skills ?? []);
      for (const skill of skillsArr) {
        result.push({
          id: `skill-${skill.filePath}`,
          label: skill.name,
          description: skill.description,
          icon: "sparkles",
          accentColor: "text-cyan-400",
          insertText: `@${skill.name}`,
        });
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
    setCachedItems(result);
  }, [activeSessionId]);

  const fetchAtFiles = useCallback(async (dirPath: string | null) => {
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      if (dirPath) {
        const res = await apiClient.call("file.listDir", { path: dirPath }) as { entries: DirEntry[] };
        for (const e of res.entries) {
          if (e.isIgnored) continue;
          result.push({
            id: `file-${e.path}`,
            label: e.name,
            description: e.path,
            icon: e.type === "directory" ? "folder" : "file",
            accentColor: e.type === "directory" ? "text-amber-400" : "text-blue-400",
            insertText: e.type === "directory" ? "" : `@${e.path}`,
            isFolder: e.type === "directory",
            folderPath: e.path,
          });
        }
      } else {
        const explorerState = useExplorerStore.getState();
        let nodes: TreeNode[] = explorerState.treeNodes;
        if (nodes.length === 0) {
          await explorerState.listRootDir();
          nodes = useExplorerStore.getState().treeNodes;
        }
        for (const n of nodes) {
          if (n.isIgnored) continue;
          result.push({
            id: `file-${n.path}`,
            label: n.name,
            description: n.path,
            icon: n.type === "directory" ? "folder" : "file",
            accentColor: n.type === "directory" ? "text-amber-400" : "text-blue-400",
            insertText: n.type === "directory" ? "" : `@${n.path}`,
            isFolder: n.type === "directory",
            folderPath: n.path,
          });
        }
      }
    } finally { setLoading(false); }
    setCachedItems(result);
  }, []);

  const fetchAtMemory = useCallback(async () => {
    if (!activeSessionId) return;
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      const memoryState = useMemoryStore.getState();
      let files = activeSessionId ? (memoryState.filesBySession[activeSessionId] ?? []) : [];
      if (files.length === 0) {
        const sessionState = useSessionStore.getState();
        const allSessions = Object.values(sessionState.sessionsByProject).flat();
        const session = allSessions.find((s) => s.sessionId === activeSessionId);
        if (session?.projectPath) {
          await memoryState.loadFiles(session.projectPath, activeSessionId);
          files = useMemoryStore.getState().filesBySession[activeSessionId] ?? [];
        }
      }
      for (const f of files) {
        result.push({
          id: `memory-${f.filePath}`,
          label: f.filename,
          description: f.description ?? f.type ?? undefined,
          icon: f.type === "bookmark" ? "book" : "brain",
          accentColor: "text-teal-400",
          insertText: `@memory:${f.filename}`,
        });
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
    setCachedItems(result);
  }, [activeSessionId]);

  const fetchSlashCommands = useCallback(async () => {
    if (!activeSessionId) return;
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      const cmdRes = await apiClient.call("agent.getCommands", { sessionId: activeSessionId }) as CommandInfo[];
      for (const cmd of cmdRes) {
        if (cmd.source === "skill") continue;
        result.push({
          id: `cmd-${cmd.name}-${cmd.source}`,
          label: cmd.name,
          description: cmd.description,
          icon: cmd.source === "extension" ? "puzzle" : "filetext",
          accentColor: "text-amber-400",
          insertText: `/${cmd.name}`,
        });
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
    setCachedItems(result);
  }, [activeSessionId]);

  const fetchSlashSkills = useCallback(async () => {
    if (!activeSessionId) return;
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      const cmdRes = await apiClient.call("agent.getCommands", { sessionId: activeSessionId }) as CommandInfo[];
      for (const cmd of cmdRes) {
        if (cmd.source !== "skill") continue;
        result.push({
          id: `cmd-skill-${cmd.name}`,
          label: cmd.name,
          description: cmd.description,
          icon: "sparkles",
          accentColor: "text-cyan-400",
          insertText: `/${cmd.name}`,
        });
      }
      const skillsRaw = await apiClient.call("agent.getSkills", { sessionId: activeSessionId }) as SkillInfo[] | { skills: SkillInfo[] };
      const skillsArr: SkillInfo[] = Array.isArray(skillsRaw) ? skillsRaw : (skillsRaw.skills ?? []);
      for (const skill of skillsArr) {
        const exists = result.some((r) => r.label === skill.name);
        if (exists) continue;
        result.push({
          id: `skill-${skill.filePath}`,
          label: skill.name,
          description: skill.description,
          icon: "sparkles",
          accentColor: "text-cyan-400",
          insertText: `/${skill.name}`,
        });
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
    setCachedItems(result);
  }, [activeSessionId]);

  useEffect(() => {
    if (!popupMode) return;
    if (popupMode === "at") {
      if (atTab === "files") fetchAtFiles(currentDir);
      else if (atTab === "memory") fetchAtMemory();
      else fetchAtAgents();
    } else {
      if (slashCategory === "commands") fetchSlashCommands();
      else fetchSlashSkills();
    }
  }, [popupMode, atTab, currentDir, slashCategory, fetchAtAgents, fetchAtFiles, fetchAtMemory, fetchSlashCommands, fetchSlashSkills]);

  useEffect(() => {
    if (!popupMode || cachedItems.length === 0) {
      if (!loading) setItems([]);
      return;
    }
    const q = query.toLowerCase();
    const filtered = q
      ? cachedItems.filter((it) => it.label.toLowerCase().includes(q) || (it.description && it.description.toLowerCase().includes(q)))
      : cachedItems;
    setItems(filtered.slice(0, 50));
    setActiveIndex(0);
  }, [query, cachedItems, popupMode, loading]);

  const handleSelect = useCallback((item: PopupItem) => {
    if (item.isFolder && item.folderPath && popupMode === "at" && atTab === "files") {
      setCurrentDir(item.folderPath);
      setFileBreadcrumbs((prev) => [...prev, { path: item.folderPath ?? "", label: item.label }]);
      return;
    }

    const trigger = popupMode === "at" ? "@" : "/";
    const triggerIdx = inputText.lastIndexOf(trigger);
    let newText: string;
    if (triggerIdx >= 0) {
      newText = inputText.slice(0, triggerIdx) + item.insertText + " ";
    } else {
      newText = inputText + item.insertText + " ";
    }
    setInputText(newText);
    closePopup();
  }, [inputText, setInputText, popupMode, atTab, closePopup]);

  const handleBreadcrumb = useCallback((idx: number) => {
    if (idx === -1) {
      setCurrentDir(null);
      setFileBreadcrumbs([]);
    } else {
      const target = fileBreadcrumbs[idx];
      setCurrentDir(target.path);
      setFileBreadcrumbs((prev) => prev.slice(0, idx + 1));
    }
  }, [fileBreadcrumbs]);

  const handleOpenAt = useCallback(() => {
    setInputText(inputText + "@");
    setPopupMode("at");
    setAtTab("agents");
    setFileBreadcrumbs([]);
    setCurrentDir(null);
  }, [inputText, setInputText]);

  const handleOpenSlash = useCallback(() => {
    setInputText(inputText + "/");
    setPopupMode("slash");
    setSlashCategory("commands");
  }, [inputText, setInputText]);

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePopup();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const item = items[activeIndex];
        if (item) handleSelect(item);
      }
    },
    [items, activeIndex, closePopup, handleSelect],
  );

  if (!isMobileOrTablet) return null;

  const atTabs: { key: AtTab; label: string }[] = [
    { key: "agents", label: "智能体" },
    { key: "files", label: "文件" },
    { key: "memory", label: "记忆" },
  ];

  const renderIcon = (icon: PopupItem["icon"]) => {
    switch (icon) {
      case "bot": return <Bot className="w-4 h-4" />;
      case "file": return <File className="w-4 h-4" />;
      case "folder": return <Folder className="w-4 h-4" />;
      case "sparkles": return <Sparkles className="w-4 h-4" />;
      case "puzzle": return <Puzzle className="w-4 h-4" />;
      case "filetext": return <FileText className="w-4 h-4" />;
      case "brain": return <Brain className="w-4 h-4" />;
      case "book": return <BookOpen className="w-4 h-4" />;
    }
  };

  return (
    <div className="relative px-3 pt-1">
      <div className="flex items-center gap-1 min-h-[40px]">
        <div className="flex items-center gap-0.5">
          <button
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            title="附件"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            title="图片"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={handleOpenAt}
            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              popupMode === "at"
                ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/50"
                : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border border-transparent"
            }`}
            title="@提及"
          >
            <div className="flex items-center gap-1">
              <AtSign className="w-3.5 h-3.5" />
              <span>@</span>
            </div>
          </button>
          <button
            onClick={handleOpenSlash}
            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              popupMode === "slash"
                ? "bg-amber-600/30 text-amber-300 border border-amber-500/50"
                : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border border-transparent"
            }`}
            title="命令与技能"
          >
            <div className="flex items-center gap-1">
              <Slash className="w-3.5 h-3.5" />
              <span>/</span>
            </div>
          </button>
        </div>
      </div>

      {popupMode && (
        <div
          ref={panelRef}
          className="absolute left-3 right-3 bottom-full mb-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl shadow-black/40 overflow-hidden z-50"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2 min-w-0">
              {popupMode === "at" ? (
                <div className="flex gap-1 shrink-0">
                  {atTabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => {
                        setAtTab(tab.key);
                        if (tab.key !== "files") { setCurrentDir(null); setFileBreadcrumbs([]); }
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] transition-colors whitespace-nowrap ${
                        atTab === tab.key
                          ? "bg-indigo-600/30 text-indigo-300"
                           : "text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-1 shrink-0">
                  {(["commands", "skills"] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSlashCategory(cat)}
                      className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                        slashCategory === cat
                           ? "bg-amber-600/30 text-amber-300"
                           : "text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {cat === "commands" ? "命令" : "技能"}
                    </button>
                  ))}
                </div>
              )}
              {loading && <Loader2 className="w-3 h-3 text-gray-500 animate-spin shrink-0" />}
            </div>
            <button
              onClick={closePopup}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors shrink-0 ml-1"
              title="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {popupMode === "at" && atTab === "files" && fileBreadcrumbs.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-200/40 dark:border-gray-800/40 text-[11px] overflow-x-auto">
              <button
                onClick={() => handleBreadcrumb(-1)}
                className="text-indigo-400 hover:text-indigo-300 shrink-0"
              >
                根目录
              </button>
              {fileBreadcrumbs.map((bc, i) => (
                <span key={bc.path} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="w-3 h-3 text-gray-400 dark:text-gray-600" />
                  <button
                    onClick={() => handleBreadcrumb(i)}
                    className={`${i === fileBreadcrumbs.length - 1 ? "text-gray-700 dark:text-gray-300" : "text-indigo-400 hover:text-indigo-300"}`}
                  >
                    {bc.label}
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="max-h-[240px] min-h-[80px] overflow-y-auto" role="listbox">
            {items.length === 0 && !loading && (
              <div className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-600">
                {query ? "没有匹配结果" : "暂无数据"}
              </div>
            )}
            {items.map((item, idx) => (
              <button
                key={item.id}
                role="option"
                aria-selected={idx === activeIndex}
                tabIndex={idx === activeIndex ? 0 : -1}
                onClick={() => handleSelect(item)}
                onKeyDown={handleListKeyDown}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  idx === activeIndex ? "bg-gray-100/80 dark:bg-gray-800/80" : "hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
                }`}
              >
                <div className={`shrink-0 ${item.accentColor}`}>
                  {renderIcon(item.icon)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-800 dark:text-gray-200 truncate">{item.label}</div>
                  {item.description && !item.isFolder && (
                    <div className="text-[11px] text-gray-400 dark:text-gray-600 truncate">{item.description}</div>
                  )}
                </div>
                {item.isFolder && (
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400 dark:text-gray-600 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAttachmentStore } from "../../stores/use-attachment-store";
import { formatFilePath } from "../../lib/format-path";
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
  Target,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../shared/lib/logger";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useSessionStore } from "../../stores/use-session-store";
import { apiClient } from "../../lib/api-client";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useMemoryStore } from "../../stores/use-memory-store";
import { useStatusStore } from "../../stores/use-status-store";
import { useSupervisorStore } from "../../stores/use-supervisor-store";
import type { TreeNode } from "../../types";
import { isVisionModel } from "../../lib/vision-detection";

type PopupMode = "at" | "slash" | null;
type AtTab = "agents" | "files" | "memory";
type SlashCategory = "commands" | "skills";

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

const logger = createLogger("chat");

export function QuickActionToolbar({ onGoalClick }: { onGoalClick?: () => void } = {}) {
  const { t } = useTranslation("chat");
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
  const openStatusPanel = useLayoutStore((s) => s.openStatusPanel);
  const supervisorStatus = useSupervisorStore(
    (s) => (activeSessionId ? s.bySession[activeSessionId]?.status : null) ?? null,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const addFiles = useAttachmentStore((s) => s.addFiles);

  const currentModel = useSessionStore((s) => s.currentModel);
  const availableModels = useSessionStore((s) => s.availableModels);
  const supportsVision = currentModel
    ? isVisionModel(
        availableModels.find(
          (m) => m.provider === currentModel.provider && m.id === currentModel.id,
        ) ?? {},
      )
    : false;

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        addFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [addFiles],
  );

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        addFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [addFiles],
  );

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

  const fetchAtAgents = useCallback(() => {
    if (!activeSessionId) return;
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      const { plugins, skills } = useStatusStore.getState();
      for (const ext of plugins) {
        for (const toolName of ext.toolNames) {
          result.push({
            id: `tool-${ext.path}-${toolName}`,
            label: toolName,
            description: ext.path,
            icon: "bot",
            accentColor: "text-semantic-agent",
            insertText: `@${toolName}`,
          });
        }
      }
      for (const skill of skills) {
        result.push({
          id: `skill-${skill.filePath}`,
          label: skill.name,
          description: skill.description,
          icon: "sparkles",
          accentColor: "text-semantic-tool",
          insertText: `@${skill.name}`,
        });
      }
    } catch (e) {
      logger.warn("Failed to fetch @ agents", { error: String(e) });
    } finally {
      setLoading(false);
    }
    setCachedItems(result);
  }, [activeSessionId]);

  const fetchAtFiles = useCallback(async (dirPath: string | null) => {
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      if (dirPath) {
        const res = (await apiClient.call("file.listDir", { path: dirPath })) as {
          entries: DirEntry[];
        };
        for (const e of res.entries) {
          if (e.isIgnored) continue;
          result.push({
            id: `file-${e.path}`,
            label: e.name,
            description: formatFilePath(e.path),
            icon: e.type === "directory" ? "folder" : "file",
            accentColor: e.type === "directory" ? "text-semantic-notify" : "text-status-info",
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
            accentColor: n.type === "directory" ? "text-semantic-notify" : "text-status-info",
            insertText: n.type === "directory" ? "" : `@${n.path}`,
            isFolder: n.type === "directory",
            folderPath: n.path,
          });
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
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
          accentColor: "text-semantic-memory",
          insertText: `@memory:${f.filename}`,
        });
      }
    } catch (e) {
      logger.warn("Failed to fetch @ memory", { error: String(e) });
    } finally {
      setLoading(false);
    }
    setCachedItems(result);
  }, [activeSessionId]);

  const fetchSlashCommands = useCallback(async () => {
    if (!activeSessionId) return;
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      const cmdRes = (await apiClient.call("agent.getCommands", {
        sessionId: activeSessionId,
      })) as CommandInfo[];
      for (const cmd of cmdRes) {
        if (cmd.source === "skill") continue;
        result.push({
          id: `cmd-${cmd.name}-${cmd.source}`,
          label: cmd.name,
          description: cmd.description,
          icon: cmd.source === "extension" ? "puzzle" : "filetext",
          accentColor: "text-semantic-notify",
          insertText: `/${cmd.name}`,
        });
      }
    } catch (e) {
      logger.warn("Failed to fetch slash commands", { error: String(e) });
    } finally {
      setLoading(false);
    }
    setCachedItems(result);
  }, [activeSessionId]);

  const fetchSlashSkills = useCallback(async () => {
    if (!activeSessionId) return;
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      const cmdRes = (await apiClient.call("agent.getCommands", {
        sessionId: activeSessionId,
      })) as CommandInfo[];
      for (const cmd of cmdRes) {
        if (cmd.source !== "skill") continue;
        result.push({
          id: `cmd-skill-${cmd.name}`,
          label: cmd.name,
          description: cmd.description,
          icon: "sparkles",
          accentColor: "text-semantic-tool",
          insertText: `/${cmd.name}`,
        });
      }
      const { skills: storeSkills } = useStatusStore.getState();
      for (const skill of storeSkills) {
        const exists = result.some((r) => r.label === skill.name);
        if (exists) continue;
        result.push({
          id: `skill-${skill.filePath}`,
          label: skill.name,
          description: skill.description,
          icon: "sparkles",
          accentColor: "text-semantic-tool",
          insertText: `/${skill.name}`,
        });
      }
    } catch (e) {
      logger.warn("Failed to fetch slash skills", { error: String(e) });
    } finally {
      setLoading(false);
    }
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
  }, [
    popupMode,
    atTab,
    currentDir,
    slashCategory,
    fetchAtAgents,
    fetchAtFiles,
    fetchAtMemory,
    fetchSlashCommands,
    fetchSlashSkills,
  ]);

  useEffect(() => {
    if (!popupMode || cachedItems.length === 0) {
      if (!loading) setItems([]);
      return;
    }
    const q = query.toLowerCase();
    const filtered = q
      ? cachedItems.filter(
          (it) =>
            it.label.toLowerCase().includes(q) ||
            (it.description && it.description.toLowerCase().includes(q)),
        )
      : cachedItems;
    setItems(filtered.slice(0, 50));
    setActiveIndex(0);
  }, [query, cachedItems, popupMode, loading]);

  const handleSelect = useCallback(
    (item: PopupItem) => {
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
    },
    [inputText, setInputText, popupMode, atTab, closePopup],
  );

  const handleBreadcrumb = useCallback(
    (idx: number) => {
      if (idx === -1) {
        setCurrentDir(null);
        setFileBreadcrumbs([]);
      } else {
        const target = fileBreadcrumbs[idx];
        setCurrentDir(target.path);
        setFileBreadcrumbs((prev) => prev.slice(0, idx + 1));
      }
    },
    [fileBreadcrumbs],
  );

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
    { key: "agents", label: t("quickAction.agents") },
    { key: "files", label: t("quickAction.files") },
    { key: "memory", label: t("quickAction.memory") },
  ];

  const renderIcon = (icon: PopupItem["icon"]) => {
    switch (icon) {
      case "bot":
        return <Bot className="w-4 h-4" />;
      case "file":
        return <File className="w-4 h-4" />;
      case "folder":
        return <Folder className="w-4 h-4" />;
      case "sparkles":
        return <Sparkles className="w-4 h-4" />;
      case "puzzle":
        return <Puzzle className="w-4 h-4" />;
      case "filetext":
        return <FileText className="w-4 h-4" />;
      case "brain":
        return <Brain className="w-4 h-4" />;
      case "book":
        return <BookOpen className="w-4 h-4" />;
    }
  };

  return (
    <div className="relative px-3 pt-1">
      <div className="flex items-center gap-1 min-h-[40px]">
        <div className="flex items-center gap-0.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-md hover:bg-surface-dim dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors"
            title={t("quickAction.attachment")}
          >
            <Paperclip className="w-4 h-4" />
          </button>
          {supportsVision && (
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageSelect}
            />
          )}
          {supportsVision && (
            <button
              onClick={() => imageInputRef.current?.click()}
              className="p-1.5 rounded-md hover:bg-surface-dim dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors"
              title={t("quickAction.image")}
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={handleOpenAt}
            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              popupMode === "at"
                ? "bg-semantic-accent/30 text-semantic-accent border border-semantic-accent/50"
                : "hover:bg-surface-dim dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary border border-transparent"
            }`}
            title={t("quickAction.atMention")}
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
                ? "bg-semantic-notify/30 text-semantic-notify border border-semantic-notify/50"
                : "hover:bg-surface-dim dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary border border-transparent"
            }`}
            title={t("quickAction.commandsAndSkills")}
          >
            <div className="flex items-center gap-1">
              <Slash className="w-3.5 h-3.5" />
              <span>/</span>
            </div>
          </button>
          <button
            onClick={() => {
              if (onGoalClick) {
                onGoalClick();
                return;
              }
              openStatusPanel("status");
            }}
            className={`px-2 py-1 rounded-md text-xs font-medium hover:bg-surface-dim dark:hover:bg-surface-dim transition-colors ${
              !supervisorStatus?.enabled
                ? "text-semantic-accent border border-semantic-accent/30"
                : supervisorStatus.goal
                  ? "text-semantic-accent border border-semantic-accent/40 bg-semantic-accent/10"
                  : supervisorStatus.state === "paused"
                    ? "text-semantic-notify"
                    : supervisorStatus.state === "checking" ||
                        supervisorStatus.state === "continuing"
                      ? "text-status-info animate-pulse"
                      : "text-status-success"
            }`}
            title={t("goal.entry")}
            aria-label={t("goal.entry")}
          >
            <div className="flex items-center gap-1">
              <Target className="w-3.5 h-3.5" />
              <span>Goal</span>
            </div>
          </button>
        </div>
      </div>

      {popupMode && (
        <div
          ref={panelRef}
          className="absolute left-3 right-3 bottom-full mb-1 bg-surface-dim dark:bg-surface-code border border-border-secondary rounded-lg shadow-xl shadow-black/40 overflow-hidden z-popover"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-secondary">
            <div className="flex items-center gap-2 min-w-0">
              {popupMode === "at" ? (
                <div className="flex gap-1 shrink-0">
                  {atTabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => {
                        setAtTab(tab.key);
                        if (tab.key !== "files") {
                          setCurrentDir(null);
                          setFileBreadcrumbs([]);
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] transition-colors whitespace-nowrap ${
                        atTab === tab.key
                          ? "bg-semantic-accent/30 text-semantic-accent"
                          : "text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary hover:bg-surface-dim dark:hover:bg-surface-dim"
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
                          ? "bg-semantic-notify/30 text-semantic-notify"
                          : "text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary hover:bg-surface-dim dark:hover:bg-surface-dim"
                      }`}
                    >
                      {cat === "commands" ? t("quickAction.commands") : t("quickAction.skills")}
                    </button>
                  ))}
                </div>
              )}
              {loading && <Loader2 className="w-3 h-3 text-text-tertiary animate-spin shrink-0" />}
            </div>
            <button
              onClick={closePopup}
              className="p-1 rounded hover:bg-surface-dim dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors shrink-0 ml-1"
              title={t("common:close")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {popupMode === "at" && atTab === "files" && fileBreadcrumbs.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-1 border-b border-border-secondary/40 text-[11px] overflow-x-auto">
              <button
                onClick={() => handleBreadcrumb(-1)}
                className="text-semantic-accent hover:text-semantic-accent shrink-0"
              >
                {t("quickAction.rootDir")}
              </button>
              {fileBreadcrumbs.map((bc, i) => (
                <span key={bc.path} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="w-3 h-3 text-text-tertiary" />
                  <button
                    onClick={() => handleBreadcrumb(i)}
                    className={`${i === fileBreadcrumbs.length - 1 ? "text-text-secondary" : "text-semantic-accent hover:text-semantic-accent"}`}
                  >
                    {bc.label}
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="max-h-[240px] min-h-[80px] overflow-y-auto" role="listbox">
            {items.length === 0 && !loading && (
              <div className="px-3 py-6 text-center text-xs text-text-tertiary">
                {query ? t("quickAction.noMatchResults") : t("common:noData")}
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
                  idx === activeIndex
                    ? "bg-surface-code/80 dark:bg-surface-dim/80"
                    : "hover:bg-surface-code/50 dark:hover:bg-surface-dim/50"
                }`}
              >
                <div className={`shrink-0 ${item.accentColor}`}>{renderIcon(item.icon)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">{item.label}</div>
                  {item.description && !item.isFolder && (
                    <div className="text-[11px] text-text-tertiary truncate">
                      {item.description}
                    </div>
                  )}
                </div>
                {item.isFolder && (
                  <ChevronRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

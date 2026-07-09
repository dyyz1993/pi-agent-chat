import { useState, useEffect, useCallback, useMemo } from "react";
import { useChatStore } from "../stores/use-chat-store";
import { useSessionStore } from "../stores/use-session-store";
import { useExplorerStore } from "../stores/use-explorer-store";
import { useMemoryStore } from "../stores/use-memory-store";
import { useComposerPlaceholderStore } from "../stores/use-composer-placeholder-store";
import { apiClient } from "../lib/api-client";
import type { TreeNode } from "../types";
import { createLogger } from "../../shared/lib/logger";
import { buildSessionMentionItems, type SessionMentionScope } from "../lib/session-mention-items";
import { jumpToSessionById } from "../components/chat/primitives/useJumpToSession";

const log = createLogger("chat");

export type PopupMode = "at" | "slash" | null;
export type AtTab =
  | "recentSessions"
  | "currentSessions"
  | "globalSessions"
  | "agents"
  | "files"
  | "memory";

export interface PopupItem {
  id: string;
  label: string;
  description?: string;
  icon:
    | "tool"
    | "file"
    | "folder"
    | "sparkles"
    | "puzzle"
    | "filetext"
    | "brain"
    | "book"
    | "session";
  accentColor: string;
  insertText: string;
  isFolder?: boolean;
  folderPath?: string;
  sessionId?: string;
  sessionAction?: "reference" | "jump";
}

export interface FileBreadcrumb {
  path: string;
  label: string;
}

export interface CommandPopupState {
  popupMode: PopupMode;
  atTab: AtTab;
  items: PopupItem[];
  loading: boolean;
  activeIndex: number;
  query: string;
  fileBreadcrumbs: FileBreadcrumb[];
  openPopup: (mode: "at" | "slash") => void;
  closePopup: () => void;
  setAtTab: (tab: AtTab) => void;
  setActiveIndex: (idx: number) => void;
  handleSelect: (item: PopupItem) => void;
  handleBreadcrumb: (idx: number) => void;
  handleListKeyDown: (e: React.KeyboardEvent) => void;
  confirmSelection: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
}

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

const LOCAL_SLASH_COMMANDS: PopupItem[] = [
  {
    id: "local-command-compact",
    label: "compact",
    description: "手动压缩当前会话上下文",
    icon: "filetext",
    accentColor: "text-amber-400",
    insertText: "/compact",
  },
  {
    id: "local-command-compact-force",
    label: "compact-force",
    description: "兼容旧入口：手动触发上下文压缩",
    icon: "filetext",
    accentColor: "text-amber-400",
    insertText: "/compact-force",
  },
];

interface DirEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  isIgnored?: boolean;
}

export function useCommandPopup(): CommandPopupState {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const inputText = useChatStore((s) => s.inputText);
  const setInputText = useChatStore((s) => s.setInputText);

  const [popupMode, setPopupMode] = useState<PopupMode>(null);
  const [atTab, setAtTabState] = useState<AtTab>("agents");
  const [items, setItems] = useState<PopupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileBreadcrumbs, setFileBreadcrumbs] = useState<FileBreadcrumb[]>([]);
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [cachedItems, setCachedItems] = useState<PopupItem[]>([]);

  const query = useMemo(() => {
    if (!popupMode) return "";
    const trigger = popupMode === "at" ? "@" : "/";
    const idx = inputText.lastIndexOf(trigger);
    if (idx < 0) return "";
    return inputText.slice(idx + 1);
  }, [inputText, popupMode]);

  const closePopup = useCallback(() => {
    setPopupMode(null);
    setAtTabState("recentSessions");
    setFileBreadcrumbs([]);
    setCurrentDir(null);
    setCachedItems([]);
    setItems([]);
  }, []);

  const buildSessionItems = useCallback(
    (scope: SessionMentionScope, action: "reference" | "jump"): PopupItem[] => {
      const sessionState = useSessionStore.getState();
      return buildSessionMentionItems({
        sessionsByProject: sessionState.sessionsByProject,
        projectTabs: sessionState.projectTabs,
        activeProjectId: sessionState.activeProjectId,
        scope,
        action,
      }).map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        icon: "session",
        accentColor: action === "jump" ? "text-cyan-400" : "text-blue-400",
        insertText: item.insertText,
        sessionId: item.sessionId,
        sessionAction: item.action,
      }));
    },
    [],
  );

  const fetchAtSessions = useCallback(
    (tab: AtTab) => {
      const scope: SessionMentionScope =
        tab === "currentSessions" ? "current" : tab === "globalSessions" ? "global" : "recent";
      setCachedItems(buildSessionItems(scope, "reference"));
      setLoading(false);
    },
    [buildSessionItems],
  );

  const fetchAtAgents = useCallback(async () => {
    if (!activeSessionId) return;
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      const extRes = (await apiClient.call("agent.getExtensions", {
        sessionId: activeSessionId,
      })) as { extensions: ExtensionInfo[] };
      for (const ext of extRes.extensions) {
        for (const toolName of ext.toolNames) {
          result.push({
            id: `tool-${ext.path}-${toolName}`,
            label: toolName,
            description: ext.path,
            icon: "tool",
            accentColor: "text-purple-400",
            insertText: `@${toolName}`,
          });
        }
      }
      const skillsRaw = (await apiClient.call("agent.getSkills", {
        sessionId: activeSessionId,
      })) as SkillInfo[] | { skills: SkillInfo[] };
      const skillsArr: SkillInfo[] = Array.isArray(skillsRaw)
        ? skillsRaw
        : (skillsRaw.skills ?? []);
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
    } catch (e) {
      log.warn("Failed to fetch @agents", { error: String(e) });
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
          accentColor: "text-teal-400",
          insertText: `@memory:${f.filename}`,
        });
      }
    } catch (e) {
      log.warn("Failed to fetch slash commands and skills", { error: String(e) });
    } finally {
      setLoading(false);
    }
    setCachedItems(result);
  }, [activeSessionId]);

  const fetchSlashAll = useCallback(async () => {
    if (!activeSessionId) return;
    setLoading(true);
    const result: PopupItem[] = [];
    try {
      const cmdRes = (await apiClient.call("agent.getCommands", {
        sessionId: activeSessionId,
      })) as CommandInfo[];
      result.push(...buildSessionItems("recent", "jump"));
      for (const cmd of cmdRes) {
        result.push({
          id: `cmd-${cmd.name}-${cmd.source}`,
          label: cmd.name,
          description: cmd.description,
          icon:
            cmd.source === "skill"
              ? "sparkles"
              : cmd.source === "extension"
                ? "puzzle"
                : "filetext",
          accentColor: cmd.source === "skill" ? "text-cyan-400" : "text-amber-400",
          insertText: `/${cmd.name}`,
        });
      }
      for (const command of LOCAL_SLASH_COMMANDS) {
        if (!result.some((item) => item.label === command.label)) {
          result.push(command);
        }
      }
      const skillsRaw = (await apiClient.call("agent.getSkills", {
        sessionId: activeSessionId,
      })) as SkillInfo[] | { skills: SkillInfo[] };
      const skillsArr: SkillInfo[] = Array.isArray(skillsRaw)
        ? skillsRaw
        : (skillsRaw.skills ?? []);
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
    } catch (e) {
      log.warn("Failed to fetch @memory", { error: String(e) });
    } finally {
      setLoading(false);
    }
    setCachedItems(result);
  }, [activeSessionId, buildSessionItems]);

  useEffect(() => {
    if (!popupMode) return;
    if (popupMode === "at") {
      if (atTab === "recentSessions" || atTab === "currentSessions" || atTab === "globalSessions") {
        fetchAtSessions(atTab);
      } else if (atTab === "files") fetchAtFiles(currentDir);
      else if (atTab === "memory") fetchAtMemory();
      else fetchAtAgents();
    } else {
      fetchSlashAll();
    }
  }, [
    popupMode,
    atTab,
    currentDir,
    fetchAtAgents,
    fetchAtFiles,
    fetchAtMemory,
    fetchAtSessions,
    fetchSlashAll,
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

  const openPopup = useCallback(
    (mode: "at" | "slash") => {
      setPopupMode(mode);
      if (mode === "at") {
        setAtTabState("recentSessions");
        setFileBreadcrumbs([]);
        setCurrentDir(null);
      }
    },
    [setPopupMode],
  );

  const setAtTab = useCallback((tab: AtTab) => {
    setAtTabState(tab);
    if (tab !== "files") {
      setCurrentDir(null);
      setFileBreadcrumbs([]);
    }
  }, []);

  const handleSelect = useCallback(
    (item: PopupItem) => {
      if (item.isFolder && item.folderPath && popupMode === "at" && atTab === "files") {
        setCurrentDir(item.folderPath);
        setFileBreadcrumbs((prev) => [...prev, { path: item.folderPath ?? "", label: item.label }]);
        return;
      }

      if (item.sessionAction === "jump" && item.sessionId) {
        const trigger = popupMode === "at" ? "@" : "/";
        const triggerIdx = inputText.lastIndexOf(trigger);
        if (triggerIdx >= 0) {
          setInputText(inputText.slice(0, triggerIdx));
        }
        closePopup();
        void jumpToSessionById(item.sessionId, { returnSourceSessionId: activeSessionId });
        return;
      }

      if (item.sessionAction === "reference" && item.sessionId) {
        const trigger = popupMode === "at" ? "@" : "/";
        const triggerIdx = inputText.lastIndexOf(trigger);
        if (triggerIdx >= 0) {
          setInputText(inputText.slice(0, triggerIdx));
        }
        useComposerPlaceholderStore.getState().addSessionReference({
          sessionId: item.sessionId,
          title: item.label,
          description: item.description,
        });
        closePopup();
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
    [activeSessionId, inputText, setInputText, popupMode, atTab, closePopup],
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

  const confirmSelection = useCallback(() => {
    const item = items[activeIndex];
    if (item) handleSelect(item);
  }, [items, activeIndex, handleSelect]);

  const navigateUp = useCallback(() => {
    setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
  }, [items.length]);

  const navigateDown = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % items.length);
  }, [items.length]);

  return {
    popupMode,
    atTab,
    items,
    loading,
    activeIndex,
    query,
    fileBreadcrumbs,
    openPopup,
    closePopup,
    setAtTab,
    setActiveIndex,
    handleSelect,
    handleBreadcrumb,
    handleListKeyDown,
    confirmSelection,
    navigateUp,
    navigateDown,
  };
}

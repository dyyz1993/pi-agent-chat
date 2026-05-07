import { memo, useCallback, useRef, useState } from "react";
import {
  ChevronDown,
  User,
  Bot,
  RotateCcw,
  Undo2,
  GitBranch,
  Loader2,
  FileWarning,
  Archive,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useNotificationStore } from "../../stores/use-notification-store";

const EMPTY_MSGS: never[] = [];
import { apiClient } from "../../lib/api-client";
import type { SessionMeta } from "../../types";
import type { TreeEntry } from "@dyyz1993/pi-coding-agent";
import {
  MessageBubble,
  MEMORY_HIDDEN_IN_CHAT,
  MEMORY_CUSTOM_TYPES,
  isLspCustomType,
  isLspVisibleInChat,
} from "./MessageBubble";
import type { ChatMessage } from "../../types";
import { getCustomTypeIcon } from "./tool-icon-map";

interface MessageCardProps {
  message: ChatMessage;
  cardLabel?: string;
  prevBarColor?: string;
}

const ROLE_CONFIG = {
  user: {
    icon: User,
    color: "text-blue-400/80",
    barColor: "border-l-blue-500/60",
    bgColor: "bg-blue-500/[0.03]",
    altBarColor: "border-l-blue-400/45",
    altBgColor: "bg-blue-400/[0.02]",
  },
  assistant: {
    icon: Bot,
    color: "text-emerald-400/70",
    barColor: "border-l-emerald-500/50",
    bgColor: "bg-emerald-500/[0.03]",
    altBarColor: "border-l-emerald-400/35",
    altBgColor: "bg-emerald-400/[0.02]",
  },
  compactionSummary: {
    icon: Archive,
    color: "text-cyan-400/70",
    barColor: "border-l-cyan-500/50",
    bgColor: "bg-cyan-500/[0.03]",
    altBarColor: "border-l-cyan-400/35",
    altBgColor: "bg-cyan-400/[0.02]",
  },
};

const ENTRY_DEFAULT = {
  barColor: "border-l-yellow-500/50",
  labelColor: "text-yellow-400/70",
  bgColor: "bg-yellow-500/[0.04]",
  altBarColor: "border-l-yellow-400/35",
  altBgColor: "bg-yellow-400/[0.02]",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export const MessageCard = memo(function MessageCard({
  message,
  cardLabel,
  prevBarColor,
}: MessageCardProps) {
  const { t } = useTranslation("chat");
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const toggleCollapse = useTurnStore((s) => s.toggleCollapse);
  const toggleMessageSelection = useTurnStore((s) => s.toggleMessageSelection);

  const isCollapsed = useTurnStore(
    useCallback(
      (s) =>
        sessionId
          ? (s.collapsedMessageIdsBySession[sessionId] ?? EMPTY_SET).has(message.id)
          : false,
      [sessionId, message.id],
    ),
  );
  const isSelected = useTurnStore(
    useCallback(
      (s) =>
        sessionId ? (s.selectedMessageIdsBySession[sessionId] ?? EMPTY_SET).has(message.id) : false,
      [sessionId, message.id],
    ),
  );

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isCompaction = message.role === "compactionSummary";
  const timeStr = formatTime(message.timestamp);

  const hasCustomContent = message.content.some((b) => b.type === "custom");
  const customBlock = message.content.find(
    (b): b is Extract<typeof b, { type: "custom" }> => b.type === "custom",
  );

  // Skip rendering entirely for custom entries where all blocks are hidden
  if (hasCustomContent) {
    const allHidden = message.content.every((b) => {
      if (b.type !== "custom") return false;
      if (MEMORY_HIDDEN_IN_CHAT.has(b.customType)) return true;
      if (isLspCustomType(b.customType) && !isLspVisibleInChat(b.customType)) return true;
      if (!MEMORY_CUSTOM_TYPES.has(b.customType) && !isLspCustomType(b.customType)) return true;
      return false;
    });
    if (allHidden) return null;
  }

  if (hasCustomContent && customBlock && MEMORY_CUSTOM_TYPES.has(customBlock.customType)) {
    return (
      <div data-msg-card-id={message.id} className="relative w-full py-1.5">
        <MessageBubble message={message} />
      </div>
    );
  }

  if (isCompaction) {
    const compactionBlock = message.content.find(
      (b): b is Extract<typeof b, { type: "compactionSummary" }> => b.type === "compactionSummary",
    );
    const roleCfg = ROLE_CONFIG.compactionSummary;
    const summary = compactionBlock?.summary ?? "";
    const firstLine =
      summary
        .split("\n")
        .find((l) => l.trim() && !l.startsWith("#"))
        ?.trim() ?? summary.slice(0, 100);

    return (
      <div
        data-msg-card-id={message.id}
        className={`group/msgcard relative w-full py-1.5 transition-colors overflow-hidden ${roleCfg.bgColor}`}
      >
        <div
          className={`relative z-20 flex items-center gap-2 px-3 h-5 select-none border-l-[3px] ${roleCfg.barColor}`}
        >
          <span className={`flex items-center gap-1 text-[11px] font-medium ${roleCfg.color}`}>
            <Archive className="w-3 h-3" />
            {t("contextCompaction")}
          </span>
          {compactionBlock?.tokensBefore != null && (
            <span className="text-[10px] text-gray-400 dark:text-gray-600">
              {Math.round(compactionBlock.tokensBefore / 1000)}k tokens
            </span>
          )}
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(message.id);
              }}
              className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors"
              title={isCollapsed ? t("expand") : t("collapse")}
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "-rotate-90"}`}
              />
            </button>
            <span className="text-[10px] text-gray-400 dark:text-gray-600">{timeStr}</span>
          </div>
        </div>
        {isCollapsed ? (
          <div
            className={`relative z-20 border-l-[3px] ${roleCfg.barColor} px-3 py-1 text-xs text-gray-400 dark:text-gray-500 italic leading-relaxed`}
          >
            {firstLine}
          </div>
        ) : (
          <div className="relative z-20">
            <MessageBubble message={message} />
          </div>
        )}
      </div>
    );
  }

  let label = cardLabel ?? (isUser ? t("messageCard.you") : t("messageCard.assistant"));
  let IconComp;
  let labelColor: string;
  let barColor: string;
  let bgColor: string;
  const isEntry = hasCustomContent && customBlock;

  if (isEntry) {
    barColor = ENTRY_DEFAULT.barColor;
    bgColor = ENTRY_DEFAULT.bgColor;
    if (prevBarColor === ENTRY_DEFAULT.barColor) {
      barColor = ENTRY_DEFAULT.altBarColor;
      bgColor = ENTRY_DEFAULT.altBgColor;
    }
    const iconEntry = getCustomTypeIcon(customBlock.customType);
    IconComp = iconEntry.icon;
    labelColor = iconEntry.color;
    label = cardLabel ?? iconEntry.label;
  } else {
    const roleCfg =
      (message.role in ROLE_CONFIG
        ? ROLE_CONFIG[message.role as keyof typeof ROLE_CONFIG]
        : ROLE_CONFIG.assistant) ?? ROLE_CONFIG.assistant;
    IconComp = roleCfg.icon;
    labelColor = roleCfg.color;
    barColor = roleCfg.barColor;
    bgColor = roleCfg.bgColor;
  }

  const handleToggleCollapse = useCallback(() => {
    toggleCollapse(message.id);
  }, [message.id, toggleCollapse]);

  return (
    <div
      data-msg-card-id={message.id}
      className={`group/msgcard relative w-full py-1.5 transition-colors overflow-hidden ${isSelected ? "bg-red-500/[0.06]" : bgColor}`}
    >
      {isSelected && (
        <div className="absolute inset-0 bg-red-500/15 pointer-events-none z-10 rounded-sm" />
      )}
      {/* Header: checkbox + label + timestamp */}
      <div
        className={`relative z-20 flex items-center gap-2 px-3 h-5 select-none border-l-[3px] ${isSelected ? "border-l-red-500" : barColor}`}
      >
        {!isEntry && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleMessageSelection(message.id)}
            onClick={(e) => e.stopPropagation()}
            className="w-3 h-3 rounded border border-gray-400 dark:border-gray-600 accent-emerald-500 shrink-0 cursor-pointer"
          />
        )}

        {isEntry && MEMORY_CUSTOM_TYPES.has(customBlock?.customType ?? "") ? null : (
          <span className={`flex items-center gap-1 text-[11px] font-medium ${labelColor}`}>
            <IconComp className="w-3 h-3" />
            {label}
          </span>
        )}

        {!isUser && !isEntry && (message.provider ?? message.model) && (
          <span className="text-[10px] text-gray-400 dark:text-gray-600 opacity-0 group-hover/msgcard:opacity-100 transition-opacity">
            {message.provider}
            {message.model ? ` · ${message.model}` : ""}
          </span>
        )}

        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          {(isAssistant || isUser) && !isEntry && !isCollapsed && (
            <LazyHeaderActions message={message} isUserCard={isUser} />
          )}
          {(isAssistant || isUser || isEntry) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleCollapse();
              }}
              className="p-0.5 text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              title={isCollapsed ? t("expand") : t("collapse")}
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "-rotate-90"}`}
              />
            </button>
          )}
          <span className="text-[10px] text-gray-400 dark:text-gray-600">{timeStr}</span>
        </div>
      </div>

      {/* Content */}
      {isCollapsed ? (
        <div
          className={`relative z-20 border-l-[3px] ${isSelected ? "border-l-red-500" : barColor} px-3 py-1 text-xs text-gray-400 dark:text-gray-500 italic leading-relaxed`}
        >
          {message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join(" ")
            .slice(0, 120) || t("emptyTurn")}
        </div>
      ) : (
        <div className="relative z-20">
          <MessageBubble message={message} />
        </div>
      )}
    </div>
  );
});

const LazyHeaderActions = memo(function LazyHeaderActions({
  message,
  isUserCard,
}: {
  message: ChatMessage;
  isUserCard?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  if (!visible) {
    return (
      <span
        className="inline-flex items-center opacity-0 group-hover/msgcard:opacity-100 transition-opacity"
        onMouseEnter={() => setVisible(true)}
      >
        <span className="p-1 text-gray-500 dark:text-gray-700 cursor-pointer">···</span>
      </span>
    );
  }

  return <HeaderActions message={message} isUserCard={isUserCard} />;
});

const HeaderActions = memo(function HeaderActions({
  message,
  isUserCard,
}: {
  message: ChatMessage;
  isUserCard?: boolean;
}) {
  const { t } = useTranslation("chat");
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const messages = useChatStore((s) =>
    sessionId ? s.messagesBySession[sessionId] || EMPTY_MSGS : EMPTY_MSGS,
  );
  const pushNotification = useNotificationStore((s) => s.push);
  const rollingBackRef = useRef(false);
  const [confirmState, setConfirmState] = useState<{
    mode: "message" | "withFiles";
    targetId: string;
    preview: { restored: string[]; deleted: string[] };
  } | null>(null);

  const fetchTree = useCallback(async (): Promise<TreeEntry[] | null> => {
    if (!sessionId) return null;
    try {
      const tree = await apiClient.call("agent.getTree", { sessionId });
      return tree.entries ?? [];
    } catch {
      /* tree fetch failed */ return null;
    }
  }, [sessionId]);

  const resolveEntryId = useCallback(
    async (treeEntries?: TreeEntry[] | null): Promise<string | null> => {
      if (message.entryId) return message.entryId;
      const entries = treeEntries ?? (await fetchTree());
      if (!entries || !sessionId) return null;
      if (isUserCard) {
        const allUserMsgs = messages.filter((m) => m.role === "user");
        const userMsgIdx = allUserMsgs.findIndex((m) => m.id === message.id);
        const userTreeEntries = entries.filter((e) => e.type === "message" && e.label === "user");
        if (userMsgIdx !== -1 && userMsgIdx < userTreeEntries.length) {
          return userTreeEntries[userMsgIdx].id;
        }
        return null;
      }
      const allAssistantMsgs = messages.filter((m) => m.role === "assistant");
      const assistantMsgIdx = allAssistantMsgs.findIndex((m) => m.id === message.id);
      const assistantTreeEntries = entries.filter(
        (e) => e.type === "message" && e.label === "assistant",
      );
      if (assistantMsgIdx !== -1 && assistantMsgIdx < assistantTreeEntries.length) {
        return assistantTreeEntries[assistantMsgIdx].id;
      }
      return null;
    },
    [sessionId, message.id, message.entryId, messages, isUserCard, fetchTree],
  );

  const findTurnBoundary = useCallback((entryId: string, entries: TreeEntry[]): string | null => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    let current = byId.get(entryId);
    if (!current) return null;
    let currentLabel = current.label;
    if (currentLabel === "user") {
      return current.parentId ?? null;
    }
    while (current) {
      const parentId = current.parentId;
      if (parentId == null) return null;
      const parent = byId.get(parentId);
      if (!parent) return parentId;
      const parentLabel = parent.label;
      if (currentLabel === "assistant" && parentLabel === "user") {
        const grandParentId = parent.parentId;
        if (grandParentId == null) return null;
        const grandParent = byId.get(grandParentId);
        return grandParent ? grandParentId : null;
      }
      current = parent;
      currentLabel = parentLabel;
    }
    return null;
  }, []);

  const resolveRollbackTarget = useCallback(async (): Promise<{
    targetId: string;
    tree: TreeEntry[];
  } | null> => {
    if (!sessionId) return null;
    const tree = await fetchTree();
    if (!tree || tree.length === 0) return null;

    const entryId = await resolveEntryId(tree);
    if (!entryId) return null;
    const targetId = findTurnBoundary(entryId, tree);
    return targetId ? { targetId, tree } : null;
  }, [sessionId, fetchTree, resolveEntryId, findTurnBoundary]);

  const handleFork = useCallback(async () => {
    const tree = await fetchTree();
    const entryId = await resolveEntryId(tree);
    if (!sessionId || !entryId) return;
    const result = await apiClient
      .call("agent.fork", { sessionId, entryId, position: "at" })
      .catch((err) => {
        console.warn("[MessageCard] fork failed:", err);
        return undefined;
      });
    if (!result || result.cancelled || !result.newSessionId || !result.newSessionFile) return;
    const state = useSessionStore.getState();
    const activeTab = state.projectTabs.find((t: { id: string }) => t.id === state.activeProjectId);
    if (!activeTab) return;

    const now = Date.now();
    const forkedSession: SessionMeta = {
      sessionId: result.newSessionId,
      name: "",
      sessionPath: result.newSessionFile,
      projectPath: activeTab.path,
      parentSessionPath: null,
      messageCount: 0,
      firstMessage: "",
      createdAt: now,
      updatedAt: now,
      status: "idle",
    };

    useSessionStore.setState((s) => ({
      sessionsByProject: {
        ...s.sessionsByProject,
        [activeTab.path]: [forkedSession, ...(s.sessionsByProject[activeTab.path] || [])],
      },
    }));

    state.setActiveSession(result.newSessionId);
    useChatStore.getState().loadSessionMessages(result.newSessionId, { force: true });
    pushNotification({ message: t("messageCard.forked"), level: "info" });
  }, [sessionId, fetchTree, resolveEntryId, pushNotification]);

  const executeRollback = useCallback(
    async (mode: "message" | "withFiles") => {
      try {
        const result = await resolveRollbackTarget();
        if (!sessionId || !result) {
          pushNotification({ message: t("messageCard.rollbackFailed"), level: "error" });
          return;
        }
        const textToRefill = isUserCard
          ? message.content
              .filter((b): b is { type: "text"; text: string } => b.type === "text")
              .map((b) => b.text)
              .join("")
              .trim()
          : null;
        if (textToRefill) {
          const currentInput = useChatStore.getState().inputText?.trim();
          if (currentInput) {
            try {
              const HISTORY_KEY = "pi-input-history";
              const raw = localStorage.getItem(`${HISTORY_KEY}:${sessionId}`);
              const history: string[] = raw ? (JSON.parse(raw) as string[]) : [];
              if (!history.includes(currentInput)) {
                history.unshift(currentInput);
                localStorage.setItem(
                  `${HISTORY_KEY}:${sessionId}`,
                  JSON.stringify(history.slice(0, 10)),
                );
              }
            } catch {
              /* localStorage unavailable, ignore */
            }
          }
        }
        const skipFiles = mode === "message";
        await apiClient.call("agent.navigateTree", {
          sessionId,
          targetId: result.targetId,
          summarize: false,
          skipFiles,
        });
        await useChatStore.getState().loadSessionMessages(sessionId, { force: true });
        if (textToRefill) {
          useChatStore.getState().setInputText(textToRefill);
        }
        pushNotification({ message: t("messageCard.rollbackDone"), level: "info" });
      } catch (err) {
        pushNotification({
          message: t("messageCard.rollbackFailedMsg", {
            error: err instanceof Error ? err.message : "未知错误",
          }),
          level: "error",
        });
      }
    },
    [sessionId, resolveRollbackTarget, isUserCard, message, pushNotification],
  );

  const requestRollback = useCallback(
    async (mode: "message" | "withFiles") => {
      if (rollingBackRef.current) return;
      rollingBackRef.current = true;
      try {
        const result = await resolveRollbackTarget();
        if (!sessionId || !result) {
          pushNotification({ message: t("messageCard.rollbackFailed"), level: "error" });
          return;
        }
        if (mode === "message") {
          await executeRollback("message");
          return;
        }
        const preview = await apiClient
          .call("agent.rollbackPreview", { sessionId, targetId: result.targetId })
          .catch((err) => {
            console.warn("[MessageCard] rollbackPreview failed:", err);
            return { restored: [], deleted: [] };
          });
        setConfirmState({ mode, targetId: result.targetId, preview });
      } catch (err) {
        pushNotification({
          message: t("messageCard.previewFailed", {
            error: err instanceof Error ? err.message : "未知错误",
          }),
          level: "error",
        });
      } finally {
        rollingBackRef.current = false;
      }
    },
    [sessionId, resolveRollbackTarget, executeRollback, pushNotification],
  );

  const confirmRollback = useCallback(async () => {
    if (rollingBackRef.current) return;
    rollingBackRef.current = true;
    setConfirmState(null);
    try {
      await executeRollback("withFiles");
    } finally {
      rollingBackRef.current = false;
    }
  }, [executeRollback]);

  const cancelRollback = useCallback(() => {
    setConfirmState(null);
  }, []);

  return (
    <>
      <ActionBtn icon={GitBranch} title={t("fork")} onClick={handleFork} />
      <ActionBtn
        icon={Undo2}
        title={t("messageCard.rollbackMessage")}
        onClick={() => requestRollback("message")}
        disabled={rollingBackRef.current}
      />
      <ActionBtn
        icon={RotateCcw}
        title={t("messageCard.rollbackMessageAndCode")}
        onClick={() => requestRollback("withFiles")}
        disabled={rollingBackRef.current}
      />
      {confirmState && (
        <div className="absolute right-0 top-6 z-50 w-72 rounded-lg border border-amber-500/30 bg-gray-50 dark:bg-gray-900 px-3 py-2.5 shadow-xl">
          <div className="flex items-center gap-1.5 mb-1.5">
            <FileWarning className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] font-medium text-amber-300">
              {t("messageCard.rollbackPreview")}
            </span>
          </div>
          {confirmState.preview.restored.length > 0 && (
            <div className="mb-1">
              <span className="text-[10px] text-emerald-400">{t("messageCard.restore")}</span>
              <ul className="ml-2 mt-0.5 space-y-0.5 max-h-24 overflow-y-auto">
                {confirmState.preview.restored.map((f) => (
                  <li
                    key={f}
                    className="text-[10px] text-gray-700 dark:text-gray-300 truncate"
                    title={f}
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {confirmState.preview.deleted.length > 0 && (
            <div className="mb-1.5">
              <span className="text-[10px] text-red-400">{t("messageCard.deleteLabel")}</span>
              <ul className="ml-2 mt-0.5 space-y-0.5 max-h-24 overflow-y-auto">
                {confirmState.preview.deleted.map((f) => (
                  <li
                    key={f}
                    className="text-[10px] text-gray-700 dark:text-gray-300 truncate"
                    title={f}
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {confirmState.preview.restored.length === 0 &&
            confirmState.preview.deleted.length === 0 && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1.5">
                {t("messageCard.noFileChanges")}
              </p>
            )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                confirmRollback();
              }}
              className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-400 hover:bg-amber-500/30 transition-colors"
            >
              {t("messageCard.confirmRollback")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                cancelRollback();
              }}
              className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              {t("messageCard.cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
});

const ActionBtn = memo(function ActionBtn({
  icon: Icon,
  title,
  onClick,
  active,
  activeClassName,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
  onClick?: () => void;
  active?: boolean;
  activeClassName?: string;
  disabled?: boolean;
}) {
  if (!onClick) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      title={title}
      disabled={disabled}
      className={`p-1 rounded transition-colors ${disabled ? "text-gray-400 dark:text-gray-700 cursor-not-allowed" : active ? activeClassName : "text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50"}`}
    >
      {disabled ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Icon className={`w-3.5 h-3.5 ${active ? "fill-current" : ""}`} />
      )}
    </button>
  );
});

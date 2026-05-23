import { memo, useCallback, useRef } from "react";
import { ChevronDown, User, Bot, RotateCcw, Undo2, GitFork, Loader2, Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useRollbackStore } from "../../stores/use-rollback-store";
import { useForkDialogStore } from "../../stores/use-fork-dialog-store";

const EMPTY_MSGS: never[] = [];
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";
import type { TreeEntry } from "@dyyz1993/pi-coding-agent";
import {
  MessageBubble,
  MEMORY_HIDDEN_IN_CHAT,
  MEMORY_CUSTOM_TYPES,
  isLspCustomType,
  isLspVisibleInChat,
} from "./MessageBubble";
import type { ChatMessage, ContentBlock } from "../../types";
import type { ModifiedFile } from "../../stores/use-rollback-store";
import { getCustomTypeIcon } from "./tool-icon-map";

const log = createLogger("chat");

interface MessageCardProps {
  message: ChatMessage;
  cardLabel?: string;
  prevBarColor?: string;
  mergedResultData?: unknown;
}

const ROLE_CONFIG = {
  user: {
    icon: User,
    color: "text-status-info/80",
    barColor: "border-l-status-info/60",
    bgColor: "bg-status-info/[0.03]",
    altBarColor: "border-l-status-info/40",
    altBgColor: "bg-status-info/[0.02]",
  },
  assistant: {
    icon: Bot,
    color: "text-status-success/70",
    barColor: "border-l-status-success/50",
    bgColor: "bg-status-success/[0.03]",
    altBarColor: "border-l-status-success/30",
    altBgColor: "bg-status-success/[0.02]",
  },
  compactionSummary: {
    icon: Archive,
    color: "text-semantic-tool/70",
    barColor: "border-l-semantic-tool/50",
    bgColor: "bg-semantic-tool/[0.03]",
    altBarColor: "border-l-semantic-tool/30",
    altBgColor: "bg-semantic-tool/[0.02]",
  },
};

const ENTRY_DEFAULT = {
  barColor: "border-l-status-warning/50",
  labelColor: "text-status-warning/70",
  bgColor: "bg-status-warning/[0.04]",
  altBarColor: "border-l-status-warning/30",
  altBgColor: "bg-status-warning/[0.02]",
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
  mergedResultData,
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

  const handleToggleCollapse = useCallback(() => {
    toggleCollapse(message.id);
  }, [message.id, toggleCollapse]);

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
      if (
        !MEMORY_CUSTOM_TYPES.has(b.customType) &&
        !isLspCustomType(b.customType) &&
        b.customType !== "step_snapshot"
      )
        return true;
      return false;
    });
    if (allHidden) return null;
  }

  if (
    hasCustomContent &&
    customBlock &&
    (MEMORY_CUSTOM_TYPES.has(customBlock.customType) || customBlock.customType === "step_snapshot")
  ) {
    return (
      <div data-msg-card-id={message.id} className="relative w-full py-1.5">
        <MessageBubble message={message} mergedResultData={mergedResultData} />
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
            <span className="text-[10px] text-text-tertiary dark:text-text-secondary">
              {Math.round(compactionBlock.tokensBefore / 1000)}k tokens
            </span>
          )}
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(message.id);
              }}
              className="p-0.5 text-text-secondary hover:text-text-secondary transition-colors"
              title={isCollapsed ? t("expand") : t("collapse")}
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "-rotate-90"}`}
              />
            </button>
            <span className="text-[10px] text-text-tertiary dark:text-text-secondary">
              {timeStr}
            </span>
          </div>
        </div>
        {isCollapsed ? (
          <div
            className={`relative z-20 border-l-[3px] ${roleCfg.barColor} px-3 py-1 text-xs text-text-tertiary italic leading-relaxed`}
          >
            {firstLine}
          </div>
        ) : (
          <div className="relative z-20">
            <MessageBubble message={message} mergedResultData={mergedResultData} />
          </div>
        )}
      </div>
    );
  }

  let label =
    cardLabel ??
    (isUser
      ? t("messageCard.you")
      : (message.model ?? message.provider ?? t("messageCard.assistant")));
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

  return (
    <div
      data-msg-card-id={message.id}
      className={`group/msgcard relative w-full py-1.5 transition-colors overflow-hidden ${isSelected ? "bg-status-error/[0.06]" : bgColor}`}
    >
      {isSelected && (
        <div className="absolute inset-0 bg-status-error/15 pointer-events-none z-10 rounded-sm" />
      )}
      {/* Header: checkbox + label + timestamp */}
      <div
        className={`relative z-20 flex items-center gap-2 px-3 h-5 select-none border-l-[3px] ${isSelected ? "border-l-status-error" : barColor}`}
      >
        {!isEntry && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleMessageSelection(message.id)}
            onClick={(e) => e.stopPropagation()}
            className="w-3 h-3 rounded border border-border-secondary accent-status-success shrink-0 cursor-pointer"
          />
        )}

        {isEntry && MEMORY_CUSTOM_TYPES.has(customBlock?.customType ?? "") ? null : (
          <span className={`flex items-center gap-1 text-[11px] font-medium ${labelColor}`}>
            <IconComp className="w-3 h-3" />
            <span>{label}</span>
          </span>
        )}

        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          {(isAssistant || isUser) && !isEntry && (
            <HeaderActions message={message} isUserCard={isUser} />
          )}
          {(isAssistant || isUser || isEntry) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleCollapse();
              }}
              className="p-0.5 text-text-tertiary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-secondary transition-colors"
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "-rotate-90"}`}
              />
            </button>
          )}
          <span className="text-[10px] text-text-tertiary dark:text-text-secondary">{timeStr}</span>
        </div>
      </div>

      {/* Content */}
      {isCollapsed ? (
        <div
          className={`relative z-20 border-l-[3px] ${isSelected ? "border-l-status-error" : barColor} px-3 py-1 text-xs text-text-tertiary italic leading-relaxed`}
        >
          {message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join(" ")
            .slice(0, 120) || t("emptyTurn")}
        </div>
      ) : (
        <div className="relative z-20">
          <MessageBubble message={message} mergedResultData={mergedResultData} />
        </div>
      )}
    </div>
  );
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
  const isSessionStreaming = useSessionStore(
    useCallback(
      (s: { sessionStatusMap: Record<string, import("../../types").SessionStatus> }) => {
        const status = sessionId ? s.sessionStatusMap[sessionId] : undefined;
        return status === "streaming" || status === "compacting" || status === "retrying";
      },
      [sessionId],
    ),
  );
  const messages = useChatStore((s) =>
    sessionId ? s.messagesBySession[sessionId] || EMPTY_MSGS : EMPTY_MSGS,
  );
  const pushNotification = useNotificationStore((s) => s.push);
  const rollingBackRef = useRef(false);

  const fetchTree = useCallback(async (): Promise<TreeEntry[] | null> => {
    if (!sessionId) {
      log.warn("fetchTree skipped: no sessionId");
      return null;
    }
    try {
      const tree = await apiClient.call("agent.getTree", { sessionId });
      const entries = tree.entries ?? [];
      log.info("fetchTree result", { sessionId, entryCount: entries.length });
      return entries;
    } catch (err) {
      log.error("fetchTree failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }, [sessionId]);

  const resolveEntryId = useCallback(
    async (treeEntries?: TreeEntry[] | null): Promise<string | null> => {
      if (message.entryId) {
        log.info("resolveEntryId: using message.entryId", { entryId: message.entryId });
        return message.entryId;
      }
      const entries = treeEntries ?? (await fetchTree());
      if (!entries || !sessionId) {
        log.warn("resolveEntryId failed: no entries or sessionId", {
          hasEntries: !!entries,
          sessionId,
        });
        return null;
      }
      if (isUserCard) {
        const allUserMsgs = messages.filter((m) => m.role === "user");
        const userMsgIdx = allUserMsgs.findIndex((m) => m.id === message.id);
        const userTreeEntries = entries.filter((e) => e.type === "message" && e.label === "user");
        log.info("resolveEntryId: user card matching", {
          userMsgIdx,
          userMsgCount: allUserMsgs.length,
          userTreeCount: userTreeEntries.length,
        });
        if (userMsgIdx !== -1 && userMsgIdx < userTreeEntries.length) {
          return userTreeEntries[userMsgIdx].id;
        }
        log.warn("resolveEntryId: user index out of range", {
          userMsgIdx,
          userTreeCount: userTreeEntries.length,
        });
        return null;
      }
      const allAssistantMsgs = messages.filter((m) => m.role === "assistant");
      const assistantMsgIdx = allAssistantMsgs.findIndex((m) => m.id === message.id);
      const assistantTreeEntries = entries.filter(
        (e) => e.type === "message" && e.label === "assistant",
      );
      log.info("resolveEntryId: assistant card matching", {
        assistantMsgIdx,
        assistantMsgCount: allAssistantMsgs.length,
        assistantTreeCount: assistantTreeEntries.length,
      });
      if (assistantMsgIdx !== -1 && assistantMsgIdx < assistantTreeEntries.length) {
        return assistantTreeEntries[assistantMsgIdx].id;
      }
      log.warn("resolveEntryId: assistant index out of range", {
        assistantMsgIdx,
        assistantTreeCount: assistantTreeEntries.length,
      });
      return null;
    },
    [sessionId, message.id, message.entryId, messages, isUserCard, fetchTree],
  );

  const findTurnBoundary = useCallback((entryId: string, _entries: TreeEntry[]): string | null => {
    // The backend's navigateTree handles the parentId jump for all message types
    // (user, assistant, etc.), so the frontend just passes the clicked entryId directly.
    return entryId;
  }, []);

  const resolveRollbackTarget = useCallback(async (): Promise<{
    targetId: string;
    tree: TreeEntry[];
  } | null> => {
    if (!sessionId) {
      log.warn("resolveRollbackTarget: no sessionId");
      return null;
    }
    const tree = await fetchTree();
    if (!tree || tree.length === 0) {
      log.warn("resolveRollbackTarget: tree is empty", { treeLength: tree?.length ?? 0 });
      return null;
    }

    const entryId = await resolveEntryId(tree);
    if (!entryId) {
      log.warn("resolveRollbackTarget: resolveEntryId returned null", {
        messageId: message.id,
        isUserCard,
        treeSize: tree.length,
      });
      return null;
    }
    const targetId = findTurnBoundary(entryId, tree);
    if (!targetId) {
      log.warn("resolveRollbackTarget: findTurnBoundary returned null (first message?)", {
        entryId,
      });
      return null;
    }
    log.info("resolveRollbackTarget: success", { entryId, targetId });
    return targetId ? { targetId, tree } : null;
  }, [sessionId, fetchTree, resolveEntryId, findTurnBoundary]);

  const handleFork = useCallback(async () => {
    const tree = await fetchTree();
    const entryId = await resolveEntryId(tree);
    if (!sessionId || !entryId) return;
    useForkDialogStore.getState().openDialog({
      sessionId,
      entryId,
      source: "messageCard",
    });
  }, [sessionId, fetchTree, resolveEntryId]);

  const requestRollback = useCallback(
    async (mode: "message" | "withFiles") => {
      if (rollingBackRef.current) return;
      rollingBackRef.current = true;
      log.info("rollback requested", { sessionId, mode });
      try {
        if (!sessionId) {
          log.warn("rollback aborted: no active session");
          return;
        }

        const result = await resolveRollbackTarget();
        if (!result) {
          log.warn("rollback aborted: resolveRollbackTarget returned null", {
            sessionId,
            mode,
            messageId: message.id,
            hasEntryId: !!message.entryId,
            messagesCount: messages.length,
          });
          pushNotification({
            message: t("messageCard.rollbackFirstMessage"),
            level: "info",
          });
          return;
        }
        if (message.role === "user") {
          const currentInput = useChatStore.getState().inputText;
          if (currentInput.trim()) {
            const sid = useSessionStore.getState().activeSessionId;
            if (sid) {
              try {
                localStorage.setItem(`pi-draft:${sid}`, currentInput);
              } catch {
                /* ignore storage errors */
              }
            }
          }
          const userText = message.content
            .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
            .map((b) => b.text)
            .join("\n");
          if (userText) {
            useChatStore.getState().setInputText(userText);
          }
        }
        const emptyPreview = {
          restored: [] as string[],
          deleted: [] as string[],
          files: [] as never[],
          summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
        };
        const preview =
          mode === "withFiles"
            ? await (async () => {
                try {
                  const modResult = await apiClient.call("agent.getModifiedFiles", {
                    sessionId,
                    toEntryId: result.targetId,
                  });
                  const files: ModifiedFile[] = (
                    modResult as Array<{
                      path: string;
                      status: "added" | "modified" | "deleted";
                      turnIndex: number;
                      entryId: string;
                    }>
                  ).map((f) => ({
                    path: f.path,
                    status: f.status,
                    turnIndex: f.turnIndex,
                    entryId: f.entryId,
                  }));
                  const restored = files
                    .filter((f) => f.status === "modified" || f.status === "added")
                    .map((f) => f.path);
                  const deleted = files.filter((f) => f.status === "deleted").map((f) => f.path);
                  return {
                    restored,
                    deleted,
                    files,
                    summary: {
                      totalFiles: files.length,
                      added: files.filter((f) => f.status === "added").length,
                      modified: files.filter((f) => f.status === "modified").length,
                      deleted: deleted.length,
                    },
                  };
                } catch (err) {
                  log.warn("getModifiedFiles failed, using empty preview", {
                    err: err instanceof Error ? err.message : String(err),
                  });
                  return emptyPreview;
                }
              })()
            : emptyPreview;
        log.info("opening rollback overlay", {
          sessionId,
          mode,
          targetId: result.targetId,
          fileCount: preview.files.length,
        });
        useRollbackStore.getState().openRollback({ targetId: result.targetId, mode }, preview);
      } catch (err) {
        log.error("rollback request failed unexpectedly", {
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        rollingBackRef.current = false;
      }
    },
    [
      sessionId,
      resolveRollbackTarget,
      message.id,
      message.role,
      messages.length,
      messages,
      pushNotification,
    ],
  );

  return (
    <>
      <ActionBtn
        icon={GitFork}
        title={t("fork")}
        onClick={handleFork}
        disabled={isSessionStreaming}
      />
      <ActionBtn
        icon={Undo2}
        title={t("messageCard.rollbackMessage")}
        onClick={() => requestRollback("message")}
        disabled={rollingBackRef.current || isSessionStreaming}
      />
      <ActionBtn
        icon={RotateCcw}
        title={t("messageCard.rollbackMessageAndCode")}
        onClick={() => requestRollback("withFiles")}
        disabled={rollingBackRef.current || isSessionStreaming}
      />
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
      className={`p-1 rounded transition-colors ${disabled ? "text-text-tertiary dark:text-text-secondary cursor-not-allowed" : active ? activeClassName : "text-text-tertiary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-secondary hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50"}`}
    >
      {disabled ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Icon className={`w-3.5 h-3.5 ${active ? "fill-current" : ""}`} />
      )}
    </button>
  );
});

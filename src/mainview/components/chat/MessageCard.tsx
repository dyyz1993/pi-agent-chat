import { memo, useCallback, useRef } from "react";
import {
  ChevronDown,
  User,
  Bot,
  RotateCcw,
  Undo2,
  GitBranch,
  Loader2,
  Archive,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useRollbackStore } from "../../stores/use-rollback-store";
import { useTierStore } from "../../stores/use-tier-store";

const EMPTY_MSGS: never[] = [];
import { apiClient } from "../../lib/api-client";
import { insertAfterPinned } from "../../stores/use-session-store";
import { createLogger } from "../../../shared/lib/logger";
import type { SessionMeta } from "../../types";
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

const FILE_TOOLS = new Set(["edit", "write", "Edit", "Write"]);

function extractFileChanges(messages: ChatMessage[]): ModifiedFile[] {
  const seen = new Map<
    string,
    { status: ModifiedFile["status"]; details: string; addedLines: number; removedLines: number }
  >();

  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type !== "toolExecution") continue;
      const tb = block as Extract<ContentBlock, { type: "toolExecution" }>;
      if (!FILE_TOOLS.has(tb.toolName)) continue;
      try {
        const args: unknown = JSON.parse(tb.args || "{}");
        const filePath =
          typeof args === "object" && args !== null && "path" in args
            ? ((args as Record<string, unknown>).path as string | undefined)
            : undefined;
        if (!filePath || typeof filePath !== "string") continue;
        const status = tb.toolName.toLowerCase() === "write" ? "added" : "modified";
        let details = "";
        let addedLines = 0;
        let removedLines = 0;
        if (status === "added" && typeof args === "object" && args !== null) {
          const content = (args as Record<string, unknown>).content as string | undefined;
          if (content) {
            const lines = content.split("\n");
            addedLines = lines.length;
            const shown = lines
              .slice(0, 30)
              .map((l) => `+ ${l}`)
              .join("\n");
            details =
              lines.length > 30 ? `${shown}\n... (+${lines.length - 30} more lines)` : shown;
          }
        } else if (status === "modified" && typeof args === "object" && args !== null) {
          const oldContent = (args as Record<string, unknown>).oldContent as string | undefined;
          const newContent = (args as Record<string, unknown>).newContent as string | undefined;
          if (oldContent !== undefined && newContent !== undefined) {
            const oldLines = oldContent.split("\n");
            const newLines = newContent.split("\n");
            removedLines = oldLines.length;
            addedLines = newLines.length;
            const maxOld = oldLines
              .slice(0, 20)
              .map((l) => `- ${l}`)
              .join("\n");
            const maxNew = newLines
              .slice(0, 20)
              .map((l) => `+ ${l}`)
              .join("\n");
            const oldTrunc =
              oldLines.length > 20 ? `\n... (${oldLines.length - 20} more lines)` : "";
            const newTrunc =
              newLines.length > 20 ? `\n... (${newLines.length - 20} more lines)` : "";
            details = `${maxOld}${oldTrunc}\n---\n${maxNew}${newTrunc}`;
          } else {
            details = `参数: ${JSON.stringify(args).slice(0, 500)}`;
          }
        }
        if (!seen.has(filePath)) {
          seen.set(filePath, { status, details, addedLines, removedLines });
        }
      } catch {
        // args not valid JSON, skip
      }
    }
  }

  return Array.from(seen.entries()).map(([path, data], idx) => ({
    path,
    status: data.status,
    turnIndex: idx,
    entryId: "",
    details: data.details || undefined,
    addedLines: data.addedLines || undefined,
    removedLines: data.removedLines || undefined,
  }));
}

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
            <MessageBubble message={message} mergedResultData={mergedResultData} />
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
          {(isAssistant || isUser) && !isEntry && (
            <HeaderActions message={message} isUserCard={isUser} />
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

  const findTurnBoundary = useCallback((entryId: string, entries: TreeEntry[]): string | null => {
    const byId = new Map(entries.map((e) => [e.id, e]));

    const findAncestorMessage = (start: TreeEntry): TreeEntry | null => {
      let cur = start;
      while (cur.parentId) {
        const parent = byId.get(cur.parentId);
        if (!parent) return null;
        if (parent.type === "message") return parent;
        cur = parent;
      }
      return null;
    };

    const start = byId.get(entryId);
    if (!start) return null;

    const startMsg = start.type === "message" ? start : findAncestorMessage(start);
    if (!startMsg) return null;

    if (startMsg.label === "user") {
      const gp = findAncestorMessage(startMsg);
      return gp ? (gp.parentId ?? null) : (startMsg.parentId ?? null);
    }

    if (startMsg.label === "assistant") {
      const userMsg = findAncestorMessage(startMsg);
      if (!userMsg || userMsg.label !== "user") return null;
      const grandParent = findAncestorMessage(userMsg);
      if (!grandParent) return null;
      return grandParent.parentId ?? null;
    }

    return null;
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

    // Fetch original session name for the "fork:" prefix
    const allSessions = state.sessionsByProject[activeTab.path] ?? [];
    const originalSession = allSessions.find((s) => s.sessionId === sessionId);
    const originalName = originalSession
      ? originalSession.name || originalSession.firstMessage || ""
      : "";

    const now = Date.now();
    const forkedSession: SessionMeta = {
      sessionId: result.newSessionId,
      name: originalName ? `fork: ${originalName}` : "",
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
        [activeTab.path]: insertAfterPinned(
          s.sessionsByProject[activeTab.path] || [],
          forkedSession,
        ),
      },
    }));

    state.setActiveSession(result.newSessionId);
    useChatStore.getState().loadSessionMessages(result.newSessionId, { force: true });

    // Inherit current tier config
    const currentTier = useTierStore.getState().currentTier;
    if (currentTier) {
      useTierStore.getState().switchToTier(currentTier, result.newSessionId);
    }

    pushNotification({ message: t("messageCard.forked"), level: "info" });
  }, [sessionId, fetchTree, resolveEntryId, pushNotification]);

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
        const emptyPreview = {
          restored: [] as string[],
          deleted: [] as string[],
          files: [] as never[],
          summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
        };
        const preview =
          mode === "withFiles"
            ? (() => {
                // 找到 targetId 对应的消息位置，从那里到当前消息
                const targetIdx = result.targetId
                  ? messages.findIndex((m) => m.entryId === result.targetId)
                  : -1;
                const currentIdx = messages.findIndex((m) => m.id === message.id);
                // targetId 是回滚目标节点，它之后的消息到当前消息就是要被撤销的范围
                const fromIdx = targetIdx >= 0 ? targetIdx + 1 : 0;
                const toIdx = currentIdx >= 0 ? currentIdx + 1 : messages.length;
                const slice = messages.slice(fromIdx, toIdx);
                const fileOps = extractFileChanges(slice.length > 0 ? slice : messages);
                log.info("extracted file changes", {
                  fileCount: fileOps.length,
                  fromIdx,
                  toIdx,
                  sliceLen: slice.length,
                });
                return {
                  ...emptyPreview,
                  files: fileOps,
                  summary: {
                    totalFiles: fileOps.length,
                    added: fileOps.filter((f) => f.status === "added").length,
                    modified: fileOps.filter((f) => f.status === "modified").length,
                    deleted: 0,
                  },
                };
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
      message.entryId,
      messages.length,
      messages,
      pushNotification,
    ],
  );

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

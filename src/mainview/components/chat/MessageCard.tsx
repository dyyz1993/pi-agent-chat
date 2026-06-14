import { memo, useCallback } from "react";
import { ChevronDown, Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import {
  MessageBubble,
  MEMORY_HIDDEN_IN_CHAT,
  MEMORY_CUSTOM_TYPES,
  isLspCustomType,
  isLspVisibleInChat,
} from "./MessageBubble";
import type { ChatMessage } from "../../types";
import { getCustomTypeIcon } from "./tool-icon-map";
import { GoalCompleteCard } from "./GoalCompleteCard";
import {
  type MessageCardProps,
  ROLE_CONFIG,
  ENTRY_DEFAULT,
  formatTime,
  isRecoverableBoundaryStopReason,
} from "./message-card-helpers";
import { HeaderActions } from "./MessageCardHeader";
import { ErrorMessageCard } from "./ErrorMessageCard";

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

  const renderRole =
    message.role === "error" && isRecoverableBoundaryStopReason(message.stopReason)
      ? "assistant"
      : message.role;
  const displayMessage =
    renderRole === "assistant" && message.role === "error"
      ? ({ ...message, role: "assistant" as const } satisfies ChatMessage)
      : message;
  const isUser = renderRole === "user";
  const isAssistant = renderRole === "assistant";
  const isCompaction = renderRole === "compactionSummary";
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
        b.customType !== "step_snapshot" &&
        b.customType !== "supervisor_goal_complete"
      )
        return true;
      return false;
    });
    if (allHidden) return null;
  }

  if (
    hasCustomContent &&
    customBlock &&
    customBlock.customType === "supervisor_goal_complete"
  ) {
    return (
      <div data-msg-card-id={message.id} className="relative w-full py-1.5">
        <GoalCompleteCard
          data={(customBlock as { data?: unknown }).data}
          blockId={message.id}
        />
      </div>
    );
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

  if (renderRole === "error") {
    const textBlock = message.content.find(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
    );
    const fullText = textBlock?.text ?? "Unknown error";
    const lines = fullText.split("\n");
    const title = lines[0];
    const detail = lines.slice(1).join("\n").trim();
    return (
      <ErrorMessageCard
        message={message}
        title={title}
        detail={detail}
        stopReason={message.stopReason}
      />
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
      (renderRole in ROLE_CONFIG
        ? ROLE_CONFIG[renderRole as keyof typeof ROLE_CONFIG]
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
          {isUser && !isEntry && <HeaderActions message={message} isUserCard={isUser} />}
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
          <MessageBubble message={displayMessage} mergedResultData={mergedResultData} />
        </div>
      )}
    </div>
  );
});

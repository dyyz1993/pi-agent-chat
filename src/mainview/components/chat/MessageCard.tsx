import { memo, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
import {
  formatBashBackgroundReason,
  formatBashBackgroundTrigger,
  isBashBackgroundProcessType,
  normalizeBashBackgroundProcess,
} from "./bash-background-process";
import {
  CHAT_CARD_HEADER_BASE_CLASS,
  CHAT_CARD_INTERACTIVE_SHELL_CLASS,
  CHAT_CARD_SHELL_CLASS,
} from "./chat-layout-classes";

const COLLAPSED_PREVIEW_LIMIT = 120;

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
}

function cleanPreviewText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, COLLAPSED_PREVIEW_LIMIT);
}

function getCustomBlockPreview(block: Extract<ChatMessage["content"][number], { type: "custom" }>) {
  if (MEMORY_HIDDEN_IN_CHAT.has(block.customType)) return null;
  if (isLspCustomType(block.customType) && !isLspVisibleInChat(block.customType)) return null;

  if (isBashBackgroundProcessType(block.customType)) {
    const data = normalizeBashBackgroundProcess(block.data);
    if (!data) return null;
    return cleanPreviewText(
      [
        formatBashBackgroundReason(data),
        formatBashBackgroundTrigger(data.backgroundTrigger),
        data.duration,
        data.command,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  if (
    MEMORY_CUSTOM_TYPES.has(block.customType) ||
    block.customType === "step_snapshot" ||
    block.customType === "pi-goal-complete"
  ) {
    return cleanPreviewText(block.customType);
  }

  return null;
}

function getCollapsedPreview(message: ChatMessage, emptyText: string): string {
  for (const block of message.content) {
    switch (block.type) {
      case "text": {
        const preview = cleanPreviewText(block.text);
        if (preview) return preview;
        break;
      }
      case "thinking": {
        const preview = cleanPreviewText(`思考: ${block.thinking}`);
        if (preview) return preview;
        break;
      }
      case "toolCall": {
        const preview = cleanPreviewText(`${block.name}: ${block.input}`);
        if (preview) return preview;
        break;
      }
      case "toolResult": {
        const preview = cleanPreviewText(`${block.toolName}: ${block.content}`);
        if (preview) return preview;
        break;
      }
      case "toolExecution": {
        const preview = cleanPreviewText(
          block.description ?? block.output ?? `${block.toolName} · ${block.status}`,
        );
        if (preview) return preview;
        break;
      }
      case "custom": {
        const preview = getCustomBlockPreview(block);
        if (preview) return preview;
        break;
      }
      case "compactionSummary": {
        const preview = cleanPreviewText(block.summary);
        if (preview) return preview;
        break;
      }
      case "imageBlock": {
        const preview = cleanPreviewText(block.alt ? `图片: ${block.alt}` : "图片");
        if (preview) return preview;
        break;
      }
      case "uiInteraction": {
        const preview = cleanPreviewText(
          block.title ?? block.message ?? block.toolName ?? block.method,
        );
        if (preview) return preview;
        break;
      }
    }
  }

  return emptyText;
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
  const collapseButtonLabel = isCollapsed ? t("expand") : t("collapse");

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
        !isBashBackgroundProcessType(b.customType) &&
        b.customType !== "step_snapshot" &&
        b.customType !== "pi-goal-complete"
      )
        return true;
      return false;
    });
    if (allHidden) return null;
  }

  if (hasCustomContent && customBlock && customBlock.customType === "pi-goal-complete") {
    return (
      <div data-msg-card-id={message.id} className={CHAT_CARD_SHELL_CLASS}>
        <GoalCompleteCard data={(customBlock as { data?: unknown }).data} blockId={message.id} />
      </div>
    );
  }

  if (
    hasCustomContent &&
    customBlock &&
    (MEMORY_CUSTOM_TYPES.has(customBlock.customType) || customBlock.customType === "step_snapshot")
  ) {
    return (
      <div data-msg-card-id={message.id} className={CHAT_CARD_SHELL_CLASS}>
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
    return (
      <div data-msg-card-id={message.id} className={CHAT_CARD_SHELL_CLASS}>
        <MessageBubble message={message} mergedResultData={mergedResultData} />
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

  const collapseAtStart = isEntry || isUser;
  const collapseAtEnd = isAssistant;
  const collapseButton = (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleToggleCollapse();
      }}
      className="p-0.5 text-text-tertiary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-secondary transition-colors shrink-0"
      title={collapseButtonLabel}
      aria-label={collapseButtonLabel}
    >
      <CollapseIcon collapsed={isCollapsed} />
    </button>
  );

  return (
    <div
      data-msg-card-id={message.id}
      className={`${CHAT_CARD_INTERACTIVE_SHELL_CLASS} ${isSelected ? "bg-status-error/[0.06]" : bgColor}`}
    >
      {isSelected && (
        <div className="absolute inset-0 bg-status-error/15 pointer-events-none z-10 rounded-sm" />
      )}
      {/* Header: checkbox + label + timestamp */}
      <div
        className={`${CHAT_CARD_HEADER_BASE_CLASS} ${isSelected ? "border-l-status-error" : barColor}`}
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

        {collapseAtStart && collapseButton}

        {isEntry && MEMORY_CUSTOM_TYPES.has(customBlock?.customType ?? "") ? null : (
          <span className={`flex items-center gap-1 text-[11px] font-medium ${labelColor}`}>
            <IconComp className="w-3 h-3" />
            <span>{label}</span>
          </span>
        )}

        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          {isUser && !isEntry && <HeaderActions message={message} isUserCard={isUser} />}
          {collapseAtEnd && collapseButton}
          <span className="text-[10px] text-text-tertiary dark:text-text-secondary">{timeStr}</span>
        </div>
      </div>

      {/* Content */}
      {isCollapsed ? (
        <div
          className={`relative z-20 border-l-[3px] ${isSelected ? "border-l-status-error" : barColor} px-3 py-1 text-xs text-text-tertiary italic leading-relaxed`}
        >
          {getCollapsedPreview(message, t("emptyTurn"))}
        </div>
      ) : (
        <div className="relative z-20">
          <MessageBubble message={displayMessage} mergedResultData={mergedResultData} />
        </div>
      )}
    </div>
  );
});

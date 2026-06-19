import { useCallback, memo, useMemo, useRef, useState } from "react";
import { ImageViewerOverlay } from "../primitives";
import { CopyButton } from "./CopyButton";
import type { ChatMessage, ContentBlock } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSettingsStore } from "../../stores/use-settings-store";
import { useUIBlockMap } from "../../stores/use-ui-dialog-store";
import { BlockErrorBoundary } from "./tool-renderers/BlockErrorBoundary";
import { parseSpecialBlocks, hasSpecialBlocks } from "./special-block-parser";
import { getRegisteredTags, getRenderer } from "./special-block-registry";
import "./special-block-renderers";
import { ContentBlockRenderer } from "./ContentBlockRenderer";
import { MessageMetaFooter } from "./MessageMetaFooter";
import { getBlockBorderColor, getDefaultBorderColor } from "./block-border";
import {
  MEMORY_HIDDEN_IN_CHAT,
  isLspCustomType,
  isLspVisibleInChat,
} from "./lsp-constants";
import { MEMORY_CUSTOM_TYPES } from "./MemoryCard";
import { isBashBackgroundProcessType } from "./bash-background-process";

// Re-exports for backward compatibility
export { ThinkingCard } from "./ThinkingCard";
export { LspDiagnosticsCard } from "./LspDiagnosticsCard";
export { ToolExecutionCard } from "./ToolExecutionCard";
export { ContentBlockRenderer } from "./ContentBlockRenderer";
export type { ContentBlockRendererProps } from "./ContentBlockRenderer";
export { MessageMetaFooter } from "./MessageMetaFooter";
export {
  MEMORY_HIDDEN_IN_CHAT,
  isLspCustomType,
  isLspVisibleInChat,
  LSP_CUSTOM_TYPES_SET,
  LSP_VISIBLE_TYPES,
} from "./lsp-constants";
export { MEMORY_CUSTOM_TYPES } from "./MemoryCard";
export { getBlockBorderColor, getDefaultBorderColor } from "./block-border";

function renderUserTextWithLinks(text: string, keyPrefix: number | string) {
  const urlRegex = /(https?:\/\/[^\s<|」》)>]+)/g;
  const parts = text.split(urlRegex);
  if (parts.length === 1) {
    return <span key={keyPrefix}>{text}</span>;
  }
  return (
    <span key={keyPrefix}>
      {parts.map((part, j) =>
        urlRegex.test(part) ? (
          <a
            key={j}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-status-info hover:underline break-all"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </span>
  );
}

export interface MessageBubbleProps {
  message: ChatMessage;
  mergedResultData?: unknown;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  mergedResultData,
}: MessageBubbleProps) {
  const sessionId = useSessionStore((s) => s.activeSessionId);

  const isUser = message.role === "user";
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const uiBlockMap = useUIBlockMap(message.content, sessionId ?? "");
  const isActive = useChatNavStore(
    useCallback(
      (s) => (sessionId ? (s.activeIdBySession[sessionId] ?? null) === message.id : false),
      [sessionId, message.id],
    ),
  );
  const isSelected = useChatNavStore(
    useCallback(
      (s) =>
        sessionId ? (s.selectedItemsBySession[sessionId] ?? EMPTY_SET).has(message.id) : false,
      [sessionId, message.id],
    ),
  );

  const styleMemo = useMemo(() => {
    let bg = "";
    if (isSelected) {
      bg = "bg-semantic-accent/[0.06]";
    } else if (isActive) {
      bg = "bg-status-info/[0.04]";
    }
    return { bg, isUser };
  }, [isSelected, isActive, isUser]);

  const contentRef = useRef(message.content);
  contentRef.current = message.content;
  const fullTextGetter = useCallback(() => {
    const content = contentRef.current;
    if (isUser) {
      return content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }
    return content
      .map((b) => {
        if (b.type === "text") return b.text;
        if (b.type === "thinking") return `Thinking:\n${b.thinking}`;
        if (b.type === "toolCall") return `[Tool: ${b.name}] ${b.input}`;
        if (b.type === "toolResult")
          return b.isError ? `[Error] ${b.content}` : `[Result] ${b.content}`;
        if (b.type === "toolExecution")
          return `[Execution: ${b.toolName}]\nInput: ${b.args ?? ""}\nOutput: ${b.output ?? ""}`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }, [isUser]);

  return (
    <div
      id={`msg-${message.id}`}
      data-msg-id={message.id}
      className="group relative w-full min-w-0"
    >
      {isSelected && (
        <div className="absolute inset-0 rounded-lg bg-semantic-accent/[0.06] pointer-events-none" />
      )}
      {isUser ? (
        <div
          className={`relative my-0.5 mr-2 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-text-primary bg-status-info/[0.06] dark:bg-status-info/[0.12] rounded-r-lg border-l-[3px] border-l-status-info/60 dark:border-l-status-info/80 ${styleMemo.bg} min-w-0`}
        >
          <div className="absolute -top-0.5 right-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10">
            <CopyButton textGetter={fullTextGetter} size="xs" />
          </div>
          {message.content.map((block, i) => {
            if (block.type === "text") {
              const text = (block as Extract<ContentBlock, { type: "text" }>).text;

              try {
                const tags = getRegisteredTags();
                if (!hasSpecialBlocks(text, tags)) {
                  return renderUserTextWithLinks(text, i);
                }

                const segments = parseSpecialBlocks(text, tags);
                return (
                  <span key={i}>
                    {segments.map((seg, si) => {
                      if (seg.type === "special-block") {
                        const Renderer = getRenderer(seg.tag);
                        if (Renderer) return <Renderer key={`sb-${si}`} block={seg} />;
                        return renderUserTextWithLinks(seg.raw, `raw-${si}`);
                      }
                      return renderUserTextWithLinks(seg.text, `text-${si}`);
                    })}
                  </span>
                );
              } catch {
                return renderUserTextWithLinks(text, i);
              }
            }

            if (block.type === "imageBlock") {
              const imgBlock = block as Extract<ContentBlock, { type: "imageBlock" }>;
              return (
                <div key={i} className="mt-1.5">
                  <img
                    src={imgBlock.url}
                    alt={imgBlock.alt ?? ""}
                    className="max-w-[240px] max-h-[180px] rounded-lg border border-border-secondary/50 cursor-pointer hover:opacity-90 transition-opacity"
                    loading="lazy"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedImage(imgBlock.url);
                    }}
                  />
                </div>
              );
            }

            return null;
          })}
        </div>
      ) : (
        <div className={`w-full text-text-primary transition-colors ${styleMemo.bg} min-w-0`}>
          {message.content.map((block, i) => {
            const role = message.role as "user" | "assistant";
            const isEntryMsg = message.content.some((b) => b.type === "custom");
            if (block.type === "custom" && MEMORY_HIDDEN_IN_CHAT.has(block.customType)) {
              return null;
            }
            if (
              block.type === "custom" &&
              isLspCustomType(block.customType) &&
              !isLspVisibleInChat(block.customType)
            ) {
              return null;
            }
            if (
              block.type === "custom" &&
              !MEMORY_CUSTOM_TYPES.has(block.customType) &&
              !isLspCustomType(block.customType) &&
              !isBashBackgroundProcessType(block.customType)
            ) {
              return null;
            }
            const borderColor = getBlockBorderColor(block, role);
            return (
              <div key={i} className={`border-l-[3px] ${borderColor}`}>
                <BlockErrorBoundary blockId={`${message.id}-${i}`}>
                  <ContentBlockRenderer
                    block={block}
                    isStreaming={message.isStreaming}
                    msgId={message.id}
                    blockIndex={i}
                    isEntry={isEntryMsg}
                    uiBlockMap={uiBlockMap}
                    mergedResultData={mergedResultData}
                  />
                </BlockErrorBoundary>
              </div>
            );
          })}
          {message.isStreaming && (
            <div
              className={`border-l-[3px] ${getDefaultBorderColor(message.role as "user" | "assistant")}`}
            >
              <span className="inline-block w-1.5 h-4 bg-semantic-accent animate-pulse ml-3 align-text-bottom" />
            </div>
          )}
          {message.tokenUsage &&
            (() => {
              const mode = useSettingsStore.getState().chatViewMode;
              return mode !== "clean";
            })() && (
              <div
                className={`border-l-[3px] ${getDefaultBorderColor(message.role as "user" | "assistant")}`}
              >
                <MessageMetaFooter message={message} />
              </div>
            )}
        </div>
      )}

      {expandedImage && (
        <ImageViewerOverlay
          src={expandedImage}
          onClose={() => setExpandedImage(null)}
        />
      )}
    </div>
  );
});

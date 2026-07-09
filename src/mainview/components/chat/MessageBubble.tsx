import { useCallback, memo, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ImageViewerOverlay } from "../primitives";
import { CopyButton } from "./CopyButton";
import type { ChatMessage, ContentBlock, UIInteractionBlock } from "../../types";
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
import { stripContextReferenceTags } from "./ContextReferenceCard";
import { stripHookInterventionTags } from "./HookInterventionCard";
import { getBlockBorderColor, getDefaultBorderColor } from "./block-border";
import { MEMORY_HIDDEN_IN_CHAT, isLspCustomType, isLspVisibleInChat } from "./lsp-constants";
import { MEMORY_CUSTOM_TYPES } from "./MemoryCard";
import { isBashBackgroundProcessType } from "./bash-background-process";
import { SUPERVISOR_CONTINUE_CUSTOM_TYPE } from "./SupervisorContinueCard";

export const TOOL_BLOCK_RENDER_WINDOW_SIZE = 50;

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

type ToolLikeContentBlock = Extract<
  ContentBlock,
  { type: "toolCall" } | { type: "toolResult" } | { type: "toolExecution" }
>;

type AssistantRenderItem =
  | { kind: "block"; block: ContentBlock; index: number }
  | { kind: "collapsed-tools"; key: string; blocks: ToolLikeContentBlock[] };

function isToolLikeBlock(block: ContentBlock): block is ToolLikeContentBlock {
  return block.type === "toolCall" || block.type === "toolResult" || block.type === "toolExecution";
}

function getToolLikeBlockId(block: ToolLikeContentBlock): string | undefined {
  if (block.type === "toolExecution") return block.toolCallId;
  if (block.type === "toolCall") return block.id;
  return block.toolCallId;
}

function isForcedVisibleToolBlock(
  block: ToolLikeContentBlock,
  uiBlockMap: Map<string, UIInteractionBlock>,
): boolean {
  if (block.type === "toolExecution") {
    if (block.status === "running" || block.status === "error") return true;
  }
  if (block.type === "toolResult" && block.isError) return true;
  const toolId = getToolLikeBlockId(block);
  const uiBlock = toolId ? uiBlockMap.get(toolId) : undefined;
  return uiBlock?.status === "pending";
}

function isToolBlockVisibleBySettings({
  block,
  showToolCalls,
  showToolResults,
}: {
  block: ToolLikeContentBlock;
  showToolCalls: boolean;
  showToolResults: boolean;
}): boolean {
  if (block.type === "toolResult") return showToolResults;
  return showToolCalls;
}

function compactToolName(block: ToolLikeContentBlock): string {
  if (block.type === "toolCall") return block.name;
  return block.toolName;
}

export function buildAssistantRenderItems({
  content,
  uiBlockMap,
  visibleOlderToolCount = 0,
  windowSize = TOOL_BLOCK_RENDER_WINDOW_SIZE,
  showToolCalls = true,
  showToolResults = true,
}: {
  content: ContentBlock[];
  uiBlockMap: Map<string, UIInteractionBlock>;
  visibleOlderToolCount?: number;
  windowSize?: number;
  showToolCalls?: boolean;
  showToolResults?: boolean;
}): AssistantRenderItem[] {
  const foldableToolIndexes: number[] = [];
  content.forEach((block, index) => {
    if (
      isToolLikeBlock(block) &&
      isToolBlockVisibleBySettings({ block, showToolCalls, showToolResults }) &&
      !isForcedVisibleToolBlock(block, uiBlockMap)
    ) {
      foldableToolIndexes.push(index);
    }
  });

  const visibleToolStart = Math.max(
    0,
    foldableToolIndexes.length - windowSize - visibleOlderToolCount,
  );
  const hiddenToolIndexes = new Set(foldableToolIndexes.slice(0, visibleToolStart));
  const items: AssistantRenderItem[] = [];
  let collapsedBlocks: ToolLikeContentBlock[] = [];
  let collapsedStartIndex: number | null = null;

  const flushCollapsed = () => {
    if (collapsedBlocks.length === 0 || collapsedStartIndex == null) return;
    items.push({
      kind: "collapsed-tools",
      key: `collapsed-tools-${collapsedStartIndex}-${collapsedBlocks.length}`,
      blocks: collapsedBlocks,
    });
    collapsedBlocks = [];
    collapsedStartIndex = null;
  };

  content.forEach((block, index) => {
    if (hiddenToolIndexes.has(index) && isToolLikeBlock(block)) {
      collapsedStartIndex ??= index;
      collapsedBlocks.push(block);
      return;
    }
    flushCollapsed();
    items.push({ kind: "block", block, index });
  });
  flushCollapsed();

  return items;
}

function CollapsedToolBlockGroup({
  blocks,
  onShowMore,
}: {
  blocks: ToolLikeContentBlock[];
  onShowMore: () => void;
}) {
  const names = Array.from(new Set(blocks.map(compactToolName).filter(Boolean))).slice(0, 4);
  const errorCount = blocks.filter(
    (block) =>
      (block.type === "toolExecution" && block.status === "error") ||
      (block.type === "toolResult" && block.isError),
  ).length;
  const suffix =
    blocks.length > TOOL_BLOCK_RENDER_WINDOW_SIZE ? `+${TOOL_BLOCK_RENDER_WINDOW_SIZE}` : "all";

  return (
    <div className="border-l-[3px] border-l-border-secondary/60">
      <div className="my-0.5 flex min-h-8 items-center gap-2 bg-surface-dim/40 px-3 py-1.5 text-[11px] text-text-secondary">
        <span className="shrink-0 rounded border border-border-secondary/60 bg-bg-secondary/70 px-1.5 py-0.5 font-medium text-text-tertiary">
          {blocks.length} older tools
        </span>
        <span className="min-w-0 flex-1 truncate">
          {names.length > 0 ? names.join(", ") : "Tool calls collapsed"}
          {errorCount > 0 ? ` · ${errorCount} errors` : ""}
        </span>
        <button
          type="button"
          onClick={onShowMore}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-border-secondary/70 px-2 py-0.5 text-status-info hover:border-status-info/60 hover:bg-status-info/10"
        >
          <ChevronDown className="h-3 w-3" />
          Show {suffix}
        </button>
      </div>
    </div>
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
  const [visibleOlderToolCount, setVisibleOlderToolCount] = useState(0);
  const uiBlockMap = useUIBlockMap(message.content, sessionId ?? "");
  const showToolCalls = useSettingsStore((s) => s.showToolCalls);
  const showToolResults = useSettingsStore((s) => s.showToolResults);
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

  const assistantRenderItems = useMemo(
    () =>
      isUser
        ? []
        : buildAssistantRenderItems({
            content: message.content,
            uiBlockMap,
            visibleOlderToolCount,
            showToolCalls,
            showToolResults,
          }),
    [isUser, message.content, showToolCalls, showToolResults, uiBlockMap, visibleOlderToolCount],
  );

  const showMoreOlderTools = useCallback(() => {
    setVisibleOlderToolCount((count) => count + TOOL_BLOCK_RENDER_WINDOW_SIZE);
  }, []);

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
        if (b.type === "text") return stripHookInterventionTags(stripContextReferenceTags(b.text));
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
          {assistantRenderItems.map((item) => {
            if (item.kind === "collapsed-tools") {
              return (
                <CollapsedToolBlockGroup
                  key={item.key}
                  blocks={item.blocks}
                  onShowMore={showMoreOlderTools}
                />
              );
            }
            const { block, index: i } = item;
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
              !isBashBackgroundProcessType(block.customType) &&
              block.customType !== SUPERVISOR_CONTINUE_CUSTOM_TYPE
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
        <ImageViewerOverlay src={expandedImage} onClose={() => setExpandedImage(null)} />
      )}
    </div>
  );
});

import { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Brain,
  AlertTriangle,
  FileText,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { ImageViewerOverlay } from "../primitives";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import { CopyButton } from "./CopyButton";
import { TextContentCard } from "./TextContentCard";
import type { ChatMessage, ContentBlock, UIInteractionBlock } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { SubagentExecutionCard } from "./tool-renderers/SubagentRenderer";
import { UIInteractionCard } from "./tool-renderers/UICardRenderer";
import { getToolRenderer } from "./tool-renderers";
import { BlockErrorBoundary } from "./tool-renderers/BlockErrorBoundary";
import { tryFormatAsYaml } from "../../../shared/lib/json-to-yaml";
import { useSettingsStore } from "../../stores/use-settings-store";
import { useUIBlockMap } from "../../stores/use-ui-dialog-store";
import { MEMORY_CUSTOM_TYPES, MemoryCard } from "./MemoryCard";
import { SnapshotBadge } from "./snapshot/SnapshotBadge";
import { formatFilePath } from "../../lib/format-path";
import { getToolArgsDescription } from "../../lib/tool-args-description";
import { formatTokenCount } from "../../utils/turn-utils";
import { ToolCardHeader } from "./primitives/ToolCardHeader";
import { parseSpecialBlocks, hasSpecialBlocks } from "./special-block-parser";
import { getRegisteredTags, getRenderer } from "./special-block-registry";
import "./special-block-renderers";

export { MEMORY_CUSTOM_TYPES } from "./MemoryCard";

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

export function getBlockBorderColor(block: ContentBlock, role: "user" | "assistant"): string {
  const roleDefault = role === "user" ? "border-l-status-info/60" : "border-l-status-success/60";

  switch (block.type) {
    case "thinking":
      return "border-l-semantic-agent/60 dark:border-l-semantic-agent/70";
    case "toolCall":
      return "border-l-status-warning/70 dark:border-l-status-warning/80";
    case "toolResult":
      return block.isError
        ? "border-l-status-error/70 dark:border-l-status-error/80"
        : "border-l-status-success/60 dark:border-l-status-success/70";
    case "toolExecution": {
      if (block.toolName.toLowerCase() === "subagent") {
        return block.status === "error"
          ? "border-l-status-error/70 dark:border-l-status-error/80"
          : "border-l-semantic-agent/60 dark:border-l-semantic-agent/70";
      }
      if (block.status === "running") return "border-l-status-info/70 dark:border-l-status-info/80 animate-pulse";
      if (block.status === "error") return "border-l-status-error/70 dark:border-l-status-error/80";
      return "border-l-semantic-tool/60 dark:border-l-semantic-tool/70";
    }
    case "custom": {
      const ct = block.customType;
      if (LSP_CUSTOM_TYPES_SET.has(ct)) return "border-l-status-warning/50 dark:border-l-status-warning/60";
      if (ct.startsWith("memory_prefetch")) return "border-l-status-info/50 dark:border-l-status-info/60";
      if (ct.startsWith("memory_dream")) return "border-l-semantic-agent/50 dark:border-l-semantic-agent/60";
      if (ct.startsWith("memory_extract")) return "border-l-status-success/50 dark:border-l-status-success/60";
      if (ct === "memory_created") return "border-l-semantic-memory/50 dark:border-l-semantic-memory/60";
      if (ct === "memory_failed") return "border-l-status-error/50 dark:border-l-status-error/60";
      if (ct === "step_snapshot") return "border-l-semantic-accent/50 dark:border-l-semantic-accent/60";
      return roleDefault;
    }
    case "compactionSummary":
      return "border-l-semantic-tool/50 dark:border-l-semantic-tool/60";
    case "uiInteraction": {
      if (block.status === "pending") return "border-l-status-warning/60 dark:border-l-status-warning/70";
      if (block.status === "responded") return "border-l-status-success/60 dark:border-l-status-success/70";
      if (block.status === "dismissed") return "border-l-text-tertiary/40";
      return "border-l-semantic-tool/50 dark:border-l-semantic-tool/60";
    }
    default:
      return roleDefault;
  }
}

function getDefaultBorderColor(role: "user" | "assistant"): string {
  return role === "user" ? "border-l-status-info/60" : "border-l-status-success/50";
}

interface MessageBubbleProps {
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
              !isLspCustomType(block.customType)
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

export const ThinkingCard = memo(function ThinkingCard({
  thinking,
  isStreaming,
  blockId,
}: {
  thinking: string;
  isStreaming: boolean;
  blockId: string;
}) {
  const { t } = useTranslation("chat");
  const collapseThinking = useSettingsStore((s) => s.collapseThinking);
  const [isOpen, setIsOpen] = useState(() => (collapseThinking ? isStreaming : true));

  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setIsOpen(!collapseThinking);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, collapseThinking]);

  const trimmed = thinking.trim();
  const firstLine = trimmed.split("\n")[0] || "";
  const collapsedText = firstLine.length > 100 ? firstLine.slice(0, 100) + "…" : firstLine;

  return (
    <div className="my-0.5 overflow-hidden" data-block-id={blockId}>
      {/* Header row — when collapsed, shows icon + truncated text + buttons all on one line */}
      <div
        className={`px-3 py-1 text-[11px] flex items-center gap-2 ${!isStreaming ? "cursor-pointer hover:bg-surface-hover/30 dark:hover:bg-surface-dim/30" : ""}`}
        onClick={() => !isStreaming && setIsOpen(!isOpen)}
      >
        <Brain className="w-3 h-3 text-semantic-agent/60 shrink-0" />
        {isOpen ? (
          <span className="text-semantic-agent/70 font-medium">{t("thinkingLabel")}</span>
        ) : collapsedText ? (
          <span className="text-text-secondary truncate flex-1 min-w-0">{collapsedText}</span>
        ) : (
          <span className="text-semantic-agent/50 italic">{t("thinkingPlaceholder")}</span>
        )}
        {isStreaming && (
          <span className="text-semantic-agent/50 animate-pulse text-[10px]">...</span>
        )}
        {!isStreaming && (
          <div
            className="ml-auto flex items-center gap-0.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsOpen(!isOpen)}
              title={isOpen ? t("collapse") : t("expand")}
              className="p-0.5 text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors"
            >
              {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <CopyButton text={thinking} size="xs" title={t("copyThinkingContent")} />
          </div>
        )}
      </div>

      {isOpen && (
        <div className="px-3 pb-2 text-[11px] text-text-secondary whitespace-pre-wrap leading-relaxed">
          {thinking || (
            <span className="text-text-secondary italic">{t("thinkingPlaceholder")}</span>
          )}
        </div>
      )}
    </div>
  );
});

export const MEMORY_HIDDEN_IN_CHAT = new Set<string>([]);

const LSP_CUSTOM_TYPES: Record<string, { label: string; color: string }> = {
  lsp: { label: "LSP", color: "text-status-info" },
  lsp_notify: { label: "LSP Diagnostics", color: "text-status-warning" },
  lsp_diagnostics: { label: "LSP Diagnostics", color: "text-status-warning" },
};

export const LSP_CUSTOM_TYPES_SET = new Set(Object.keys(LSP_CUSTOM_TYPES));

export const LSP_VISIBLE_TYPES = new Set(["lsp_diagnostics"]);

export function isLspCustomType(customType: string): boolean {
  return LSP_CUSTOM_TYPES_SET.has(customType);
}

export function isLspVisibleInChat(customType: string): boolean {
  return LSP_VISIBLE_TYPES.has(customType);
}

export const LspDiagnosticsCard = memo(function LspDiagnosticsCard({ data }: { data: unknown }) {
  const { t } = useTranslation("chat");
  if (!data || typeof data !== "object") {
    return (
      <div className="my-0.5 overflow-hidden bg-status-warning/5">
        <div className="px-4 py-1 text-[11px] font-medium text-status-warning flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{t("lspDiagnostics")}</span>
        </div>
      </div>
    );
  }

  const details = data as {
    files?: Array<{
      filePath: string;
      summary: string;
      issues: Array<{
        severity?: number;
        line: number;
        message: string;
        source?: string;
        code?: string | number;
      }>;
    }>;
  };

  return (
    <div className="my-0.5 border border-status-warning/30 rounded-lg overflow-hidden bg-status-warning/50 dark:bg-status-warning/10">
      <div className="px-3 py-1.5 text-xs font-medium text-status-warning flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>{t("lspDiagnostics")}</span>
      </div>
      <div className="border-t border-status-warning/20">
        {details.files?.map((f) => (
          <div
            key={f.filePath}
            className="px-3 py-1.5 border-b last:border-b-0 border-status-warning/10"
          >
            <div className="text-[11px] text-status-warning font-medium flex items-center gap-1">
              <FileText className="w-3 h-3 shrink-0" />
              <span className="truncate" title={f.filePath}>
                {formatFilePath(f.filePath)}
              </span>
              <span className="text-status-warning ml-1">{f.summary}</span>
            </div>
            {f.issues.map((issue, i) => (
              <div key={i} className="text-[10px] text-text-tertiary pl-4 pt-0.5">
                <span
                  className={
                    issue.severity === 1
                      ? "text-status-error"
                      : issue.severity === 2
                        ? "text-status-warning"
                        : "text-text-tertiary"
                  }
                >
                  L{issue.line}
                </span>
                {issue.source && <span className="text-text-tertiary"> [{issue.source}]</span>}
                {issue.code != null && (
                  <span className="text-text-tertiary"> ({String(issue.code)})</span>
                )}
                : {issue.message}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

const CompactionSummaryCard = memo(function CompactionSummaryCard({
  summary,
  blockId,
}: {
  summary: string;
  blockId: string;
}) {
  const { t } = useTranslation("chat");
  const [isOpen, setIsOpen] = useState(false);

  const lines = summary.split("\n");
  const firstMeaningfulLine = lines.find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "";
  const preview = firstMeaningfulLine.slice(0, 120);
  const isLong = summary.length > 200 || lines.length > 6;

  return (
    <div data-block-id={blockId} className="my-0.5">
      <div className="px-3 py-1.5 text-sm text-text-secondary leading-relaxed">
        {isLong ? (
          <>
            <div className="flex items-start gap-1.5">
              <span className="text-text-tertiary flex-1">
                {preview}
                {firstMeaningfulLine.length > 120 ? "..." : ""}
              </span>
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="shrink-0 p-0.5 text-semantic-tool/60 hover:text-semantic-tool transition-colors text-[11px] underline decoration-dotted underline-offset-2"
                aria-expanded={isOpen}
                aria-label={isOpen ? t("collapseThinkingDetail") : t("expandThinkingDetail")}
              >
                {isOpen ? t("collapseDetail") : t("showDetail")}
              </button>
            </div>
            {isOpen && (
              <div className="mt-1.5 pl-0 border-l-2 border-semantic-tool/20 prose dark:prose-invert prose-sm max-w-none prose-p:my-0.5 prose-headings:my-1">
                <CachedReactMarkdown>{summary}</CachedReactMarkdown>
              </div>
            )}
          </>
        ) : (
          <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-0.5 prose-headings:my-1">
            <CachedReactMarkdown>{summary}</CachedReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
});

export const ContentBlockRenderer = memo(function ContentBlockRenderer({
  block,
  isStreaming,
  msgId,
  blockIndex,
  isEntry,
  uiBlockMap,
  mergedResultData,
}: {
  block: ContentBlock;
  isStreaming?: boolean;
  msgId: string;
  blockIndex: number;
  isEntry?: boolean;
  uiBlockMap: Map<string, UIInteractionBlock>;
  mergedResultData?: unknown;
}) {
  const blockId = `${msgId}-${blockIndex}`;
  const showToolCalls = useSettingsStore((s) => s.showToolCalls);
  const showToolResults = useSettingsStore((s) => s.showToolResults);
  const showThinking = useSettingsStore((s) => s.showThinking);
  const toolCallId =
    block.type === "toolExecution"
      ? block.toolCallId
      : block.type === "toolCall"
        ? block.id
        : block.type === "toolResult"
          ? block.toolCallId
          : undefined;
  const uiBlock = toolCallId ? uiBlockMap.get(toolCallId) : undefined;

  switch (block.type) {
    case "text":
      return <TextContentCard text={block.text} isStreaming={isStreaming} blockId={blockId} />;
    case "thinking":
      if (!showThinking) return null;
      return (
        <ThinkingCard thinking={block.thinking} isStreaming={!!isStreaming} blockId={blockId} />
      );
    case "toolCall":
      if (!showToolCalls) return null;
      {
        const execBlock: Extract<ContentBlock, { type: "toolExecution" }> = {
          type: "toolExecution",
          toolCallId: block.id,
          toolName: block.name,
          args: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
          status: "running",
        };
        const renderer = getToolRenderer(execBlock.toolName);
        if (renderer?.renderExecution) {
          const CustomCard = renderer.renderExecution;
          return <CustomCard block={execBlock} blockId={blockId} uiBlock={uiBlock} />;
        }
        return <ToolExecutionCard block={execBlock} blockId={blockId} uiBlock={uiBlock} />;
      }
    case "toolResult":
      if (!showToolResults) return null;
      {
        const execBlock: Extract<ContentBlock, { type: "toolExecution" }> = {
          type: "toolExecution",
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          args: typeof block.args === "string" ? block.args : JSON.stringify(block.args ?? ""),
          status: block.isError ? "error" : "done",
          output: block.content,
          details: block.details,
        };
        const renderer = getToolRenderer(execBlock.toolName);
        if (renderer?.renderExecution) {
          const CustomCard = renderer.renderExecution;
          return <CustomCard block={execBlock} blockId={blockId} uiBlock={uiBlock} />;
        }
        return <ToolExecutionCard block={execBlock} blockId={blockId} uiBlock={uiBlock} />;
      }
    case "toolExecution":
      if (!showToolCalls) return null;
      {
        if (block.toolName.toLowerCase() === "subagent") {
          return <SubagentExecutionCard block={block} blockId={blockId} />;
        }
        const renderer = getToolRenderer(block.toolName);
        if (renderer?.renderExecution) {
          const CustomCard = renderer.renderExecution;
          return <CustomCard block={block} blockId={blockId} uiBlock={uiBlock} />;
        }
        return <ToolExecutionCard block={block} blockId={blockId} uiBlock={uiBlock} />;
      }
    case "custom":
      if (isLspCustomType(block.customType)) {
        if (!isLspVisibleInChat(block.customType)) {
          return null;
        }
        return <LspDiagnosticsCard data={block.data} />;
      }
      if (MEMORY_HIDDEN_IN_CHAT.has(block.customType)) {
        return null;
      }
      if (block.customType === "step_snapshot") {
        return <SnapshotBadge data={block.data} blockId={blockId} />;
      }
      if (!MEMORY_CUSTOM_TYPES.has(block.customType)) {
        return null;
      }
      return (
        <MemoryCard
          customType={block.customType}
          data={block.data}
          blockId={blockId}
          isEntry={isEntry}
          mergedResultData={mergedResultData}
        />
      );
    case "compactionSummary":
      return <CompactionSummaryCard summary={block.summary} blockId={blockId} />;
    case "imageBlock":
      return (
        <div data-block-id={blockId} className="my-1 px-3">
          <img
            src={block.url}
            alt={block.alt ?? ""}
            className="max-w-full max-h-[400px] rounded-lg border border-border-secondary/50"
            loading="lazy"
          />
        </div>
      );
    case "uiInteraction":
      return <UIInteractionCard block={block} />;
  }
});

interface HookDenialDetails {
  hookDenial: {
    reason: string;
    toolName: string;
    timestamp: number;
  };
}

function isHookDenial(details: unknown): details is HookDenialDetails {
  return (
    typeof details === "object" &&
    details !== null &&
    "hookDenial" in details &&
    typeof (details as HookDenialDetails).hookDenial?.reason === "string"
  );
}

export const ToolExecutionCard = memo(function ToolExecutionCard({
  block,
  blockId,
  uiBlock,
}: {
  block: Extract<ContentBlock, { type: "toolExecution" }>;
  blockId: string;
  uiBlock?: UIInteractionBlock;
}) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";
  const isError = block.status === "error";
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  let bgOnly: string;
  if (isRunning) {
    bgOnly = "bg-status-info/[0.10]";
  } else if (isError) {
    bgOnly = "bg-status-error/[0.08]";
  } else {
    bgOnly = "bg-surface-dim/60 dark:bg-surface-dim/20";
  }

  const fullExecutionText = useMemo(() => {
    return `[${t("toolCall")}] ${block.toolName}\n${t("input")}:\n${tryFormatAsYaml(block.args ?? "")}\n${t("output")}:\n${block.output ?? ""}`;
  }, [block.toolName, block.args, block.output]);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      if (!prev && cardRef.current) {
        cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return !prev;
    });
  }, []);

  return (
    <div ref={cardRef} className={`overflow-hidden ${bgOnly}`} data-block-id={blockId}>
      <ToolCardHeader
        toolName={block.toolName}
        status={isRunning ? "running" : isError ? "error" : "done"}
        description={
          block.output && !isRunning
            ? (() => {
                const firstLine = block.output.split("\n")[0].slice(0, 100);
                const trimmed = firstLine.trim();
                // If output starts with JSON brace, skip it — use args-based description instead.
                if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                  return (
                    block.description ??
                    getToolArgsDescription(block.toolName, block.args) ??
                    block.toolName
                  );
                }
                return firstLine;
              })()
            : (block.description ??
              getToolArgsDescription(block.toolName, block.args) ??
              block.toolName)
        }
        collapsed={collapsed}
        onClick={handleToggleCollapse}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          <>
            {!isRunning && !isError && (
              <CheckCircle className="w-3.5 h-3.5 text-status-success shrink-0" />
            )}
            {isError && <XCircle className="w-3.5 h-3.5 text-status-error shrink-0" />}
            <CopyButton text={fullExecutionText} size="xs" title={t("copyAllExecution")} />
          </>
        }
      />

      {!collapsed && (
        <>
          <div
            className="px-3 py-1 text-[11px] text-text-secondary cursor-pointer hover:text-text-primary dark:hover:text-text-primary select-none flex items-center gap-1.5"
            onClick={() => setInputOpen(!inputOpen)}
          >
            <svg
              className={`w-3 h-3 transition-transform shrink-0 ${inputOpen ? "rotate-90" : ""}`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4.5 3l3 3-3 3" />
            </svg>
            <span>Input</span>
            {block.args && (
              <CopyButton
                text={typeof block.args === "string" ? block.args : JSON.stringify(block.args)}
                size="xs"
                className="ml-auto"
                title={t("copyInput")}
              />
            )}
          </div>
          {inputOpen && block.args && (
            <div className="px-3 pb-2 pt-0.5">
              <pre className="text-[11px] text-status-warning/60 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">
                {tryFormatAsYaml(block.args)}
              </pre>
            </div>
          )}

          <div
            className="px-3 py-1 text-[11px] text-text-secondary cursor-pointer hover:text-text-primary dark:hover:text-text-primary select-none flex items-center gap-1.5"
            onClick={() => setOutputOpen(!outputOpen)}
          >
            <svg
              className={`w-3 h-3 transition-transform shrink-0 ${outputOpen ? "rotate-90" : ""}`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4.5 3l3 3-3 3" />
            </svg>
            <span>Output</span>
            {isRunning && (
              <span className="ml-auto text-status-info/70 animate-pulse text-[10px]">
                streaming
              </span>
            )}
            {block.output && !isRunning && (
              <CopyButton
                text={block.output}
                size="xs"
                className="ml-auto"
                title={t("copyOutput")}
              />
            )}
          </div>
          {outputOpen && (
            <div className="px-3 pb-2 pt-0.5">
              {uiBlock && uiBlock.status === "pending" ? (
                <UIInteractionCard block={uiBlock} />
              ) : block.output ? (
                <pre className="text-[11px] text-text-secondary overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto bg-surface-code/80 dark:bg-surface-code/30 rounded px-2 py-1.5">
                  {block.output}
                </pre>
              ) : isRunning ? (
                <div className="text-[11px] text-text-tertiary italic py-1">{t("waiting")}</div>
              ) : null}
            </div>
          )}

          {isError && isHookDenial(block.details) && (
            <details className="group border-t border-status-error/20" open>
              <summary className="px-3 py-1 text-[11px] text-status-error cursor-pointer hover:text-status-error select-none flex items-center gap-1.5">
                <svg
                  className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4.5 3l3 3-3 3" />
                </svg>
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>{t("hookDenied")}</span>
              </summary>
              <div className="px-3 pb-2">
                <div className="text-[11px] text-status-error/90">
                  {(block.details as HookDenialDetails).hookDenial.reason}
                </div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
});

function Tag({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-text-tertiary/10 font-mono">
      <span className={`text-text-tertiary ${color ?? ""}`}>{label}</span>
      <span className="text-text-secondary dark:text-text-tertiary">{value}</span>
    </span>
  );
}

export const MessageMetaFooter = memo(function MessageMetaFooter({
  message,
}: {
  message: ChatMessage;
}) {
  const { t } = useTranslation("chat");
  const { tokenUsage, model, provider } = message;

  if (!tokenUsage) return null;

  const modelLabel = provider && model ? `${provider}/${model}` : (model ?? provider ?? "");

  return (
    <div className="mt-1.5 pt-1.5 pl-2 pb-0.5 border-t border-border-secondary/20">
      <div className="flex items-center gap-1 text-[10px] flex-nowrap overflow-x-auto">
        <span className="inline-flex items-center gap-1 shrink-0">
          <Tag label={t("tokenInput")} value={formatTokenCount(tokenUsage.input)} />
          <Tag label={t("tokenOutput")} value={formatTokenCount(tokenUsage.output)} />
          <Tag
            label={t("tokenReasoning")}
            value={formatTokenCount(tokenUsage.reasoning ?? 0)}
            color="text-semantic-agent"
          />
          <Tag
            label={t("tokenCacheRead")}
            value={formatTokenCount(tokenUsage.cacheRead ?? 0)}
            color="text-status-success"
          />
          <Tag
            label={t("tokenCacheWrite")}
            value={formatTokenCount(tokenUsage.cacheWrite ?? 0)}
            color="text-semantic-memory"
          />
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning font-mono">
            ${(tokenUsage.cost ?? 0).toFixed(5)}
          </span>
        </span>
        {modelLabel && <span className="text-text-tertiary shrink-0">{modelLabel}</span>}
      </div>
    </div>
  );
});

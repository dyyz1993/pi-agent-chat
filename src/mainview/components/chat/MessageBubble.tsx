import { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Highlight, themes } from "prism-react-renderer";
import { useThemeStore, isDarkGroup } from "../../stores/use-theme-store";
import {
  Brain,
  AlertTriangle,
  FileText,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Type,
  Maximize2,
  Zap,
  Target,
  Loader2,
  ThumbsDown,
} from "lucide-react";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import { CopyButton } from "./CopyButton";
import type { ChatMessage, ContentBlock, UIInteractionBlock } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { SubagentExecutionCard } from "./tool-renderers/SubagentRenderer";
import { UIInteractionCard } from "./tool-renderers/UICardRenderer";
import { getToolRenderer } from "./tool-renderers";
import { BlockErrorBoundary } from "./tool-renderers/BlockErrorBoundary";
import { getCustomTypeIcon } from "./tool-icon-map";
import { tryFormatAsYaml } from "../../../shared/lib/json-to-yaml";
import { useExpandStore } from "../../stores/use-expand-store";
import { useSettingsStore } from "../../stores/use-settings-store";
import { useUIBlockMap } from "../../stores/use-ui-dialog-store";
import { ENTRY_TYPE_KEYS, getMemoryConfig, getMemorySummary } from "./memory-config";
import { useMemoryStore } from "../../stores/use-memory-store";
import { SnapshotBadge } from "./snapshot/SnapshotBadge";
import { formatTokenCount } from "../../utils/turn-utils";

export function getBlockBorderColor(block: ContentBlock, role: "user" | "assistant"): string {
  const roleDefault = role === "user" ? "border-l-status-info/60" : "border-l-status-success/50";

  switch (block.type) {
    case "thinking":
      return "border-l-semantic-agent/50";
    case "toolCall":
      return "border-l-status-warning/40";
    case "toolResult":
      return block.isError ? "border-l-status-error/50" : "border-l-status-warning/40";
    case "toolExecution": {
      if (block.toolName.toLowerCase() === "subagent") {
        return block.status === "error" ? "border-l-status-error/50" : "border-l-semantic-agent/50";
      }
      if (block.status === "running") return "border-l-status-info/50";
      if (block.status === "error") return "border-l-status-error/50";
      return "border-l-status-warning/40";
    }
    case "custom": {
      const ct = block.customType;
      if (LSP_CUSTOM_TYPES_SET.has(ct)) return "border-l-status-warning/40";
      if (ct.startsWith("memory_prefetch")) return "border-l-status-info/40";
      if (ct.startsWith("memory_dream")) return "border-l-semantic-agent/40";
      if (ct.startsWith("memory_extract")) return "border-l-status-success/40";
      if (ct === "memory_created") return "border-l-semantic-memory/40";
      if (ct === "memory_failed") return "border-l-status-error/40";
      if (ct === "step_snapshot") return "border-l-semantic-accent/40";
      return roleDefault;
    }
    case "compactionSummary":
      return "border-l-semantic-tool/40";
    case "uiInteraction": {
      if (block.status === "pending") return "border-l-status-warning/50";
      if (block.status === "responded") return "border-l-status-success/50";
      if (block.status === "dismissed") return "border-l-text-tertiary/40";
      return "border-l-semantic-tool/40";
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
  const isUser = message.role === "user";
  const sessionId = useSessionStore((s) => s.activeSessionId);
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

  const fullTextForCopy = useMemo(() => {
    if (isUser) {
      return message.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }
    return message.content
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
  }, [message.content, isUser]);

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
          className={`relative my-0.5 mr-2 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-text-primary bg-status-info/[0.06] rounded-r-lg border-l-[3px] border-l-status-info/60 ${styleMemo.bg} min-w-0`}
        >
          <div className="absolute -top-0.5 right-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10">
            <CopyButton text={fullTextForCopy} size="xs" />
          </div>
          {message.content
            .filter((b) => b.type === "text")
            .map((b, i) => {
              const text = (b as Extract<ContentBlock, { type: "text" }>).text;
              const urlRegex = /(https?:\/\/[^\s<|」》)>]+)/g;
              const parts = text.split(urlRegex);
              if (parts.length === 1) {
                return <span key={i}>{text}</span>;
              }
              return (
                <span key={i}>
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
    </div>
  );
});

function StreamingMarkdown({ text }: { text: string }) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const prismTheme = isDarkGroup(resolvedTheme) ? themes.nightOwl : themes.nightOwlLight;

  const parts = useMemo(() => {
    const segments: Array<{
      type: "text" | "code";
      content: string;
      language?: string;
    }> = [];
    const lines = text.split("\n");
    let i = 0;
    let inCode = false;
    let codeLang = "";
    const currentCode: string[] = [];

    while (i < lines.length) {
      const line = lines[i];
      const fenceMatch = line.match(/^```(\w*)/);

      if (fenceMatch && !inCode) {
        inCode = true;
        codeLang = fenceMatch[1] || "text";
        currentCode.length = 0;
        i++;
      } else if (fenceMatch && inCode) {
        // Closing fence → complete code block
        segments.push({
          type: "code",
          content: currentCode.join("\n"),
          language: codeLang,
        });
        inCode = false;
        codeLang = "";
        currentCode.length = 0;
        i++;
      } else if (inCode) {
        currentCode.push(line);
        i++;
      } else {
        segments.push({ type: "text", content: line });
        i++;
      }
    }

    // Trailing unclosed code block → render as plain text
    if (inCode && currentCode.length > 0) {
      segments.push({ type: "text", content: currentCode.join("\n") });
    }

    return segments;
  }, [text]);

  if (parts.length === 0) return null;

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <span key={i}>
              {part.content}
              {i < parts.length - 1 ? "\n" : ""}
            </span>
          );
        }
        return (
          <Highlight
            key={i}
            theme={prismTheme}
            code={part.content.trimEnd()}
            language={part.language || "text"}
          >
            {({ tokens, getLineProps, getTokenProps }) => (
              <pre className="text-[11px] leading-relaxed font-mono p-2 my-1 overflow-x-auto bg-surface-code dark:bg-surface-code/60 rounded whitespace-pre">
                {tokens.map((line, j) => (
                  <div key={j} {...getLineProps({ line })}>
                    <span className="inline-block w-5 text-right mr-2 select-none text-text-tertiary text-[10px]">
                      {j + 1}
                    </span>
                    <span>
                      {line.map((token, k) => (
                        <span key={k} {...getTokenProps({ token })} />
                      ))}
                    </span>
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        );
      })}
    </>
  );
}

export const TextContentCard = memo(function TextContentCard({
  text,
  isStreaming,
  blockId,
}: {
  text: string;
  isStreaming?: boolean;
  blockId: string;
}) {
  const { t } = useTranslation("chat");
  const [isOpen, setIsOpen] = useState(true);
  const firstLine = text.split("\n")[0] || "";
  const hasMore = text.includes("\n") || text.length > 120;

  return (
    <div className="my-0.5 overflow-hidden" data-block-id={blockId}>
      <div
        className={`flex items-center gap-2 px-3 py-1 text-[11px] ${!isStreaming ? "cursor-pointer hover:bg-surface-hover/30 dark:hover:bg-surface-dim/30" : ""}`}
        onClick={() => !isStreaming && setIsOpen(!isOpen)}
      >
        <Type className="w-3 h-3 text-text-tertiary shrink-0" />
        {!isStreaming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className="p-0.5 text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors ml-auto"
            title={isOpen ? t("collapse") : t("expand")}
            aria-expanded={isOpen}
            aria-label={isOpen ? t("collapseText") : t("expandText")}
          >
            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
        <CopyButton text={text} size="xs" title={t("copyTextContent")} />
      </div>

      {isOpen ? (
        <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:bg-transparent">
          {isStreaming ? (
            <StreamingMarkdown text={text} />
          ) : (
            <CachedReactMarkdown>{text}</CachedReactMarkdown>
          )}
        </div>
      ) : hasMore ? (
        <div className="py-1 px-3 text-[11px] text-text-tertiary truncate">
          {firstLine.length > 120 ? firstLine.slice(0, 120) + "..." : firstLine}
        </div>
      ) : null}
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

  const firstLine = thinking.split("\n")[0] || t("thinkingPlaceholder");
  const hasMore = thinking.includes("\n") || thinking.length > 80;
  const collapsedText = firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine;

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
        ) : hasMore ? (
          <span className="text-text-tertiary truncate flex-1 min-w-0">{collapsedText}</span>
        ) : (
          <span className="text-semantic-agent/70 font-medium">{t("thinkingLabel")}</span>
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
        <div className="px-3 pb-2 text-[11px] text-text-tertiary whitespace-pre-wrap leading-relaxed">
          {thinking || (
            <span className="text-text-tertiary italic">{t("thinkingPlaceholder")}</span>
          )}
        </div>
      )}
    </div>
  );
});

export const MEMORY_CUSTOM_TYPES = ENTRY_TYPE_KEYS;

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
              <span>{f.filePath}</span>
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

function getSearchingSummary(data: unknown): string | null {
  const d = data as Record<string, unknown> | undefined;
  if (!d) return "搜索中…";
  const q = typeof d.query === "string" ? d.query : "";
  if (!q) return "搜索中…";
  return `「${q.length > 40 ? q.slice(0, 40) + "…" : q}」搜索中…`;
}

function extractTierInfo(data: unknown): { tier: string; model?: string } | null {
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;
  const tier = typeof d.tier === "string" ? d.tier : undefined;
  const model = typeof d.model === "string" ? d.model : undefined;
  if (!tier && !model) return null;
  return { tier: tier ?? "", model };
}

function TierBadge({ tier }: { tier: string }) {
  if (!tier) return null;
  const config: Record<
    string,
    { style: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    fast: {
      style: "bg-status-warning/[0.12] text-status-warning border-status-warning/25",
      Icon: Zap,
    },
    pro: {
      style: "bg-semantic-accent/[0.12] text-semantic-accent border-semantic-accent/25",
      Icon: Target,
    },
    max: {
      style: "bg-semantic-agent/[0.12] text-semantic-agent border-semantic-agent/25",
      Icon: Brain,
    },
  };
  const cfg = config[tier];
  if (!cfg) return null;
  const { Icon } = cfg;

  return (
    <span
      className={`ml-1 flex items-center gap-0.5 text-[10px] px-1.5 py-px rounded font-medium shrink-0 border ${cfg.style}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {tier}
    </span>
  );
}

function PrefetchSearchingDetail({ data }: { data: unknown }) {
  const { t } = useTranslation("chat");
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;
  const query = typeof d.query === "string" ? d.query : "";
  const availableFiles = typeof d.availableFiles === "number" ? d.availableFiles : 0;

  return (
    <div className="px-3 pb-2 text-[11px] space-y-2">
      <div className="flex items-center gap-1.5 text-status-info">
        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        <span>{t("searchingMemory")}</span>
      </div>
      {query && (
        <div className="flex gap-1.5">
          <span className="text-text-tertiary shrink-0">{t("searchQuery")}</span>
          <span className="text-text-secondary">「{query}」</span>
        </div>
      )}
      {availableFiles > 0 && (
        <div className="flex gap-1.5">
          <span className="text-text-tertiary shrink-0">{t("availableFilesLabel")}</span>
          <span className="text-text-secondary">{t("filesCount", { count: availableFiles })}</span>
        </div>
      )}
    </div>
  );
}

export const MemoryCard = memo(function MemoryCard({
  customType,
  data,
  blockId,
  isEntry: _isEntry,
  mergedResultData,
}: {
  customType: string;
  data: unknown;
  blockId: string;
  isEntry?: boolean;
  mergedResultData?: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation("chat");

  const isMerged = customType === "memory_prefetch" && mergedResultData !== undefined;
  const isSearching = customType === "memory_prefetch" && mergedResultData === undefined;

  const displayType = isMerged ? "memory_prefetch_result" : customType;
  const displayData = isMerged ? mergedResultData : data;

  const config = getMemoryConfig(displayType) ?? {
    label: displayType,
    color: "text-text-tertiary",
  };
  const Icon = getCustomTypeIcon(displayType).icon;

  const summary = isSearching
    ? getSearchingSummary(data)
    : getMemorySummary(displayType, displayData);

  const tierInfo = extractTierInfo(displayData);

  const sessionId = useSessionStore.getState().activeSessionId;
  const prefetchSelectedFiles = Array.isArray(
    (displayData as Record<string, unknown>)?.selectedFiles,
  )
    ? ((displayData as Record<string, unknown>).selectedFiles as string[])
    : [];
  const isMarked = sessionId
    ? useMemoryStore.getState().isIrrelevantMarked(sessionId, blockId)
    : false;
  const canMarkIrrelevant =
    displayType === "memory_prefetch_result" && prefetchSelectedFiles.length > 0;

  const handleMarkIrrelevant = useCallback(() => {
    if (!sessionId || isMarked) return;
    const d = displayData as Record<string, unknown> | undefined;
    const query =
      typeof d?._prefetchQuery === "string"
        ? d._prefetchQuery
        : typeof d?.query === "string"
          ? d.query
          : "";
    const selectedFiles = Array.isArray(d?.selectedFiles) ? (d.selectedFiles as string[]) : [];
    if (!query || selectedFiles.length === 0) return;
    useMemoryStore.getState().markIrrelevant(sessionId, blockId, query, selectedFiles);
  }, [sessionId, blockId, displayData, isMarked]);

  return (
    <div className="my-0.5" data-block-id={blockId}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-3 py-1 flex items-center gap-1.5 text-[11px] ${config.color} hover:bg-surface-hover/15 dark:hover:bg-surface-dim/15 rounded cursor-pointer select-none`}
        aria-expanded={expanded}
        aria-label={`${config.label}${summary ? `: ${summary}` : ""}`}
      >
        <Icon className="w-3 h-3 shrink-0" />
        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="font-medium whitespace-nowrap">{config.label}</span>
          {summary && <span className="text-text-tertiary truncate">{summary}</span>}
        </span>
        {tierInfo && <TierBadge tier={tierInfo.tier} />}
        {canMarkIrrelevant && !isMarked && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              handleMarkIrrelevant();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                handleMarkIrrelevant();
              }
            }}
            className="shrink-0 flex items-center rounded hover:bg-semantic-notify/20 text-text-tertiary hover:text-semantic-notify transition-colors cursor-pointer"
            title={t("markIrrelevant")}
          >
            <ThumbsDown className="w-3 h-3" />
          </span>
        )}
        {isMarked && (
          <span
            className="shrink-0 flex items-center text-semantic-notify/70"
            title={t("alreadyMarkedIrrelevant")}
          >
            <ThumbsDown className="w-3 h-3" />
          </span>
        )}
        <span className="text-text-tertiary shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded &&
        (isSearching ? (
          <PrefetchSearchingDetail data={data} />
        ) : (
          <MemoryExpandedContent
            customType={displayType}
            data={displayData}
            isMarkedIrrelevant={isMarked}
          />
        ))}
    </div>
  );
});

function MemoryExpandedContent({
  customType,
  data,
  isMarkedIrrelevant,
}: {
  customType: string;
  data: unknown;
  isMarkedIrrelevant?: boolean;
}) {
  if (customType === "memory_prefetch_result") {
    return <PrefetchResultDetail data={data} isMarkedIrrelevant={isMarkedIrrelevant} />;
  }
  if (customType === "memory_prefetch") {
    return <PrefetchStartDetail data={data} />;
  }
  if (customType === "memory_extract") {
    return <ExtractDetail data={data} />;
  }
  const dataStr = typeof data === "string" ? data : data ? JSON.stringify(data, null, 2) : "";
  if (!dataStr) return null;
  return (
    <pre className="px-3 pb-1 text-[11px] text-text-tertiary overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
      {dataStr.length > 500 ? dataStr.slice(0, 500) + "…" : dataStr}
    </pre>
  );
}

function ExtractDetail({ data }: { data: unknown }) {
  type FileEntry = { filename: string; name: string; description: string };
  const d = data as { created?: unknown[]; updated?: unknown[]; status?: string } | undefined;
  const created = (d?.created ?? []) as unknown[];
  const updated = (d?.updated ?? []) as unknown[];
  const isEnriched = (arr: unknown[]): arr is FileEntry[] =>
    arr.length > 0 &&
    typeof (arr[0] as Record<string, unknown>)?.filename === "string" &&
    typeof (arr[0] as Record<string, unknown>)?.name === "string";

  if (!isEnriched(created) && !isEnriched(updated)) {
    const dataStr = data ? JSON.stringify(data, null, 2) : "";
    if (!dataStr) return null;
    return (
      <pre className="px-3 pb-1 text-[11px] text-text-tertiary overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
        {dataStr.length > 500 ? dataStr.slice(0, 500) + "…" : dataStr}
      </pre>
    );
  }

  return (
    <div className="px-3 pb-1.5 flex flex-col gap-1">
      {(created as FileEntry[]).length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-status-success/80 mb-0.5">新建</div>
          {(created as FileEntry[]).map((f, i) => (
            <div key={i} className="text-[11px] text-text-tertiary flex gap-1 items-start">
              <FileText className="w-3 h-3 mt-0.5 shrink-0 text-status-success/60" />
              <span className="min-w-0">
                <span className="font-medium text-text-secondary">{f.name}</span>
                {f.description && <span className="text-text-tertiary"> — {f.description}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {(updated as FileEntry[]).length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-status-warning/80 mb-0.5">更新</div>
          {(updated as FileEntry[]).map((f, i) => (
            <div key={i} className="text-[11px] text-text-tertiary flex gap-1 items-start">
              <FileText className="w-3 h-3 mt-0.5 shrink-0 text-status-warning/60" />
              <span className="min-w-0">
                <span className="font-medium text-text-secondary">{f.name}</span>
                {f.description && <span className="text-text-tertiary"> — {f.description}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PrefetchResultDetail({
  data,
  isMarkedIrrelevant,
}: {
  data: unknown;
  isMarkedIrrelevant?: boolean;
}) {
  const { t } = useTranslation("chat");
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;

  const snippet = typeof d.snippet === "string" ? d.snippet : "";
  const selectedFiles = Array.isArray(d.selectedFiles) ? (d.selectedFiles as string[]) : [];
  const injectedBytes = typeof d.injectedBytes === "number" ? d.injectedBytes : 0;
  const durationMs = typeof d.durationMs === "number" ? d.durationMs : 0;
  const layer = typeof d.layer === "string" ? d.layer : "unknown";
  const rawSkipHits = d.skipHits;
  const rawGuardHits = d.guardHits;
  const rawTriggerHits = d.triggerHits;
  const isForce = d.isForce === true;
  const availableFiles = typeof d.availableFiles === "number" ? d.availableFiles : 0;
  const query = typeof d.query === "string" ? d.query : "";
  const tier = typeof d.tier === "string" ? d.tier : "";
  const modelLabel = typeof d.model === "string" ? d.model : "";

  const skipHits = Array.isArray(rawSkipHits)
    ? (rawSkipHits as Array<Record<string, string>>).map((h) =>
        typeof h === "string"
          ? { pattern: h, mode: "" }
          : { pattern: h.pattern ?? "", mode: h.mode ?? "" },
      )
    : [];
  const guardHits = Array.isArray(rawGuardHits)
    ? (rawGuardHits as Array<Record<string, string>>).map((h) =>
        typeof h === "string"
          ? { pattern: h, mode: "" }
          : { pattern: h.pattern ?? "", mode: h.mode ?? "" },
      )
    : [];
  const triggerHits = Array.isArray(rawTriggerHits)
    ? (rawTriggerHits as Array<Record<string, string>>).map((h) =>
        typeof h === "string"
          ? { pattern: h, mode: "" }
          : { pattern: h.pattern ?? "", mode: h.mode ?? "" },
      )
    : [];

  const hasMemory = snippet || selectedFiles.length > 0;

  const memoryCount = snippet ? (snippet.match(/^###/gm)?.length ?? 1) : selectedFiles.length;
  const tokenCount = injectedBytes > 0 ? Math.round(injectedBytes / 4) : 0;

  const modeLabel = (mode: string) => {
    switch (mode) {
      case "exact":
        return t("exactMatch");
      case "prefix":
        return t("prefixMatch");
      case "contains":
        return t("containsMatch");
      case "regex":
        return t("regexMatch");
      default:
        return "";
    }
  };

  return (
    <div className="px-3 pb-2 text-[11px] space-y-1.5">
      {!hasMemory && <div className="text-text-tertiary italic py-1">{t("noRelevantMemory")}</div>}

      {snippet && (
        <div className="space-y-0.5">
          <div className="text-text-tertiary flex items-center gap-1 font-medium">
            <Brain className="w-3 h-3 text-status-info/60 shrink-0" />
            <span>{t("relatedMemory")}</span>
            <span className="text-text-tertiary ml-auto">
              {memoryCount}{" "}
              {t("memoryCountTokens", {
                count: memoryCount,
                tokens: tokenCount,
                size: Math.round(injectedBytes / 1024),
              })}
            </span>
          </div>
          <pre className="p-2 bg-surface-code/80 dark:bg-surface-dim/40 rounded text-[11px] text-text-secondary overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-border-secondary/50 dark:border-border-secondary/30">
            {snippet}
          </pre>
        </div>
      )}

      {!snippet && selectedFiles.length > 0 && (
        <div className="text-text-tertiary italic py-0.5">
          {t("retrievedMemoryFiles", { count: selectedFiles.length })}
          {injectedBytes > 0 && (
            <span className="text-text-tertiary ml-auto">
              ~{Math.round(injectedBytes / 4)} tokens
            </span>
          )}
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer text-text-tertiary hover:text-text-secondary dark:hover:text-text-tertiary flex items-center gap-1 py-0.5 text-[10px]">
          <ChevronRight className="w-2.5 h-2.5 group-open:rotate-90 transition-transform" />
          {t("searchDetail")}
        </summary>
        <div className="mt-1 space-y-1.5 pl-1 text-[10px] text-text-tertiary">
          {query && (
            <div className="text-text-tertiary">
              {t("searchQuery")} <span className="text-text-secondary">「{query}」</span>
            </div>
          )}

          <div className="space-y-0.5">
            {layer === "not_triggered" && (
              <div className="text-text-tertiary">{t("notTriggered")}</div>
            )}
            {layer === "skip" && <div className="text-status-warning/80">{t("skipLayer")}</div>}
            {layer === "llm" && isForce && (
              <div className="text-status-error/80">{t("forceTrigger")}</div>
            )}
            {layer === "llm" && !isForce && (
              <div className="text-status-info/80">{t("keywordTrigger")}</div>
            )}
            {layer === "none" && <div className="text-text-tertiary">{t("noMemoryFiles")}</div>}
            {layer === "error" && <div className="text-status-error/80">{t("searchError")}</div>}
            {layer !== "skip" &&
              layer !== "llm" &&
              layer !== "not_triggered" &&
              layer !== "none" && (
                <div className="text-text-tertiary">{t("matchMethod", { method: layer })}</div>
              )}
          </div>

          {skipHits.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-status-warning/80">{t("skipRuleHit")}</div>
              {skipHits.map((h, i) => (
                <div key={i} className="pl-2 flex items-center gap-1.5">
                  <span className="text-status-warning/60">•</span>
                  <span className="text-text-secondary font-mono">「{h.pattern}」</span>
                  {h.mode && <span className="text-text-tertiary">({modeLabel(h.mode)})</span>}
                </div>
              ))}
            </div>
          )}

          {guardHits.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-status-success/80">{t("guardRuleHit")}</div>
              {guardHits.map((h, i) => (
                <div key={i} className="pl-2 flex items-center gap-1.5">
                  <span className="text-status-success/60">•</span>
                  <span className="text-text-secondary font-mono">「{h.pattern}」</span>
                  {h.mode && <span className="text-text-tertiary">({modeLabel(h.mode)})</span>}
                </div>
              ))}
            </div>
          )}

          {triggerHits.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-semantic-tool/80">{t("triggerKeywords")}</div>
              {triggerHits.map((h, i) => (
                <div key={i} className="pl-2 flex items-center gap-1.5">
                  <span className="text-semantic-tool/60">•</span>
                  <span className="text-text-secondary font-mono">「{h.pattern}」</span>
                  {h.mode && <span className="text-text-tertiary">({modeLabel(h.mode)})</span>}
                </div>
              ))}
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-text-tertiary flex items-center gap-1">
                {t("sourceFiles", { count: selectedFiles.length })}
              </div>
              {selectedFiles.map((f) => {
                const fileName = f.split("/").pop() ?? f;
                return (
                  <div
                    key={f}
                    className="flex items-center gap-1.5 pl-2 py-0.5 text-text-tertiary truncate"
                  >
                    <FileText className="w-2.5 h-2.5 text-status-info/50 shrink-0" />
                    <span className="truncate" title={f}>
                      {fileName}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-0.5">
            {availableFiles > 0 && (
              <div className="text-text-tertiary">
                {t("availableFiles", { count: availableFiles })}
              </div>
            )}
            {durationMs > 0 && (
              <div className="text-text-tertiary">
                {t("searchDuration", { duration: durationMs })}
              </div>
            )}
            {tier && (
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 shrink-0 text-status-warning/70" />
                <span className="text-text-tertiary">{t("usedModel")}</span>
                <span className="text-text-secondary">{modelLabel || tier}</span>
                {tier && modelLabel && <span className="text-text-secondary">({tier})</span>}
              </div>
            )}
          </div>
        </div>
      </details>

      {isMarkedIrrelevant && (
        <div className="flex items-center gap-1.5 text-[10px] text-semantic-notify/80 py-1 px-1">
          <ThumbsDown className="w-3 h-3 shrink-0" />
          <span>{t("markedIrrelevantHint")}</span>
        </div>
      )}
    </div>
  );
}

function PrefetchStartDetail({ data }: { data: unknown }) {
  const { t } = useTranslation("chat");
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;
  const query = typeof d.query === "string" ? d.query : "";
  const availableFiles = typeof d.availableFiles === "number" ? d.availableFiles : 0;

  return (
    <div className="px-3 pb-2 text-[11px] space-y-1">
      {query && (
        <div className="flex gap-1.5">
          <span className="text-text-tertiary shrink-0">{t("queryLabel")}</span>
          <span className="text-text-secondary truncate">{query}</span>
        </div>
      )}
      <div className="flex gap-1.5">
        <span className="text-text-tertiary shrink-0">{t("availableFilesLabel")}</span>
        <span className="text-text-secondary">{t("filesCount", { count: availableFiles })}</span>
      </div>
    </div>
  );
}

function isLongContent(text: string): boolean {
  const lineCount = text.split("\n").length;
  return lineCount > 20;
}

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
  const { t } = useTranslation("chat");
  const openExpand = useExpandStore((s) => s.openExpand);
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
    case "text": {
      const shouldShowExpand = !isStreaming && isLongContent(block.text);

      if (isStreaming) {
        return (
          <div
            data-block-id={blockId}
            className="my-0.5 group relative px-3 pr-10 text-sm text-text-primary whitespace-pre-wrap break-words"
          >
            <div className="absolute top-2 right-2 z-10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <CopyButton text={block.text} size="xs" />
            </div>
            {block.text}
          </div>
        );
      }

      return (
        <div
          data-block-id={blockId}
          className="my-0.5 group relative px-3 pr-10 prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:bg-transparent"
        >
          <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            {shouldShowExpand && (
              <button
                onClick={() =>
                  openExpand(
                    block.text,
                    t("messageContentLineCount", { count: block.text.split("\n").length }),
                  )
                }
                className="p-1 rounded text-text-tertiary hover:text-semantic-accent hover:bg-surface-hover/60 dark:hover:bg-surface-dim/60 transition-colors"
                title={t("expandFullText")}
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}
            <CopyButton text={block.text} size="xs" />
          </div>
          <CachedReactMarkdown>{block.text}</CachedReactMarkdown>
        </div>
      );
    }
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
          return <CustomCard block={execBlock} blockId={blockId} />;
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
          return <CustomCard block={execBlock} blockId={blockId} />;
        }
        return <ToolExecutionCard block={execBlock} blockId={blockId} />;
      }
    case "toolExecution":
      if (!showToolCalls) return null;
      {
        if (uiBlock) {
          return <UIInteractionCard block={uiBlock} />;
        }
        if (block.toolName.toLowerCase() === "subagent") {
          return <SubagentExecutionCard block={block} blockId={blockId} />;
        }
        const renderer = getToolRenderer(block.toolName);
        if (renderer?.renderExecution) {
          const CustomCard = renderer.renderExecution;
          return <CustomCard block={block} blockId={blockId} />;
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
    case "uiInteraction":
      return <UIInteractionCard block={block} />;
  }
});

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
    bgOnly = "bg-status-info/15";
  } else if (isError) {
    bgOnly = "bg-status-error/10";
  } else {
    bgOnly = "bg-status-warning/[0.06] dark:bg-surface-dim/20";
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
      <div
        className="px-3 py-1 flex items-center gap-2 text-xs cursor-pointer hover:brightness-110 transition-all"
        onClick={handleToggleCollapse}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("expandToolCard") : t("collapseToolCard")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggleCollapse();
          }
        }}
      >
        <span
          className={`font-medium ${isRunning ? "text-status-info" : isError ? "text-status-error" : "text-status-warning/80"}`}
        >
          {block.toolName}
        </span>
        {collapsed && isRunning && (
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-status-info animate-pulse" />
        )}
        {isRunning && <span className="text-status-info animate-pulse text-[10px]">running</span>}
        {!isRunning && !isError && (
          <CheckCircle className="w-3.5 h-3.5 text-status-success shrink-0 ml-auto" />
        )}
        {isError && <XCircle className="w-3.5 h-3.5 text-status-error shrink-0 ml-auto" />}
        <CopyButton text={fullExecutionText} size="xs" title={t("copyAllExecution")} />
      </div>

      {collapsed ? (
        <div className="px-3 pb-2 text-[11px] text-text-tertiary truncate">
          {block.output ? block.output.split("\n")[0].slice(0, 100) : t("waitingOutput")}
        </div>
      ) : (
        <>
          <div
            className="px-3 py-1 text-[11px] text-text-tertiary cursor-pointer hover:text-text-secondary dark:hover:text-text-tertiary select-none flex items-center gap-1.5"
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
            className="px-3 py-1 text-[11px] text-text-tertiary cursor-pointer hover:text-text-secondary dark:hover:text-text-tertiary select-none flex items-center gap-1.5"
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
                <pre className="text-[11px] text-text-secondary overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto bg-surface-dim dark:bg-surface-code/30 rounded px-2 py-1.5">
                  {block.output}
                </pre>
              ) : isRunning ? (
                <div className="text-[11px] text-text-tertiary italic py-1">{t("waiting")}</div>
              ) : null}
            </div>
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

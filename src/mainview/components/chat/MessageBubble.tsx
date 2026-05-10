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
  Type,
  Maximize2,
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
import { useLayoutStore } from "../../layouts/use-layout-store";
import { ENTRY_TYPE_KEYS, getMemoryConfig, getMemorySummary } from "./memory-config";
import { formatTokenCount } from "../../utils/turn-utils";

export function getBlockBorderColor(block: ContentBlock, role: "user" | "assistant"): string {
  const roleDefault = role === "user" ? "border-l-blue-500/60" : "border-l-emerald-500/50";

  switch (block.type) {
    case "thinking":
      return "border-l-purple-400/50";
    case "toolCall":
      return "border-l-amber-500/40";
    case "toolResult":
      return block.isError ? "border-l-red-400/50" : "border-l-amber-500/40";
    case "toolExecution": {
      if (block.toolName.toLowerCase() === "subagent") {
        return block.status === "error" ? "border-l-red-400/50" : "border-l-purple-400/50";
      }
      if (block.status === "running") return "border-l-blue-400/50";
      if (block.status === "error") return "border-l-red-400/50";
      return "border-l-amber-500/40";
    }
    case "custom": {
      const ct = block.customType;
      if (LSP_CUSTOM_TYPES_SET.has(ct)) return "border-l-yellow-400/40";
      if (ct.startsWith("memory_prefetch")) return "border-l-blue-400/40";
      if (ct.startsWith("memory_dream")) return "border-l-purple-400/40";
      if (ct.startsWith("memory_extract")) return "border-l-green-400/40";
      if (ct === "memory_created") return "border-l-teal-400/40";
      if (ct === "memory_failed") return "border-l-red-400/40";
      return roleDefault;
    }
    case "compactionSummary":
      return "border-l-cyan-500/40";
    case "uiInteraction": {
      if (block.status === "pending") return "border-l-amber-400/50";
      if (block.status === "responded") return "border-l-emerald-400/50";
      if (block.status === "dismissed") return "border-l-gray-500/40";
      return "border-l-cyan-400/40";
    }
    default:
      return roleDefault;
  }
}

function getDefaultBorderColor(role: "user" | "assistant"): string {
  return role === "user" ? "border-l-blue-500/60" : "border-l-emerald-500/50";
}

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
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
      bg = "bg-indigo-500/[0.06]";
    } else if (isActive) {
      bg = "bg-blue-500/[0.04]";
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
      style={{ maxWidth: 900 }}
    >
      {isSelected && (
        <div className="absolute inset-0 rounded-lg bg-indigo-500/[0.06] pointer-events-none" />
      )}
      {isUser ? (
        <div
          className={`relative my-0.5 mr-2 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100 bg-blue-500/[0.06] rounded-r-lg border-l-[3px] border-l-blue-500/60 ${styleMemo.bg} min-w-0`}
        >
          <div className="absolute -top-0.5 right-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10">
            <CopyButton text={fullTextForCopy} size="xs" />
          </div>
          {message.content
            .filter((b) => b.type === "text")
            .map((b, i) => (
              <span key={i}>{(b as Extract<ContentBlock, { type: "text" }>).text}</span>
            ))}
        </div>
      ) : (
        <div
          className={`w-full text-gray-800 dark:text-gray-200 transition-colors ${styleMemo.bg} min-w-0`}
        >
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
                  />
                </BlockErrorBoundary>
              </div>
            );
          })}
          {message.isStreaming && (
            <div
              className={`border-l-[3px] ${getDefaultBorderColor(message.role as "user" | "assistant")}`}
            >
              <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-3 align-text-bottom" />
            </div>
          )}
          {(message.tokenUsage ?? message.model) && (
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
        className={`flex items-center gap-2 px-3 py-1 text-[11px] ${!isStreaming ? "cursor-pointer hover:bg-gray-200/30 dark:hover:bg-gray-800/30" : ""}`}
        onClick={() => !isStreaming && setIsOpen(!isOpen)}
      >
        <Type className="w-3 h-3 text-gray-500 shrink-0" />
        {!isStreaming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className="p-0.5 text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors ml-auto"
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
          {isStreaming ? <span>{text}</span> : <CachedReactMarkdown>{text}</CachedReactMarkdown>}
        </div>
      ) : hasMore ? (
        <div className="py-1 px-3 text-[11px] text-gray-400 dark:text-gray-500 truncate">
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

  return (
    <div className="my-0.5 overflow-hidden" data-block-id={blockId}>
      <div
        className={`px-3 py-1 text-[11px] flex items-center gap-2 ${!isStreaming ? "cursor-pointer hover:bg-gray-200/30 dark:hover:bg-gray-800/30" : ""}`}
        onClick={() => !isStreaming && setIsOpen(!isOpen)}
      >
        <Brain className="w-3 h-3 text-purple-400/60 shrink-0" />
        <span className="text-purple-300/70 font-medium">{t("thinkingLabel")}</span>
        {isStreaming && <span className="text-purple-400/50 animate-pulse text-[10px]">...</span>}
        {!isStreaming && (
          <div className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setIsOpen(!isOpen)}
              title={isOpen ? t("collapse") : t("expand")}
              className="p-0.5 text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <CopyButton text={thinking} size="xs" title={t("copyThinkingContent")} />
          </div>
        )}
      </div>

      {isOpen ? (
        <div className="px-3 pb-2 text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">
          {thinking || (
            <span className="text-gray-400 dark:text-gray-600 italic">
              {t("thinkingPlaceholder")}
            </span>
          )}
        </div>
      ) : hasMore ? (
        <div className="py-1 px-3 text-[11px] text-gray-400 dark:text-gray-500 truncate">
          {firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine}
        </div>
      ) : null}
    </div>
  );
});

export const MEMORY_CUSTOM_TYPES = ENTRY_TYPE_KEYS;

export const MEMORY_HIDDEN_IN_CHAT = new Set<string>([]);

const LSP_CUSTOM_TYPES: Record<string, { label: string; color: string }> = {
  lsp: { label: "LSP", color: "text-blue-400" },
  lsp_notify: { label: "LSP Diagnostics", color: "text-yellow-400" },
  lsp_diagnostics: { label: "LSP Diagnostics", color: "text-yellow-400" },
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
      <div className="my-0.5 overflow-hidden bg-yellow-950/5">
        <div className="px-4 py-1 text-[11px] font-medium text-yellow-400 flex items-center gap-1.5">
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
    <div className="my-0.5 border border-yellow-700/30 rounded-lg overflow-hidden bg-yellow-50/50 dark:bg-yellow-900/10">
      <div className="px-3 py-1.5 text-xs font-medium text-yellow-400 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>{t("lspDiagnostics")}</span>
      </div>
      <div className="border-t border-yellow-700/20">
        {details.files?.map((f) => (
          <div
            key={f.filePath}
            className="px-3 py-1.5 border-b last:border-b-0 border-yellow-700/10"
          >
            <div className="text-[11px] text-yellow-300 font-medium flex items-center gap-1">
              <FileText className="w-3 h-3 shrink-0" />
              <span>{f.filePath}</span>
              <span className="text-yellow-500 ml-1">{f.summary}</span>
            </div>
            {f.issues.map((issue, i) => (
              <div key={i} className="text-[10px] text-gray-500 dark:text-gray-400 pl-4 pt-0.5">
                <span
                  className={
                    issue.severity === 1
                      ? "text-red-400"
                      : issue.severity === 2
                        ? "text-yellow-400"
                        : "text-gray-500"
                  }
                >
                  L{issue.line}
                </span>
                {issue.source && (
                  <span className="text-gray-400 dark:text-gray-600"> [{issue.source}]</span>
                )}
                {issue.code != null && (
                  <span className="text-gray-400 dark:text-gray-600"> ({String(issue.code)})</span>
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

export const MemoryCard = memo(function MemoryCard({
  customType,
  data,
  blockId,
  isEntry: _isEntry,
}: {
  customType: string;
  data: unknown;
  blockId: string;
  isEntry?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = getMemoryConfig(customType) ?? { label: customType, color: "text-gray-400" };
  const Icon = getCustomTypeIcon(customType).icon;
  const summary = getMemorySummary(customType, data);

  return (
    <div className="my-0.5" data-block-id={blockId}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-3 py-1 flex items-center gap-1.5 text-[11px] ${config.color} hover:bg-gray-200/15 dark:hover:bg-gray-800/15 rounded cursor-pointer select-none`}
        aria-expanded={expanded}
        aria-label={`${config.label}${summary ? `: ${summary}` : ""}`}
      >
        <Icon className="w-3 h-3 shrink-0" />
        <span className="font-medium">{config.label}</span>
        {summary && <span className="text-gray-400 dark:text-gray-500 truncate">{summary}</span>}
        <span className="ml-auto text-gray-400 dark:text-gray-600">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded && <MemoryExpandedContent customType={customType} data={data} />}
    </div>
  );
});

function MemoryExpandedContent({ customType, data }: { customType: string; data: unknown }) {
  if (customType === "memory_prefetch_result") {
    return <PrefetchResultDetail data={data} />;
  }
  if (customType === "memory_prefetch") {
    return <PrefetchStartDetail data={data} />;
  }
  const dataStr = typeof data === "string" ? data : data ? JSON.stringify(data, null, 2) : "";
  if (!dataStr) return null;
  return (
    <pre className="px-3 pb-1 text-[11px] text-gray-400 dark:text-gray-500 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
      {dataStr.length > 500 ? dataStr.slice(0, 500) + "…" : dataStr}
    </pre>
  );
}

function PrefetchResultDetail({ data }: { data: unknown }) {
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
      {!hasMemory && (
        <div className="text-gray-400 dark:text-gray-500 italic py-1">{t("noRelevantMemory")}</div>
      )}

      {snippet && (
        <div className="space-y-0.5">
          <div className="text-gray-500 dark:text-gray-400 flex items-center gap-1 font-medium">
            <Brain className="w-3 h-3 text-blue-400/60 shrink-0" />
            <span>{t("relatedMemory")}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-auto">
              {memoryCount}{" "}
              {t("memoryCountTokens", {
                count: memoryCount,
                tokens: tokenCount,
                size: Math.round(injectedBytes / 1024),
              })}
            </span>
          </div>
          <pre className="p-2 bg-gray-100/80 dark:bg-gray-800/40 rounded text-[11px] text-gray-700 dark:text-gray-300 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-gray-200/50 dark:border-gray-700/30">
            {snippet}
          </pre>
        </div>
      )}

      {!snippet && selectedFiles.length > 0 && (
        <div className="text-gray-400 dark:text-gray-500 italic py-0.5">
          {t("retrievedMemoryFiles", { count: selectedFiles.length })}
          {injectedBytes > 0 && (
            <span className="text-gray-400 dark:text-gray-600 ml-auto">
              ~{Math.round(injectedBytes / 4)} tokens
            </span>
          )}
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 flex items-center gap-1 py-0.5 text-[10px]">
          <ChevronRight className="w-2.5 h-2.5 group-open:rotate-90 transition-transform" />
          {t("searchDetail")}
        </summary>
        <div className="mt-1 space-y-1.5 pl-1 text-[10px] text-gray-400 dark:text-gray-500">
          {query && (
            <div className="text-gray-500 dark:text-gray-400">
              {t("searchQuery")}{" "}
              <span className="text-gray-700 dark:text-gray-300">「{query}」</span>
            </div>
          )}

          <div className="space-y-0.5">
            {layer === "not_triggered" && (
              <div className="text-gray-400 dark:text-gray-500">{t("notTriggered")}</div>
            )}
            {layer === "skip" && <div className="text-yellow-500/80">{t("skipLayer")}</div>}
            {layer === "llm" && isForce && (
              <div className="text-red-400/80">{t("forceTrigger")}</div>
            )}
            {layer === "llm" && !isForce && (
              <div className="text-blue-400/80">{t("keywordTrigger")}</div>
            )}
            {layer === "none" && (
              <div className="text-gray-400 dark:text-gray-500">{t("noMemoryFiles")}</div>
            )}
            {layer === "error" && <div className="text-red-400/80">{t("searchError")}</div>}
            {layer !== "skip" &&
              layer !== "llm" &&
              layer !== "not_triggered" &&
              layer !== "none" && (
                <div className="text-gray-500 dark:text-gray-400">
                  {t("matchMethod", { method: layer })}
                </div>
              )}
          </div>

          {skipHits.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-yellow-600/80">{t("skipRuleHit")}</div>
              {skipHits.map((h, i) => (
                <div key={i} className="pl-2 flex items-center gap-1.5">
                  <span className="text-yellow-500/60">•</span>
                  <span className="text-gray-700 dark:text-gray-300 font-mono">
                    「{h.pattern}」
                  </span>
                  {h.mode && (
                    <span className="text-gray-400 dark:text-gray-600">({modeLabel(h.mode)})</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {guardHits.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-green-600/80">{t("guardRuleHit")}</div>
              {guardHits.map((h, i) => (
                <div key={i} className="pl-2 flex items-center gap-1.5">
                  <span className="text-green-500/60">•</span>
                  <span className="text-gray-700 dark:text-gray-300 font-mono">
                    「{h.pattern}」
                  </span>
                  {h.mode && (
                    <span className="text-gray-400 dark:text-gray-600">({modeLabel(h.mode)})</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {triggerHits.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-cyan-600/80">{t("triggerKeywords")}</div>
              {triggerHits.map((h, i) => (
                <div key={i} className="pl-2 flex items-center gap-1.5">
                  <span className="text-cyan-500/60">•</span>
                  <span className="text-gray-700 dark:text-gray-300 font-mono">
                    「{h.pattern}」
                  </span>
                  {h.mode && (
                    <span className="text-gray-400 dark:text-gray-600">({modeLabel(h.mode)})</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                {t("sourceFiles", { count: selectedFiles.length })}
              </div>
              {selectedFiles.map((f) => {
                const fileName = f.split("/").pop() ?? f;
                return (
                  <div
                    key={f}
                    className="flex items-center gap-1.5 pl-2 py-0.5 text-gray-400 dark:text-gray-500 truncate"
                  >
                    <FileText className="w-2.5 h-2.5 text-blue-400/50 shrink-0" />
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
              <div className="text-gray-400 dark:text-gray-600">
                {t("availableFiles", { count: availableFiles })}
              </div>
            )}
            {durationMs > 0 && (
              <div className="text-gray-400 dark:text-gray-600">
                {t("searchDuration", { duration: durationMs })}
              </div>
            )}
          </div>
        </div>
      </details>
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
          <span className="text-gray-400 dark:text-gray-500 shrink-0">{t("queryLabel")}</span>
          <span className="text-gray-700 dark:text-gray-300 truncate">{query}</span>
        </div>
      )}
      <div className="flex gap-1.5">
        <span className="text-gray-400 dark:text-gray-500 shrink-0">
          {t("availableFilesLabel")}
        </span>
        <span className="text-gray-700 dark:text-gray-300">
          {t("filesCount", { count: availableFiles })}
        </span>
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
      <div className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        {isLong ? (
          <>
            <div className="flex items-start gap-1.5">
              <span className="text-gray-400 dark:text-gray-500 flex-1">
                {preview}
                {firstMeaningfulLine.length > 120 ? "..." : ""}
              </span>
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="shrink-0 p-0.5 text-cyan-400/60 hover:text-cyan-300 transition-colors text-[11px] underline decoration-dotted underline-offset-2"
                aria-expanded={isOpen}
                aria-label={isOpen ? t("collapseThinkingDetail") : t("expandThinkingDetail")}
              >
                {isOpen ? t("collapseDetail") : t("showDetail")}
              </button>
            </div>
            {isOpen && (
              <div className="mt-1.5 pl-0 border-l-2 border-cyan-500/20 prose dark:prose-invert prose-sm max-w-none prose-p:my-0.5 prose-headings:my-1">
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
}: {
  block: ContentBlock;
  isStreaming?: boolean;
  msgId: string;
  blockIndex: number;
  isEntry?: boolean;
  uiBlockMap: Map<string, UIInteractionBlock>;
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
            className="my-0.5 group relative px-3 pr-10 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words"
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
                className="p-1 rounded text-gray-400 dark:text-gray-600 hover:text-indigo-300 hover:bg-gray-200/60 dark:hover:bg-gray-800/60 transition-colors"
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
      if (!MEMORY_CUSTOM_TYPES.has(block.customType)) {
        return null;
      }
      return (
        <MemoryCard
          customType={block.customType}
          data={block.data}
          blockId={blockId}
          isEntry={isEntry}
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
  const [collapsed, setCollapsed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  let bgOnly: string;
  if (isRunning) {
    bgOnly = "bg-blue-950/15 dark:bg-blue-950/15";
  } else if (isError) {
    bgOnly = "bg-red-950/10 dark:bg-red-950/10";
  } else {
    bgOnly = "bg-amber-950/[0.06] dark:bg-gray-800/20";
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
      <div className="px-3 py-1 flex items-center gap-2 text-xs">
        <button
          onClick={handleToggleCollapse}
          className="p-0.5 text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors shrink-0"
          title={collapsed ? t("expandToolCard") : t("collapseToolCard")}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("expandToolCard") : t("collapseToolCard")}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <span
          className={`font-medium ${isRunning ? "text-blue-400" : isError ? "text-red-400" : "text-amber-300/80"}`}
        >
          {block.toolName}
        </span>
        {isRunning && <span className="text-blue-400 animate-pulse text-[10px]">running</span>}
        {!isRunning && !isError && (
          <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 ml-auto" />
        )}
        {isError && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 ml-auto" />}
        <CopyButton text={fullExecutionText} size="xs" title={t("copyAllExecution")} />
      </div>

      {collapsed ? (
        <div className="px-3 pb-2 text-[11px] text-gray-400 dark:text-gray-500 truncate">
          {block.output ? block.output.split("\n")[0].slice(0, 100) : t("waitingOutput")}
        </div>
      ) : (
        <>
          <div
            className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400 select-none flex items-center gap-1.5"
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
              <pre className="text-[11px] text-yellow-300/60 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">
                {tryFormatAsYaml(block.args)}
              </pre>
            </div>
          )}

          <div
            className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400 select-none flex items-center gap-1.5"
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
              <span className="ml-auto text-blue-400/70 animate-pulse text-[10px]">streaming</span>
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
                <pre className="text-[11px] text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto bg-gray-50 dark:bg-gray-900/30 rounded px-2 py-1.5">
                  {block.output}
                </pre>
              ) : isRunning ? (
                <div className="text-[11px] text-gray-400 dark:text-gray-600 italic py-1">
                  {t("waiting")}
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
});

export const MessageMetaFooter = memo(function MessageMetaFooter({
  message,
}: {
  message: ChatMessage;
}) {
  const { t } = useTranslation("chat");
  const { tokenUsage, model, provider } = message;
  const hasMeta = model ?? provider ?? tokenUsage;

  if (!hasMeta) return null;

  const isMobile = useLayoutStore((s) => s.breakpoint) === "mobile";

  return (
    <div className="mt-1.5 pt-1.5 pl-2 pb-0.5 border-t border-gray-200/20 dark:border-gray-800/20">
      <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400 dark:text-gray-600">
        <span className="flex items-center gap-1.5 shrink-0">
          {provider && (
            <span>
              {t("agent")}: {provider}
            </span>
          )}
          {model && (
            <span>
              {provider ? "· " : ""}
              {model}
            </span>
          )}
        </span>
        {tokenUsage && (
          <span className="flex items-center gap-1 font-mono truncate">
            {!isMobile && (tokenUsage.cacheRead ?? 0) > 0 && (
              <span className="hidden sm:inline">
                {formatTokenCount(tokenUsage.cacheRead ?? 0)}↓
              </span>
            )}
            {!isMobile && (tokenUsage.cacheWrite ?? 0) > 0 && (
              <span className="hidden sm:inline">
                {formatTokenCount(tokenUsage.cacheWrite ?? 0)}↑
              </span>
            )}
            {!isMobile && (tokenUsage.reasoning ?? 0) > 0 && (
              <span className="hidden sm:inline">R{tokenUsage.reasoning}</span>
            )}
            <span>
              {formatTokenCount(tokenUsage.input)}→{formatTokenCount(tokenUsage.output)}
            </span>
            <span className="text-gray-400 dark:text-gray-800">·</span>
            <span>{formatTokenCount(tokenUsage.input + tokenUsage.output)}</span>
            {tokenUsage.cost != null && (
              <>
                <span className="text-gray-400 dark:text-gray-800">·</span>
                <span>${tokenUsage.cost.toFixed(2)}</span>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
});

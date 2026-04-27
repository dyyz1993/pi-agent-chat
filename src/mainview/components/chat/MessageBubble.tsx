import { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import { Brain, AlertTriangle, FileText, Bookmark } from "lucide-react";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import type { ChatMessage, ContentBlock } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { useSessionStore } from "../../stores/use-session-store";
import { SubagentExecutionCard } from "./tool-renderers/SubagentRenderer";
import { getToolRenderer } from "./tool-renderers";
import { getCustomTypeIcon } from "./tool-icon-map";
import { useBookmarkStore, type BookmarkItem } from "../../stores/use-bookmark-store";

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isActive = useChatNavStore(
    useCallback((s) => s.activeId === message.id, [message.id])
  );
  const isSelected = useChatNavStore(
    useCallback((s) => s.selectedItems.has(message.id), [message.id])
  );
  const isBookmarked = useBookmarkStore(
    useCallback((s) => {
      const items: BookmarkItem[] = []
      for (const vals of Object.values(s.itemsByProject)) items.push(...vals)
      return items.some((i) => i.sourceMessageIds.includes(message.id))
    }, [])
  );

  const styleMemo = useMemo(() => {
    let border = "";
    let bg = "";
    if (isSelected) {
      border = "border-2 border-red-500/70";
      bg = "bg-red-500/8";
    } else if (isActive) {
      if (isUser) {
        border = "border border-green-500/50";
        bg = "bg-green-500/[0.04]";
      } else {
        const hasError = message.content.some(
          (b) =>
            (b.type === "toolResult" && b.isError) ||
            (b.type === "toolExecution" && b.status === "error")
        );
        if (hasError) {
          border = "border border-red-500/50";
          bg = "bg-red-500/[0.06]";
        } else {
          border = "border border-blue-500/50";
          bg = "bg-blue-500/[0.06]";
        }
      }
    } else {
      border = "border border-transparent";
    }
    return { border, bg, isUser };
  }, [isSelected, isActive, isUser, message.content]);

  const baseBg = isUser ? "bg-indigo-600 text-white" : "bg-transparent text-gray-200";

  return (
      <div
        id={`msg-${message.id}`}
        data-msg-id={message.id}
        className={`group flex ${styleMemo.isUser ? "justify-end" : "justify-start w-full"} ${isSelected ? "relative" : ""}`}
      >
        {isSelected && (
          <div className="absolute inset-0 rounded-lg bg-red-500/[0.04] pointer-events-none" />
        )}
        <div
          className={`${styleMemo.isUser ? "max-w-[85%]" : "w-full"} px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words transition-colors ${baseBg} ${styleMemo.border} ${styleMemo.bg}`}
        >
          {message.content.map((block, i) => (
            <ContentBlockRenderer key={i} block={block} isStreaming={message.isStreaming} />
          ))}
          {message.isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
          {!isUser && (message.tokenUsage || message.model) && (
            <MessageMetaFooter message={message} />
          )}
        </div>
        {!isUser && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              const { activeProjectId, projectTabs } = useSessionStore.getState()
              if (isBookmarked) {
                const bm = useBookmarkStore.getState().itemsByProject
                const item = Object.values(bm).flat().find((i) => i.sourceMessageIds.includes(message.id))
                if (item) useBookmarkStore.getState().removeBookmark(item.filePath)
              } else {
                const text = message.content
                  .filter((b) => b.type === "text")
                  .map((b) => b.text)
                  .join("\n")
                const tab = projectTabs.find((t) => t.id === activeProjectId)
                if (tab && activeProjectId) {
                  useBookmarkStore.getState().addBookmark(tab.path, activeProjectId, [message.id], text)
                }
              }
            }}
            className={`absolute -top-2 right-${isUser ? 4 : 8} w-6 h-6 rounded flex items-center justify-center border border transition-all duration-150 ${
              isBookmarked
                ? "bg-amber-400/15 border-amber-400/30 text-amber-400"
                : "bg-gray-800/80 border-gray-700 hover:border-amber-400/50 text-gray-500 opacity-0 group-hover:opacity-100"
            }`}
            title={isBookmarked ? "取消收藏" : "添加收藏"}
          >
            <Bookmark
              size={11}
              className={isBookmarked ? "fill-current" : ""}
            />
          </button>
        )}
    </div>
  );
});

export const ThinkingCard = memo(function ThinkingCard({ 
    thinking, 
    isStreaming 
  }: { 
    thinking: string; 
    isStreaming: boolean;
  }) {
  const [isOpen, setIsOpen] = useState(true);

  // 流式结束后自动折叠
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setIsOpen(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // 获取第一行用于预览
  const firstLine = thinking.split('\n')[0] || 'Thinking...';
  const hasMore = thinking.includes('\n') || thinking.length > 80;

  return (
    <div className="my-1 border border-purple-600/30 rounded-lg overflow-hidden bg-purple-950/10">
      <div 
        className={`px-3 py-1.5 text-xs flex items-center gap-2 ${!isStreaming ? 'cursor-pointer hover:bg-gray-800/50' : ''}`}
        onClick={() => !isStreaming && setIsOpen(!isOpen)}
      >
        <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0" />
        <span className="text-purple-300 font-medium">Thinking</span>
        {isStreaming && <span className="text-purple-400 animate-pulse text-[10px]">...</span>}
      </div>
      
      {isOpen ? (
        <div className="px-3 pb-2 text-xs text-gray-300 whitespace-pre-wrap bg-gray-800/20 border-t border-purple-600/20">
          {thinking || <span className="text-gray-500 italic">thinking...</span>}
        </div>
      ) : hasMore ? (
        <div className="px-3 py-1 text-[11px] text-gray-400 truncate border-t border-purple-600/20 bg-gray-800/10">
          {firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine}
        </div>
      ) : null}
    </div>
  );
});

const MEMORY_ICONS: Record<string, { label: string; color: string }> = {
  memory_prefetch: { label: "Memory Search", color: "text-blue-400" },
  memory_prefetch_result: { label: "Memories Found", color: "text-blue-400" },
  memory_extract: { label: "Memory Saved", color: "text-green-400" },
  memory_extract_result: { label: "Extraction Result", color: "text-green-400" },
  memory_dream: { label: "Memory Consolidation", color: "text-purple-400" },
  memory_dream_result: { label: "Dream Result", color: "text-purple-400" },
}

export const MEMORY_CUSTOM_TYPES = new Set(Object.keys(MEMORY_ICONS))

const LSP_CUSTOM_TYPES: Record<string, { label: string; color: string }> = {
  lsp: { label: "LSP", color: "text-blue-400" },
  lsp_notify: { label: "LSP Diagnostics", color: "text-yellow-400" },
  lsp_diagnostics: { label: "LSP Diagnostics", color: "text-yellow-400" },
}

export const LSP_CUSTOM_TYPES_SET = new Set(Object.keys(LSP_CUSTOM_TYPES))

export const LSP_VISIBLE_TYPES = new Set(["lsp_diagnostics"])

export function isLspCustomType(customType: string): boolean {
  return LSP_CUSTOM_TYPES_SET.has(customType)
}

export function isLspVisibleInChat(customType: string): boolean {
  return LSP_VISIBLE_TYPES.has(customType)
}

export const LspDiagnosticsCard = memo(function LspDiagnosticsCard({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") {
    return (
      <div className="my-1 border border-yellow-700/30 rounded-lg overflow-hidden bg-yellow-900/10">
        <div className="px-3 py-1.5 text-xs font-medium text-yellow-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>LSP Diagnostics</span>
        </div>
      </div>
    )
  }

  const details = data as { files?: Array<{ filePath: string; summary: string; issues: Array<{ severity?: number; line: number; message: string; source?: string; code?: string | number }> }> }

  return (
    <div className="my-1 border border-yellow-700/30 rounded-lg overflow-hidden bg-yellow-900/10">
      <div className="px-3 py-1.5 text-xs font-medium text-yellow-400 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>LSP Diagnostics</span>
      </div>
      <div className="border-t border-yellow-700/20">
        {details.files?.map((f) => (
          <div key={f.filePath} className="px-3 py-1.5 border-b last:border-b-0 border-yellow-700/10">
            <div className="text-[11px] text-yellow-300 font-medium flex items-center gap-1">
              <FileText className="w-3 h-3 shrink-0" />
              <span>{f.filePath}</span>
              <span className="text-yellow-500 ml-1">{f.summary}</span>
            </div>
            {f.issues.map((issue, i) => (
              <div key={i} className="text-[10px] text-gray-400 pl-4 pt-0.5">
                <span className={issue.severity === 1 ? "text-red-400" : issue.severity === 2 ? "text-yellow-400" : "text-gray-500"}>
                  L{issue.line}
                </span>
                {issue.source && <span className="text-gray-600"> [{issue.source}]</span>}
                {issue.code != null && <span className="text-gray-600"> ({String(issue.code)})</span>}
                : {issue.message}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
})

export const MemoryCard = memo(function MemoryCard({ customType, data }: { customType: string; data: unknown }) {
  const config = MEMORY_ICONS[customType] ?? { label: customType, color: "text-gray-400" }
  const Icon = getCustomTypeIcon(customType).icon

  const dataStr = typeof data === "string" ? data : data ? JSON.stringify(data, null, 2) : ""

  return (
    <div className="my-1 border border-gray-700/50 rounded-lg overflow-hidden bg-gray-800/30">
      <div className={`px-3 py-1.5 text-xs font-medium ${config.color} flex items-center gap-1.5`}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{config.label}</span>
      </div>
      {dataStr && (
        <pre className="px-3 pb-2 text-[11px] text-gray-400 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto border-t border-gray-700/30">
          {dataStr.length > 500 ? dataStr.slice(0, 500) + "..." : dataStr}
        </pre>
      )}
    </div>
  )
})

export const ContentBlockRenderer = memo(function ContentBlockRenderer({ block, isStreaming }: { block: ContentBlock; isStreaming?: boolean }) {
  switch (block.type) {
    case "text":
      if (isStreaming) {
        return (
          <div className="my-1 px-3 py-2 rounded-lg bg-gray-700/80 text-sm text-gray-200 whitespace-pre-wrap break-words overflow-auto max-h-[60vh]">{block.text}</div>
        );
      }
      return (
        <div className="my-1 px-3 py-2 rounded-lg bg-gray-700/80 prose prose-invert prose-sm max-w-none overflow-auto max-h-[60vh]">
          <CachedReactMarkdown>{block.text}</CachedReactMarkdown>
        </div>
      );
    case "thinking":
      return <ThinkingCard thinking={block.thinking} isStreaming={!!isStreaming} />;
    case "toolCall":
      return (
        <div className="my-1 border border-yellow-600/30 rounded-lg overflow-hidden bg-yellow-900/5">
          <div className="px-3 py-1.5 text-xs text-yellow-400 flex items-center gap-1.5">
            <span>▶</span><span>Tool: {block.name}</span>
          </div>
          <pre className="px-3 pb-2 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">{block.input}</pre>
        </div>
      );
    case "toolResult":
      return (
        <details className="my-1 border border-gray-600 rounded-lg overflow-hidden">
          <summary className={`px-3 py-1.5 text-xs cursor-pointer flex items-center gap-1.5 ${block.isError ? "text-red-400" : "text-green-400"} hover:bg-gray-800/50`}>
            <span>{block.isError ? "✗" : "✓"}</span><span>Result{block.isError ? " (error)" : ""}</span>
          </summary>
          <pre className="px-3 pb-2 text-xs text-gray-300 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">{block.content}</pre>
        </details>
      );
    case "toolExecution": {
      if (block.toolName.toLowerCase() === "subagent") {
        return <SubagentExecutionCard block={block} />;
      }
      const renderer = getToolRenderer(block.toolName);
      if (renderer?.renderExecution) {
        const CustomCard = renderer.renderExecution;
        return <CustomCard block={block} />;
      }
      return <ToolExecutionCard block={block} />;
    }
    case "custom":
      if (isLspCustomType(block.customType)) {
        if (!isLspVisibleInChat(block.customType)) {
          return null;
        }
        return <LspDiagnosticsCard data={block.data} />;
      }
      return <MemoryCard customType={block.customType} data={block.data} />;
  }
});

export const ToolExecutionCard = memo(function ToolExecutionCard({ block }: { block: Extract<ContentBlock, { type: "toolExecution" }> }) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";

  let borderBg: string;
  if (isRunning) {
    borderBg = "border-blue-500/30 bg-blue-950/15";
  } else if (isError) {
    borderBg = "border-red-500/20 bg-red-950/10";
  } else {
    borderBg = "border-gray-700/40 bg-gray-800/20";
  }

  return (
    <div className={`my-1.5 -mx-3 rounded-none overflow-hidden border-x-0 border-t border-b ${borderBg}`}>
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <span className={`font-medium ${isRunning ? "text-blue-400" : isError ? "text-red-400" : "text-gray-300"}`}>{block.toolName}</span>
        {isRunning && <span className="text-blue-400 animate-pulse text-[10px]">running</span>}
      </div>

      <details className="group">
        <summary className="px-3 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-700/30">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
          <span>Input</span>
        </summary>
        <div className="px-3 pb-2">
          {block.args ? (
            <pre className="text-[11px] text-yellow-300/60 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">{block.args}</pre>
          ) : null}
        </div>
      </details>

      <details open className="group">
        <summary className="px-3 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-700/30">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
          <span>Output</span>
          {isRunning && <span className="ml-auto text-blue-400/70 animate-pulse text-[10px]">streaming</span>}
        </summary>
        <div className="px-3 pb-2">
          {block.output ? (
            <pre className="text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">{block.output}</pre>
          ) : isRunning ? (
            <div className="text-[11px] text-gray-600 italic py-1">waiting...</div>
          ) : null}
        </div>
      </details>
    </div>
  );
});


export const MessageMetaFooter = memo(function MessageMetaFooter({ message }: { message: ChatMessage }) {
  const { tokenUsage, model, provider } = message;

  return (
    <div className="mt-2 pt-2 border-t border-gray-700/40 space-y-1.5">
      {(model || provider) && (
        <div className="text-[11px] text-gray-500">
          {provider && <span>智能体: {provider}</span>}
          {model && <>{provider && "  "}<span>模型: {model}</span></>}
        </div>
      )}
      {tokenUsage && (
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span>输入 {tokenUsage.input}</span>
          <span>输出 {tokenUsage.output}</span>
          {(tokenUsage.reasoning ?? 0) > 0 && <span>推理 {tokenUsage.reasoning}</span>}
          {(tokenUsage.cacheRead ?? 0) > 0 && <span>缓存读取 {formatK(tokenUsage.cacheRead ?? 0)}</span>}
          {(tokenUsage.cacheWrite ?? 0) > 0 && <span>缓存写入 {formatK(tokenUsage.cacheWrite ?? 0)}</span>}
          {tokenUsage.cost != null && <span>费用 ${tokenUsage.cost.toFixed(2)}</span>}
        </div>
      )}
    </div>
  );
});

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return `${n}`;
}

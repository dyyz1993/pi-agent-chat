import { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import { Brain, AlertTriangle, FileText, ChevronDown, ChevronRight, CheckCircle, XCircle, Type } from "lucide-react";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import { CopyButton } from "./CopyButton";
import type { ChatMessage, ContentBlock } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { SubagentExecutionCard } from "./tool-renderers/SubagentRenderer";
import { getToolRenderer } from "./tool-renderers";
import { getCustomTypeIcon } from "./tool-icon-map";

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const isActive = useChatNavStore(
    useCallback((s) => sessionId ? (s.activeIdBySession[sessionId] ?? null) === message.id : false, [sessionId, message.id])
  );
  const isSelected = useChatNavStore(
    useCallback((s) => sessionId ? (s.selectedItemsBySession[sessionId] ?? EMPTY_SET).has(message.id) : false, [sessionId, message.id])
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
        if (b.type === "toolResult") return b.isError ? `[Error] ${b.content}` : `[Result] ${b.content}`;
        if (b.type === "toolExecution") return `[Execution: ${b.toolName}]\nInput: ${b.args ?? ""}\nOutput: ${b.output ?? ""}`;
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
        <div className="absolute inset-0 rounded-lg bg-indigo-500/[0.06] pointer-events-none" />
      )}
      {isUser ? (
        <div className={`relative mx-2 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-gray-100 bg-blue-500/[0.06] rounded-lg ${styleMemo.bg} min-w-0`}>
          <div className="absolute -top-0.5 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <CopyButton text={fullTextForCopy} size="xs" />
          </div>
          {message.content.filter((b) => b.type === "text").map((b, i) => (
            <span key={i}>{(b as Extract<ContentBlock, { type: "text" }>).text}</span>
          ))}
        </div>
      ) : (
        <div className={`w-full px-1 py-0.5 text-gray-200 transition-colors ${styleMemo.bg} min-w-0 overflow-hidden`}>
          {message.content.map((block, i) => (
            <ContentBlockRenderer key={i} block={block} isStreaming={message.isStreaming} msgId={message.id} blockIndex={i} />
          ))}
          {message.isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
          {(message.tokenUsage || message.model) && (
            <MessageMetaFooter message={message} />
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
  const [isOpen, setIsOpen] = useState(true);
  const firstLine = text.split('\n')[0] || '';
  const hasMore = text.includes('\n') || text.length > 120;

  return (
    <div className="my-0.5 overflow-hidden" data-block-id={blockId}>
      <div
        className={`flex items-center gap-2 px-2 pl-1 py-0.5 text-[11px] ${!isStreaming ? 'cursor-pointer hover:bg-gray-800/30' : ''}`}
        onClick={() => !isStreaming && setIsOpen(!isOpen)}
      >
        <Type className="w-3 h-3 text-gray-500 shrink-0" />
        {!isStreaming && (
          <button
            onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
            className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors ml-auto"
            title={isOpen ? "折叠" : "展开"}
          >
            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
        <CopyButton text={text} size="xs" title="复制文本内容" />
      </div>

      {isOpen ? (
        <div className="px-3 py-1.5 prose prose-invert prose-sm max-w-none overflow-auto max-h-[60vh] prose-p:my-1 prose-pre:bg-transparent">
          {isStreaming ? (
            <span>{text}</span>
          ) : (
            <CachedReactMarkdown>{text}</CachedReactMarkdown>
          )}
        </div>
      ) : hasMore ? (
        <div className="px-2 pl-1 py-0.5 text-[11px] text-gray-500 truncate">
          {firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine}
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
  const [isOpen, setIsOpen] = useState(true);

  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setIsOpen(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const firstLine = thinking.split('\n')[0] || 'Thinking...';
  const hasMore = thinking.includes('\n') || thinking.length > 80;

  return (
    <div className="my-1 overflow-hidden" data-block-id={blockId}>
      <div 
        className={`px-2 pl-1 py-0.5 text-[11px] flex items-center gap-2 ${!isStreaming ? 'cursor-pointer hover:bg-gray-800/30' : ''}`}
        onClick={() => !isStreaming && setIsOpen(!isOpen)}
      >
        <Brain className="w-3 h-3 text-purple-400/60 shrink-0" />
        <span className="text-purple-300/70 font-medium">Thinking</span>
        {isStreaming && <span className="text-purple-400/50 animate-pulse text-[10px]">...</span>}
        {!isStreaming && (
          <div className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setIsOpen(!isOpen)}
              title={isOpen ? "折叠" : "展开"}
              className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors"
            >
              {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <CopyButton text={thinking} size="xs" title="复制思考内容" />
          </div>
        )}
      </div>
      
      {isOpen ? (
        <div className="px-2 pl-1 pb-1.5 text-[11px] text-gray-400 whitespace-pre-wrap leading-relaxed">
          {thinking || <span className="text-gray-600 italic">thinking...</span>}
        </div>
      ) : hasMore ? (
        <div className="px-2 pl-1 py-0.5 text-[11px] text-gray-500 truncate">
          {firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine}
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
      <div className="my-1 overflow-hidden bg-yellow-950/5">
        <div className="px-4 py-1 text-[11px] font-medium text-yellow-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" />
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

export const MemoryCard = memo(function MemoryCard({ customType, data, blockId }: { customType: string; data: unknown; blockId: string }) {
  const config = MEMORY_ICONS[customType] ?? { label: customType, color: "text-gray-400" }
  const Icon = getCustomTypeIcon(customType).icon

  const dataStr = typeof data === "string" ? data : data ? JSON.stringify(data, null, 2) : ""

  return (
    <div className="my-1 overflow-hidden bg-gray-800/8" data-block-id={blockId}>
      <div className={`px-4 py-1 text-[11px] font-medium ${config.color} flex items-center gap-1.5`}>
        <Icon className="w-3 h-3 shrink-0" />
        <span>{config.label}</span>
        {dataStr && (
          <CopyButton text={dataStr} size="xs" className="ml-auto" title={`复制${config.label}内容`} />
        )}
      </div>
      {dataStr && (
        <pre className="px-4 pb-2 text-[11px] text-gray-500 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
          {dataStr.length > 500 ? dataStr.slice(0, 500) + "..." : dataStr}
        </pre>
      )}
    </div>
  )
})

export const ContentBlockRenderer = memo(function ContentBlockRenderer({ block, isStreaming, msgId, blockIndex }: { block: ContentBlock; isStreaming?: boolean; msgId: string; blockIndex: number }) {
  const blockId = `${msgId}-${blockIndex}`;
  switch (block.type) {
    case "text":
      if (isStreaming) {
        return (
          <div data-block-id={blockId} className="my-0.5 group relative px-3 py-2 pr-10 text-sm text-gray-200 whitespace-pre-wrap break-words overflow-auto max-h-[60vh]">
            <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton text={block.text} size="xs" />
            </div>
            {block.text}
          </div>
        );
      }
      return (
        <div data-block-id={blockId} className="my-0.5 group relative px-3 py-2 pr-10 prose prose-invert prose-sm max-w-none overflow-auto max-h-[60vh] prose-p:my-1 prose-pre:bg-transparent">
          <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton text={block.text} size="xs" />
          </div>
          <CachedReactMarkdown>{block.text}</CachedReactMarkdown>
        </div>
      );
    case "thinking":
      return <ThinkingCard thinking={block.thinking} isStreaming={!!isStreaming} blockId={blockId} />;
    case "toolCall":
      return (
        <div data-block-id={blockId} className="my-1 overflow-hidden">
          <div className="px-4 py-1 text-[11px] text-yellow-400/70 flex items-center gap-1.5">
            <span>▶</span><span>Tool: {block.name}</span>
            <CopyButton text={typeof block.input === "string" ? block.input : JSON.stringify(block.input)} size="xs" className="ml-auto" title="复制工具输入" />
          </div>
          <pre className="px-4 pb-2 text-[11px] text-gray-400 overflow-x-auto whitespace-pre-wrap">{block.input}</pre>
        </div>
      );
    case "toolResult":
      return (
        <details data-block-id={blockId} className="my-1 overflow-hidden group">
          <summary className={`px-3 pl-2 py-1 text-[11px] cursor-pointer flex items-center gap-1.5 ${block.isError ? "text-red-400" : "text-green-400"} hover:bg-gray-800/20`}>
            <span>{block.isError ? "✗" : "✓"}</span><span>Result{block.isError ? " (error)" : ""}</span>
            <CopyButton text={block.content} size="xs" className="ml-auto" title="复制结果内容" />
          </summary>
          <pre className="px-3 pl-2 pb-2 text-[11px] text-gray-400 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">{block.content}</pre>
        </details>
      );
    case "toolExecution": {
      if (block.toolName.toLowerCase() === "subagent") {
        return <SubagentExecutionCard block={block} blockId={blockId} />;
      }
      const renderer = getToolRenderer(block.toolName);
      if (renderer?.renderExecution) {
        const CustomCard = renderer.renderExecution;
        return <CustomCard block={block} blockId={blockId} />;
      }
      return <ToolExecutionCard block={block} blockId={blockId} />;
    }
    case "custom":
      if (isLspCustomType(block.customType)) {
        if (!isLspVisibleInChat(block.customType)) {
          return null;
        }
        return <LspDiagnosticsCard data={block.data} />;
      }
      return <MemoryCard customType={block.customType} data={block.data} blockId={blockId} />;
  }
});

export const ToolExecutionCard = memo(function ToolExecutionCard({ block, blockId }: { block: Extract<ContentBlock, { type: "toolExecution" }>; blockId: string }) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  let barColor: string;
  let bgOnly: string;
  if (isRunning) {
    barColor = "border-l-blue-400/50";
    bgOnly = "bg-blue-950/8";
  } else if (isError) {
    barColor = "border-l-red-400/50";
    bgOnly = "bg-red-950/5";
  } else {
    barColor = "border-l-amber-500/40";
    bgOnly = "bg-amber-950/[0.04]";
  }

  const fullExecutionText = useMemo(() => {
    return `[工具调用] ${block.toolName}\n输入:\n${block.args ?? ""}\n输出:\n${block.output ?? ""}`;
  }, [block.toolName, block.args, block.output]);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      if (!prev && cardRef.current) {
        cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return !prev;
    });
  }, []);

  return (
    <div ref={cardRef} className={`my-1 -mx-2 overflow-hidden border-l-[3px] ${barColor} ${bgOnly}`} data-block-id={blockId}>
      <div className="px-3 py-1 pl-2 flex items-center gap-2 text-xs">
        <button
          onClick={handleToggleCollapse}
          className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors shrink-0"
          title={collapsed ? "展开工具卡片" : "折叠工具卡片"}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <span className={`font-medium ${isRunning ? "text-blue-400" : isError ? "text-red-400" : "text-amber-300/80"}`}>{block.toolName}</span>
        {isRunning && <span className="text-blue-400 animate-pulse text-[10px]">running</span>}
        {!isRunning && !isError && (
          <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 ml-auto" />
        )}
        {isError && (
          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 ml-auto" />
        )}
        <CopyButton text={fullExecutionText} size="xs" title="复制全部执行结果" />
      </div>

      {collapsed ? (
        <div className="px-3 pl-2 pb-1 text-[11px] text-gray-500 truncate">
          {block.output ? block.output.split('\n')[0].slice(0, 100) : "(等待输出)"}
        </div>
      ) : (
        <>
          <div
            className="px-3 pl-2 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5"
            onClick={() => setInputOpen(!inputOpen)}
          >
            <svg className={`w-3 h-3 transition-transform shrink-0 ${inputOpen ? "rotate-90" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
            <span>Input</span>
            {block.args && (
              <CopyButton text={typeof block.args === "string" ? block.args : JSON.stringify(block.args)} size="xs" className="ml-auto" title="复制输入" />
            )}
          </div>
          {inputOpen && block.args && (
            <div className="px-3 pb-2 pt-0.5">
              <pre className="text-[11px] text-yellow-300/60 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed pl-2">{block.args}</pre>
            </div>
          )}

          <div
            className="px-3 pl-2 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5"
            onClick={() => setOutputOpen(!outputOpen)}
          >
            <svg className={`w-3 h-3 transition-transform shrink-0 ${outputOpen ? "rotate-90" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
            <span>Output</span>
            {isRunning && <span className="ml-auto text-blue-400/70 animate-pulse text-[10px]">streaming</span>}
            {block.output && !isRunning && (
              <CopyButton text={block.output} size="xs" className="ml-auto" title="复制输出" />
            )}
          </div>
          {outputOpen && (
            <div className="px-3 pb-2 pt-0.5">
              {block.output ? (
                <pre className="text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto pl-2">{block.output}</pre>
              ) : isRunning ? (
                <div className="text-[11px] text-gray-600 italic py-1">waiting...</div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
});


export const MessageMetaFooter = memo(function MessageMetaFooter({ message }: { message: ChatMessage }) {
  const { tokenUsage, model, provider } = message;

  return (
    <div className="mt-1.5 pt-1.5 border-t border-gray-800/20 space-y-1">
      {(model || provider) && (
        <div className="text-[10px] text-gray-600">
          {provider && <span>智能体: {provider}</span>}
          {model && <>{provider && "  "}<span>模型: {model}</span></>}
        </div>
      )}
      {tokenUsage && (
        <div className="flex items-center gap-2 text-[10px] text-gray-600">
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

import { useCallback, memo, useMemo } from "react";
import type { ChatMessage, ContentBlock } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { SubagentExecutionCard } from "./tool-renderers/SubagentRenderer";
import { getToolRenderer } from "./tool-renderers";

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const activeId = useChatNavStore((s) => s.activeId);
  const selectedIds = useChatNavStore((s) => s.selectedIds);
  const setActive = useChatNavStore((s) => s.setActive);
  const isActive = activeId === message.id;
  const isSelected = selectedIds.has(message.id);

  const handleClick = useCallback(() => {
    setActive(message.id);
  }, [message.id, setActive]);

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
      className={`flex ${styleMemo.isUser ? "justify-end" : "justify-start w-full"} ${isSelected ? "relative" : ""}`}
      onClick={handleClick}
    >
      {isSelected && (
        <div className="absolute inset-0 rounded-lg bg-red-500/[0.04] pointer-events-none" />
      )}
      <div
        className={`${styleMemo.isUser ? "max-w-[85%]" : "w-full"} px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words transition-colors ${baseBg} ${styleMemo.border} ${styleMemo.bg}`}
      >
        {message.content.map((block, i) => (
          <ContentBlockRenderer key={i} block={block} />
        ))}
        {message.isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
        )}
        {!isUser && (message.tokenUsage || message.model) && (
          <MessageMetaFooter message={message} />
        )}
      </div>
    </div>
  );
});

export const ContentBlockRenderer = memo(function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "text":
      return (
        <div className="my-1 px-3 py-2 rounded-lg bg-gray-700/80">{block.text}</div>
      );
    case "thinking":
      return (
        <details className="my-1 border border-gray-600 rounded-lg overflow-hidden">
          <summary className="px-3 py-1.5 text-xs text-gray-400 cursor-pointer hover:bg-gray-800/50">Thinking...</summary>
          <div className="px-3 pb-2 text-xs text-gray-300 whitespace-pre-wrap bg-gray-800/30">{block.thinking}</div>
        </details>
      );
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
          <pre className="px-3 pb-2 text-xs text-gray-300 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap bg-gray-800/30">{block.content}</pre>
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
  }
});

export const ToolExecutionCard = memo(function ToolExecutionCard({ block }: { block: Extract<ContentBlock, { type: "toolExecution" }> }) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";

  return (
    <div className={`my-1.5 -mx-3 rounded-none overflow-hidden border-x-0 border-t border-b ${
      isRunning ? "border-blue-500/30 bg-blue-950/15" : isError ? "border-red-500/20 bg-red-950/10" : "border-gray-700/40 bg-gray-800/20"
    }`}>
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <span className={`font-medium ${isRunning ? "text-blue-400" : isError ? "text-red-400" : "text-gray-300"}`}>{block.toolName}</span>
        {isRunning && <span className="text-blue-400 animate-pulse text-[10px]">running</span>}
      </div>

      <details className="group">
        <summary className="px-3 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-700/30">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3"/></svg>
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
          <svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3"/></svg>
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

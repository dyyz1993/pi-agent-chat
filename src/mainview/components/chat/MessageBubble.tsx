import type { ChatMessage, ContentBlock } from "../../types";
import { useState } from "react";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${
          isUser
            ? "bg-indigo-600 text-white"
            : "bg-transparent text-gray-200"
        }`}
      >
        {message.content.map((block, i) => (
          <ContentBlockRenderer key={i} block={block} />
        ))}
        {message.isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}

function ContentBlockRenderer({ block }: { block: ContentBlock }) {
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
    case "toolExecution":
      return <ToolExecutionCard block={block} />;
  }
}

function ToolExecutionCard({ block }: { block: Extract<ContentBlock, { type: "toolExecution" }> }) {
  const [inputOpen, setInputOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(true);
  const isRunning = block.status === "running";
  const isError = block.status === "error";

  const statusIcon = isRunning ? "⏳" : isError ? "✗" : "✓";
  const statusText = isRunning ? "执行中..." : isError ? "失败" : "完成";

  function handleCopy() {
    if (block.output) navigator.clipboard.writeText(block.output);
  }

  return (
    <div className={`my-1.5 border rounded-lg overflow-hidden ${
      isRunning ? "border-blue-500/40 bg-blue-950/20" : isError ? "border-red-500/30 bg-red-950/10" : "border-gray-600/50 bg-gray-800/30"
    }`}>
      {/* Header — 可点击展开/收起全部 */}
      <div
        className="px-3 py-1.5 flex items-center justify-between text-xs cursor-pointer select-none"
        onClick={() => { setInputOpen((v) => !v); setOutputOpen((v) => !v); }}
      >
        <div className="flex items-center gap-2 text-gray-300">
          <svg className="w-3.5 h-3.5 text-gray-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v6l3 3" /></svg>
          <span className="text-gray-400">工具调用</span>
          <span className="font-medium text-white">{block.toolName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${isRunning ? "text-blue-400" : isError ? "text-red-400" : "text-green-400"}`}>
            {statusIcon} {statusText}
          </span>
          {!isRunning && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                className="p-0.5 hover:bg-gray-700 rounded text-gray-400 hover:text-gray-200"
                title="复制输出"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="4" width="9" height="9" rx="1"/><path d="M9 4V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h1"/></svg>
              </button>
              <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform ${inputOpen && outputOpen ? "" : "-rotate-90"}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4"/></svg>
            </>
          )}
        </div>
      </div>

      {/* Tool Input */}
      {inputOpen && block.args && (
        <div className="border-t border-gray-700/50">
          <div className="px-3 py-1 text-[11px] text-gray-500 uppercase tracking-wider">Input</div>
          <pre className="px-3 pb-2 text-xs text-yellow-300/80 overflow-x-auto whitespace-pre-wrap font-mono">{block.args}</pre>
        </div>
      )}

      {/* Tool Output */}
      {outputOpen && (
        <div className="border-t border-gray-700/50">
          <div className="px-3 py-1 text-[11px] text-gray-500 uppercase tracking-wider flex items-center justify-between">
            <span>Output</span>
            {isRunning && <span className="text-blue-400 animate-pulse">● 实时输出中</span>}
          </div>
          <div className="px-3 pb-2 relative group">
            {block.output ? (
              <pre className="text-xs text-gray-200 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-80 overflow-y-auto">{block.output}</pre>
            ) : isRunning ? (
              <div className="text-xs text-gray-500 italic py-1">等待输出...</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

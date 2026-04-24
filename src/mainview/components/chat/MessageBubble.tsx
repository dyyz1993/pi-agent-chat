import type { ChatMessage, ContentBlock } from "../../types";

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
            : "bg-gray-700 text-gray-200"
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
      return <>{block.text}</>;
    case "thinking":
      return (
        <details className="my-1 border border-gray-600 rounded p-2 bg-gray-800/50">
          <summary className="text-xs text-gray-400 cursor-pointer">Thinking...</summary>
          <div className="mt-1 text-xs text-gray-300 whitespace-pre-wrap">{block.thinking}</div>
        </details>
      );
    case "toolCall":
      return (
        <details className="my-1 border border-yellow-600/30 rounded p-2 bg-yellow-900/10">
          <summary className="text-xs text-yellow-400 cursor-pointer">Tool: {block.name}</summary>
          <pre className="mt-1 text-xs text-gray-300 overflow-x-auto">{block.input}</pre>
        </details>
      );
    case "toolResult":
      return (
        <details className="my-1 border border-gray-600 rounded p-2 bg-gray-800/50">
          <summary className={`text-xs cursor-pointer ${block.isError ? "text-red-400" : "text-green-400"}`}>
            Result {block.isError ? "(error)" : ""}
          </summary>
          <pre className="mt-1 text-xs text-gray-300 overflow-x-auto">{block.content}</pre>
        </details>
      );
  }
}

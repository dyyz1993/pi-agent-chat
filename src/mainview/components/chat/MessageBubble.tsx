import type { ChatMessage } from "../../types";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${
          message.role === "user"
            ? "bg-indigo-600 text-white"
            : "bg-gray-700 text-gray-200"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

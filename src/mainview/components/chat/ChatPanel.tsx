import { useEffect, useRef } from "react";
import { MessageSquare, Send } from "lucide-react";
import { useChatStore } from "../../stores/use-chat-store";
import { MessageBubble } from "./MessageBubble";

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const inputText = useChatStore((s) => s.inputText);
  const setInputText = useChatStore((s) => s.setInputText);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Chat header */}
      <div className="px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-indigo-400" />
          Messages
          {messages.length > 0 && (
            <span className="ml-1 px-2 py-0.5 bg-indigo-600/30 text-indigo-300 rounded text-[10px]">
              {messages.length}
            </span>
          )}
        </h2>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Start a conversation...
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-4 py-3 bg-gray-800 border-t border-gray-700 flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="Type a message..."
          className="flex-1 px-3 py-2 text-sm bg-gray-700 rounded-lg text-white border border-gray-600 focus:border-indigo-500 focus:outline-none"
        />
        <button
          onClick={sendMessage}
          className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-1.5"
        >
          <Send className="w-4 h-4" />
          Send
        </button>
      </div>
    </div>
  );
}

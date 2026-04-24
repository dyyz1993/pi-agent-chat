import { useEffect, useRef, useState } from "react";
import {
  Square,
  ArrowUp,
  Paperclip,
  Image as ImageIcon,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import { useChatStore } from "../../stores/use-chat-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { MessageBubble } from "./MessageBubble";
import { ToolIconList } from "./ToolIconList";
import { InputBar } from "./InputBar";

const EMPTY_MSGS: never[] = [];

export function ChatPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const messages = useChatStore((s) => {
    if (!activeSessionId) return EMPTY_MSGS;
    return s.messagesBySession[activeSessionId] || EMPTY_MSGS;
  });
  const inputText = useChatStore((s) => s.inputText);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setInputText = useChatStore((s) => s.setInputText);
  const messagesEndRef = useRef<HTMLDivElement>(null!);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!inputText.trim() || isStreaming) return;
    setIsStreaming(true);
    await sendMessage();
    setIsStreaming(false);
  };

  const totalTokens = messages.reduce(
    (acc, m) => acc + (m.tokenUsage?.input ?? 0) + (m.tokenUsage?.output ?? 0),
    0
  );
  const inputTokens = messages.reduce(
    (acc, m) => acc + (m.tokenUsage?.input ?? 0),
    0
  );
  const outputTokens = messages.reduce(
    (acc, m) => acc + (m.tokenUsage?.output ?? 0),
    0
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative bg-gray-950">
      {/* Top token bar */}
      <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-900/80 border-b border-gray-800 text-[11px] text-gray-500 flex-shrink-0">
        <SessionToggleIcon />
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500/60" />
          <span>已用</span>
          <span className="text-gray-400 font-medium">{(totalTokens / 1000).toFixed(0)}K</span>
        </div>
        <span className="text-gray-700">/</span>
        <span>可用 200K</span>
        <div className="ml-auto flex items-center gap-3">
          <span>输入 {(inputTokens / 1000).toFixed(0)}K</span>
          <span>输出 {outputTokens}</span>
          <span>费用 $0.00</span>
        </div>
        <StatusToggleIcon />
      </div>

      {/* Main area: messages | tool icons (narrow right bar) */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0">
          <MessagesArea messages={messages} isStreaming={isStreaming} messagesEndRef={messagesEndRef} />
        </div>
        <div className="w-9 shrink-0 bg-gray-900/30 border-l border-gray-800/30 flex flex-col items-center py-1.5 gap-0.5">
          <ToolIconList />
        </div>
      </div>

      {/* Input bar — full width at bottom */}
      <div className="px-3 pb-3 pt-2 flex-shrink-0 flex items-end gap-1.5 bg-gray-900 border-t border-gray-800">
        {/* Left: attachment + image buttons (vertical) */}
        <div className="flex flex-col gap-1 shrink-0">
          <button className="p-1.5 rounded-md hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors" title="附件">
            <Paperclip className="w-4 h-4" />
          </button>
          <button className="p-1.5 rounded-md hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors" title="图片">
            <ImageIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Center: input */}
        <InputBar value={inputText} onChange={setInputText} onSend={handleSend} />

        {/* Right: send/stop button (vertical) */}
        {isStreaming ? (
          <button onClick={() => setIsStreaming(false)} className="p-2.5 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors shrink-0 self-end" title="停止">
            <Square className="w-4 h-4 fill-current" />
          </button>
        ) : (
          <button onClick={handleSend} disabled={!inputText.trim()} className={`p-2.5 rounded-lg transition-colors shrink-0 self-end ${inputText.trim() ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-500/20" : "bg-gray-800 text-gray-600 cursor-not-allowed"}`} title="发送">
            <ArrowUp className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function MessagesArea({ messages, isStreaming, messagesEndRef }: {
  messages: import("../../types").ChatMessage[];
  isStreaming: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="h-full overflow-y-auto px-4 py-3 space-y-2">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-600 text-sm">开始对话...</div>
      ) : (
        messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
      )}
      {isStreaming && (
        <div className="flex items-start gap-2 px-1">
          <div className="w-6 h-6 rounded bg-green-600/20 border border-green-500/30 flex items-center justify-center shrink-0 mt-0.5">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-green-400">助手</span>
              <LoaderDots />
            </div>
            <div className="text-sm text-gray-300 animate-pulse">正在生成...</div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef as React.Ref<HTMLDivElement>} />
    </div>
  );
}

function LoaderDots() {
  return (
    <span className="inline-flex gap-0.5 ml-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-1 h-1 rounded-full bg-green-400/60 animate-bounce"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: "600ms" }} />
      ))}
    </span>
  );
}

function SessionToggleIcon() {
  const sessionPanel = useLayoutStore((s) => s.sessionPanel);
  const showSession = useLayoutStore((s) => s.showSession);
  const hideSession = useLayoutStore((s) => s.hideSession);

  if (sessionPanel === "pinned") return null;
  const isHidden = sessionPanel === "hidden";

  return (
    <button onClick={(e) => {
      e.stopPropagation();
      if (isHidden) { showSession(); } else { hideSession(); }
    }}
      className={`p-1 rounded transition-colors ${isHidden ? "text-gray-600 hover:text-gray-300" : "text-indigo-400/60 hover:text-indigo-300"}`}
      title={isHidden ? "打开会话面板" : "关闭会话面板"}
    >
      <PanelLeft className="w-3.5 h-3.5" />
    </button>
  );
}

function StatusToggleIcon() {
  const statusPanel = useLayoutStore((s) => s.statusPanel);
  const showStatus = useLayoutStore((s) => s.showStatus);
  const hideStatus = useLayoutStore((s) => s.hideStatus);

  if (statusPanel === "pinned") return null;
  const isHidden = statusPanel === "hidden";

  return (
    <button onClick={(e) => {
      e.stopPropagation();
      if (isHidden) { showStatus(); } else { hideStatus(); }
    }}
      className={`p-1 rounded transition-colors ${isHidden ? "text-gray-600 hover:text-gray-300" : "text-indigo-400/60 hover:text-indigo-300"}`}
      title={isHidden ? "打开状态面板" : "关闭状态面板"}
    >
      <PanelRight className="w-3.5 h-3.5" />
    </button>
  );
}

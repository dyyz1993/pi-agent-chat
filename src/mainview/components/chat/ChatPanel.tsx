import { useCallback, useMemo, useRef } from "react";
import {
  ArrowUp,
  Paperclip,
  Image as ImageIcon,
  PanelLeft,
  PanelRight,
  Bot,
  ArrowLeft,
  Square,
} from "lucide-react";
import { useChatStore } from "../../stores/use-chat-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { apiClient } from "../../lib/api-client";
import { useActiveScrollTracker } from "../../hooks/use-active-scroll-tracker";
import { MessageBubble } from "./MessageBubble";
import { SideNav } from "./SideNav";
import { InputBar, type InputBarHandle } from "./InputBar";
import { TokenStatusBar } from "./TokenStatusBar";
import type { ChatMessage } from "../../types";

const EMPTY_MSGS: never[] = [];

export function ChatPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionStatus = useSessionStore((s) => activeSessionId ? (s.sessionStatusMap[activeSessionId] ?? "idle") : "idle");
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const subMessages = useSubagentStore((s) => {
    if (!activeSubId) return EMPTY_MSGS;
    return s.messagesBySubsession[activeSubId] || EMPTY_MSGS;
  });
  const mainMessages = useChatStore((s) => {
    if (!activeSessionId) return EMPTY_MSGS;
    return s.messagesBySession[activeSessionId] || EMPTY_MSGS;
  });

  const isViewingSubagent = !!activeSubId;
  const messages: ChatMessage[] = isViewingSubagent ? subMessages : mainMessages;

  const inputText = useChatStore((s) => s.inputText);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setInputText = useChatStore((s) => s.setInputText);
  const setActive = useChatNavStore((s) => s.setActive);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const navScrollRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<InputBarHandle>(null);

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const isStreaming = sessionStatus === "streaming" || sessionStatus === "compacting";

  const streamVersion = useMemo(() => {
    let v = 0;
    for (const m of messages) {
      v += m.content.length;
      if (m.isStreaming) {
        const last = m.content[m.content.length - 1];
        if (last?.type === "text") v += (last as { text: string }).text.length;
        if (last?.type === "toolExecution") v += ((last as { output?: string }).output?.length ?? 0);
      }
    }
    return v;
  }, [messages]);

  const handleAbort = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await apiClient.call("agent.stop", { sessionId: activeSessionId });
    } catch { /* ignore */ }
  }, [activeSessionId]);

  const { handleScroll, scrollToMessage } = useActiveScrollTracker({
    scrollRef: messagesScrollRef,
    navScrollRef,
    messageIds,
    setActive,
    streamVersion,
  });

  const handleNavDotClick = useCallback(
    (msgId: string) => {
      scrollToMessage(msgId);
    },
    [scrollToMessage],
  );

  const handleSubDotScroll = useCallback(
    (msgId: string) => {
      scrollToMessage(msgId);
    },
    [scrollToMessage],
  );

  const handleSend = async () => {
    if (!inputText.trim()) return;
    await sendMessage();
  };

  const handleBackToMain = () => {
    if (activeSessionId) {
      useSubagentStore.getState().setActiveSubsession(activeSessionId, null);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative bg-gray-950">
      <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-900/80 border-b border-gray-800 text-[11px] text-gray-500 flex-shrink-0">
        <SessionToggleIcon />
        {isViewingSubagent && (
          <button
            onClick={handleBackToMain}
            className="flex items-center gap-1 text-purple-400 hover:text-purple-300 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            <Bot className="w-3 h-3" />
            <span>返回主会话</span>
          </button>
        )}
        {activeSessionId && <TokenStatusBar sessionId={activeSessionId} />}
        <div className="ml-auto flex items-center">
          <StatusToggleIcon />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0">
          {isViewingSubagent ? (
            <SubagentMessagesArea messages={messages} scrollRef={messagesScrollRef} onScroll={handleScroll} />
          ) : (
            <MessagesArea
              messages={messages}
              scrollRef={messagesScrollRef}
              onScroll={handleScroll}
            />
          )}
        </div>
        <div className="w-12 shrink-0">
          <SideNav
            messages={messages}
            scrollRef={navScrollRef}
            onNavDotClick={handleNavDotClick}
            onNavDotScroll={handleSubDotScroll}
          />
        </div>
      </div>

      <div className="px-3 pb-3 pt-2 flex-shrink-0 flex items-end gap-1.5 bg-gray-900 border-t border-gray-800">
        {!isViewingSubagent && (
          <>
            <div className="flex flex-col gap-1 shrink-0 justify-between py-1">
              <button className="p-1.5 rounded-md hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors" title="附件">
                <Paperclip className="w-4 h-4" />
              </button>
              <button className="p-1.5 rounded-md hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors" title="图片">
                <ImageIcon className="w-4 h-4" />
              </button>
            </div>

            <InputBar ref={inputBarRef} value={inputText} onChange={setInputText} onSend={handleSend} sessionId={activeSessionId ?? ""} />

            <div className="flex flex-col gap-1 shrink-0 justify-between py-1">
              <button onClick={handleAbort} disabled={!isStreaming} className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${isStreaming ? "bg-red-600 text-white hover:bg-red-700" : "bg-red-900/30 text-red-500/50 cursor-not-allowed"}`} title="暂停">
                <Square className="w-4 h-4" />
              </button>
              <button onClick={() => inputBarRef.current?.send()} disabled={!inputText.trim()} className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${inputText.trim() ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-500/20" : "bg-gray-800 text-gray-600 cursor-not-allowed"}`} title="发送">
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
        {isViewingSubagent && (
          <div className="flex-1 text-center text-[11px] text-gray-600 py-2">
            子代理会话为只读模式
          </div>
        )}
      </div>
    </div>
  );
}

function SubagentMessagesArea({ messages, scrollRef, onScroll }: {
  messages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  return (
    <div
      ref={scrollRef as React.Ref<HTMLDivElement>}
      className="h-full overflow-y-auto px-4 py-3 space-y-2"
      onScroll={onScroll}
    >
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm gap-2">
          <Bot className="w-6 h-6 text-purple-500/50" />
          <span>等待子代理响应...</span>
        </div>
      ) : (
        messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
      )}
    </div>
  );
}

function MessagesArea({ messages, scrollRef, onScroll }: {
  messages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  return (
    <div
      ref={scrollRef as React.Ref<HTMLDivElement>}
      className="h-full overflow-y-auto px-4 py-3 space-y-2"
      onScroll={onScroll}
    >
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-600 text-sm">开始对话...</div>
      ) : (
        messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
      )}
    </div>
  );
}

function SessionToggleIcon() {
  const sessionPanel = useLayoutStore((s) => s.sessionPanel);
  const showSession = useLayoutStore((s) => s.showSession);
  const hideSession = useLayoutStore((s) => s.hideSession);

  const isPinned = sessionPanel === "pinned";
  const isVisible = sessionPanel === "visible";

  return (
    <button onClick={(e) => {
      e.stopPropagation();
      if (isVisible) { hideSession(); } else { showSession(); }
    }}
      className={`p-1 rounded transition-colors ${isPinned ? "max-sm:block sm:hidden" : ""} ${isVisible ? "text-indigo-400 hover:text-indigo-300" : "text-gray-600 hover:text-gray-300"}`}
      title={isVisible ? "关闭会话面板" : "打开会话面板"}
    >
      <PanelLeft className="w-3.5 h-3.5" />
    </button>
  );
}

function StatusToggleIcon() {
  const statusPanel = useLayoutStore((s) => s.statusPanel);
  const showStatus = useLayoutStore((s) => s.showStatus);
  const hideStatus = useLayoutStore((s) => s.hideStatus);

  const isPinned = statusPanel === "pinned";
  const isVisible = statusPanel === "visible";

  return (
    <button onClick={(e) => {
      e.stopPropagation();
      if (isVisible) { hideStatus(); } else { showStatus(); }
    }}
      className={`p-1 rounded transition-colors ${isPinned ? "max-sm:block sm:hidden" : ""} ${isVisible ? "text-indigo-400 hover:text-indigo-300" : "text-gray-600 hover:text-gray-300"}`}
      title={isVisible ? "关闭状态面板" : "打开状态面板"}
    >
      <PanelRight className="w-3.5 h-3.5" />
    </button>
  );
}

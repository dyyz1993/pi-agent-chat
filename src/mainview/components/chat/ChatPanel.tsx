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
  Loader2,
} from "lucide-react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
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

function estimateMessageSize(msg: ChatMessage): number {
  if (msg.role === "user") return 60;
  let h = 48;
  for (const block of msg.content) {
    switch (block.type) {
      case "text": h += Math.min(200, Math.max(40, (block.text.length / 80) * 22)); break;
      case "thinking": h += 80; break;
      case "toolExecution": h += block.status === "running" ? 180 : 120; break;
      default: h += 60;
    }
  }
  return h;
}

export function ChatPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const parentStatus = useSessionStore((s) => activeSessionId ? (s.sessionStatusMap[activeSessionId] ?? "idle") : "idle");
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const subStatus = useSubagentStore((s) => activeSubId ? (s.subagentStatusMap[activeSubId] ?? "idle") : "idle");
  const subMessages = useSubagentStore((s) => {
    if (!activeSubId) return EMPTY_MSGS;
    return s.messagesBySubsession[activeSubId] || EMPTY_MSGS;
  });
  const mainMessages = useChatStore((s) => {
    if (!activeSessionId) return EMPTY_MSGS;
    return s.messagesBySession[activeSessionId] || EMPTY_MSGS;
  });
  const isLoading = useChatStore((s) => activeSessionId ? s.loadingSessions.has(activeSessionId) : false);
  const historyLoadVersion = useChatStore((s) => s.historyLoadVersion);

  const isViewingSubagent = !!activeSubId;
  const messages: ChatMessage[] = isViewingSubagent ? subMessages : mainMessages;

  const effectiveStatus = isViewingSubagent ? subStatus : parentStatus;

  const inputText = useChatStore((s) => s.inputText);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setInputText = useChatStore((s) => s.setInputText);
  const setActive = useChatNavStore((s) => s.setActive);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<InputBarHandle>(null);

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const isStreaming = effectiveStatus === "streaming" || effectiveStatus === "compacting";

  const streamVersion = useChatStore((s) => s.streamContentVersion);

  const mainVirtualizer = useVirtualizer({
    count: mainMessages.length,
    getScrollElement: () => messagesScrollRef.current,
    estimateSize: (index) => estimateMessageSize(mainMessages[index]),
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const subVirtualizer = useVirtualizer({
    count: subMessages.length,
    getScrollElement: () => messagesScrollRef.current,
    estimateSize: (index) => estimateMessageSize(subMessages[index]),
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const activeVirtualizer = isViewingSubagent ? subVirtualizer : mainVirtualizer;

  const handleAbort = useCallback(async () => {
    if (!activeSessionId) return;
    if (activeSubId) return;
    try {
      await apiClient.call("agent.stop", { sessionId: activeSessionId });
    } catch { /* ignore */ }
  }, [activeSessionId, activeSubId]);

  const { handleScroll, scrollToMessage } = useActiveScrollTracker({
    scrollRef: messagesScrollRef,
    virtualizer: activeVirtualizer,
    messageIds,
    sessionId: isViewingSubagent ? activeSubId : activeSessionId ?? undefined,
    setActive,
    streamVersion,
    historyLoadVersion,
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
            <SubagentMessagesArea messages={messages} scrollRef={messagesScrollRef} onScroll={handleScroll} virtualizer={subVirtualizer} />
          ) : (
            <MessagesArea
              messages={messages}
              scrollRef={messagesScrollRef}
              onScroll={handleScroll}
              virtualizer={mainVirtualizer}
              isLoading={isLoading}
            />
          )}
        </div>
        <div className="w-12 shrink-0">
          <SideNav
            messages={messages}
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

function SubagentMessagesArea({ messages, scrollRef, onScroll, virtualizer }: {
  messages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
}) {
  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef as React.Ref<HTMLDivElement>}
        className="h-full overflow-y-auto px-4 py-3"
        onScroll={onScroll}
      >
        <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm gap-2">
          <Bot className="w-6 h-6 text-purple-500/50" />
          <span>等待子代理响应...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef as React.Ref<HTMLDivElement>}
      className="h-full overflow-y-auto px-4 py-3"
      onScroll={onScroll}
    >
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((vr) => {
          const msg = messages[vr.index];
          return (
            <div
              key={msg.id}
              data-index={vr.index}
              data-msg-id={msg.id}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vr.start}px)` }}
            >
              <div className="py-1">
                <MessageBubble message={msg} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MessagesArea({ messages, scrollRef, onScroll, virtualizer, isLoading }: {
  messages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  isLoading?: boolean;
}) {
  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef as React.Ref<HTMLDivElement>}
        className="h-full overflow-y-auto px-4 py-3"
        onScroll={onScroll}
      >
        <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm gap-3">
          {isLoading && <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />}
          <span>{isLoading ? "加载历史消息..." : "开始对话..."}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef as React.Ref<HTMLDivElement>}
      className="h-full overflow-y-auto px-4 py-3"
      onScroll={onScroll}
    >
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((vr) => {
          const msg = messages[vr.index];
          return (
            <div
              key={msg.id}
              data-index={vr.index}
              data-msg-id={msg.id}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vr.start}px)` }}
            >
              <div className="py-1">
                <MessageBubble message={msg} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionToggleIcon() {
  const sessionPanel = useLayoutStore((s) => s.sessionPanel);
  const showSession = useLayoutStore((s) => s.showSession);
  const hideSession = useLayoutStore((s) => s.hideSession);
  const isMobile = useLayoutStore((s) => s.breakpoint) === "mobile";

  if (sessionPanel === "pinned" && !isMobile) return null;

  const isVisible = sessionPanel === "visible";

  return (
    <button onClick={(e) => {
      e.stopPropagation();
      if (isVisible) { hideSession(); } else { showSession(); }
    }}
      className={`p-1 rounded transition-colors ${isVisible ? "text-indigo-400 hover:text-indigo-300" : "text-gray-600 hover:text-gray-300"}`}
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
  const isMobile = useLayoutStore((s) => s.breakpoint) === "mobile";

  if (statusPanel === "pinned" && !isMobile) return null;

  const isVisible = statusPanel === "visible";

  return (
    <button onClick={(e) => {
      e.stopPropagation();
      if (isVisible) { hideStatus(); } else { showStatus(); }
    }}
      className={`p-1 rounded transition-colors ${isVisible ? "text-indigo-400 hover:text-indigo-300" : "text-gray-600 hover:text-gray-300"}`}
      title={isVisible ? "关闭状态面板" : "打开状态面板"}
    >
      <PanelRight className="w-3.5 h-3.5" />
    </button>
  );
}

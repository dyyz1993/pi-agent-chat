import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useVirtualizer } from "@tanstack/react-virtual";
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
  const hasMore = useChatStore((s) => activeSessionId ? (s.hasMoreBySession[activeSessionId] ?? false) : false);
  const loadingMore = useChatStore((s) => activeSessionId ? (s.loadingMoreBySession[activeSessionId] ?? false) : false);

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

  const streamVersion = useChatStore((s) => s.streamContentVersion);

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
              hasMore={hasMore}
              loadingMore={loadingMore}
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
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateMessageSize(messages[index]),
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const prevCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }
    prevCountRef.current = messages.length;
  }, [messages.length, virtualizer]);

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

function MessagesArea({ messages, scrollRef, onScroll, hasMore, loadingMore }: {
  messages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  hasMore: boolean;
  loadingMore: boolean;
}) {
  const prevHeightRef = useRef(0);
  const [loadingTriggered, setLoadingTriggered] = useState(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateMessageSize(messages[index]),
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const prevCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevCountRef.current && prevCountRef.current > 0 && !loadingTriggered) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }
    if (loadingTriggered) setLoadingTriggered(false);
    prevCountRef.current = messages.length;
  }, [messages.length, virtualizer, loadingTriggered]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || prevHeightRef.current === 0) return;
    const diff = el.scrollHeight - prevHeightRef.current;
    if (diff > 0) {
      el.scrollTop = el.scrollTop + diff;
      prevHeightRef.current = 0;
    }
  }, [messages, scrollRef]);

  const handleScrollCapture = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollTop < 40) {
      prevHeightRef.current = el.scrollHeight;
      setLoadingTriggered(true);
      const session = useSessionStore.getState();
      const tab = session.projectTabs.find((t) => t.id === session.activeProjectId);
      if (tab) {
        const sessions = session.sessionsByProject[tab.path];
        const activeSessionId = session.activeSessionId;
        const meta = sessions?.find((s) => s.sessionId === activeSessionId);
        if (meta) {
          useChatStore.getState().loadMoreMessages(meta.sessionPath);
        }
      }
    }
  }, [hasMore, loadingMore, scrollRef]);

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef as React.Ref<HTMLDivElement>}
        className="h-full overflow-y-auto px-4 py-3"
        onScroll={onScroll}
      >
        <div className="flex items-center justify-center h-full text-gray-600 text-sm">开始对话...</div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef as React.Ref<HTMLDivElement>}
      className="h-full overflow-y-auto px-4 py-3"
      onScroll={() => { handleScrollCapture(); onScroll(); }}
    >
      {hasMore && (
        <div className="flex justify-center py-2 text-gray-500 text-xs">
          {loadingMore ? "加载中..." : "向上滚动加载更多"}
        </div>
      )}
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((vr) => {
          const msg = messages[vr.index];
          return (
            <div
              key={msg.id}
              data-index={vr.index}
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

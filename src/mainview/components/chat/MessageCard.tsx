import { memo, useCallback } from "react";
import {
  ChevronDown,
  User,
  Bot,
  Terminal,
  ScanSearch,
  Brain,
  FileText,
  RotateCcw,
  Undo2,
  GitBranch,
} from "lucide-react";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";
import { apiClient } from "../../lib/api-client";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "../../types";
import { formatTokenCount } from "../../utils/turn-utils";

interface MessageCardProps {
  message: ChatMessage & { cardLabel?: string; cardIcon?: string };
  prevBarColor?: string;
}

const ROLE_CONFIG = {
  user: { icon: User, color: "text-blue-400/80", barColor: "border-l-blue-500/60", bgColor: "bg-blue-500/[0.03]", altBarColor: "border-l-blue-400/45", altBgColor: "bg-blue-400/[0.02]" },
  assistant: { icon: Bot, color: "text-emerald-400/70", barColor: "border-l-emerald-500/50", bgColor: "bg-emerald-500/[0.03]", altBarColor: "border-l-emerald-400/35", altBgColor: "bg-emerald-400/[0.02]" },
};

const ENTRY_DEFAULT = { barColor: "border-l-yellow-500/50", labelColor: "text-yellow-400/70", bgColor: "bg-yellow-500/[0.04]", altBarColor: "border-l-yellow-400/35", altBgColor: "bg-yellow-400/[0.02]" };

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export const MessageCard = memo(function MessageCard({ message, prevBarColor }: MessageCardProps) {
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const toggleCollapse = useTurnStore((s) => s.toggleCollapse);
  const toggleMessageSelection = useTurnStore((s) => s.toggleMessageSelection);

  const isCollapsed = useTurnStore(
    useCallback((s) => sessionId ? (s.collapsedMessageIdsBySession[sessionId] ?? EMPTY_SET).has(message.id) : false, [sessionId, message.id])
  );
  const isSelected = useTurnStore(
    useCallback((s) => sessionId ? (s.selectedMessageIdsBySession[sessionId] ?? EMPTY_SET).has(message.id) : false, [sessionId, message.id])
  );

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasCustomContent = message.content.some((b) => b.type === "custom");
  const customBlock = message.content.find((b): b is Extract<typeof b, { type: "custom" }> => b.type === "custom");

  const label = message.cardLabel || (isUser ? "你" : "助手");
  let IconComp;
  let labelColor: string;
  let barColor: string;
  let bgColor: string;
  const isEntry = hasCustomContent && customBlock;

  if (isEntry) {
    barColor = ENTRY_DEFAULT.barColor;
    labelColor = ENTRY_DEFAULT.labelColor;
    bgColor = ENTRY_DEFAULT.bgColor;
    if (prevBarColor === ENTRY_DEFAULT.barColor) { barColor = ENTRY_DEFAULT.altBarColor; bgColor = ENTRY_DEFAULT.altBgColor; }
    switch (customBlock.customType) {
      case "bash_background_exit": IconComp = Terminal; break;
      case "lsp_diagnostics": IconComp = ScanSearch; break;
      case "memory_prefetch":
      case "memory_extract":
      case "memory_dream": IconComp = Brain; break;
      default: IconComp = FileText;
    }
  } else {
    const roleCfg = (message.role in ROLE_CONFIG ? ROLE_CONFIG[message.role as keyof typeof ROLE_CONFIG] : ROLE_CONFIG.assistant) ?? ROLE_CONFIG.assistant;
    IconComp = roleCfg.icon;
    labelColor = roleCfg.color;
    barColor = roleCfg.barColor;
    bgColor = roleCfg.bgColor;
  }

  const handleToggleCollapse = useCallback(() => {
    toggleCollapse(message.id);
  }, [message.id, toggleCollapse]);

  const timeStr = formatTime(message.timestamp);

  return (
    <div
      data-msg-card-id={message.id}
      className={`group/msgcard relative w-full py-1.5 border-l-[3px] ${isSelected ? "border-l-red-500 bg-red-500/[0.06]" : barColor + " " + bgColor} transition-colors overflow-hidden`}
    >
      {isSelected && (
        <div className="absolute inset-0 bg-red-500/15 pointer-events-none z-10 rounded-sm" />
      )}
      {/* Header: checkbox + label + timestamp */}
      <div className="relative z-20 flex items-center gap-2 px-3 pl-2 h-5 select-none">
        {!isEntry && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleMessageSelection(message.id)}
            onClick={(e) => e.stopPropagation()}
            className="w-3.5 h-3.5 rounded border border-gray-600 accent-emerald-500 shrink-0 cursor-pointer"
          />
        )}

        <span className={`flex items-center gap-1 text-[11px] font-medium ${labelColor}`}>
          <IconComp className="w-3 h-3" />
          {label}
        </span>

        {!isUser && !isEntry && (message.provider || message.model) && (
          <span className="text-[10px] text-gray-600 opacity-0 group-hover/msgcard:opacity-100 transition-opacity">
            {message.provider}{message.model ? ` · ${message.model}` : ""}
          </span>
        )}

        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          {isAssistant && !isEntry && !isCollapsed && (
            <HeaderActions message={message} />
          )}
          {(isAssistant || isEntry) && (
            <button
              onClick={(e) => { e.stopPropagation(); handleToggleCollapse(); }}
              className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors"
              title={isCollapsed ? "展开" : "折叠"}
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "-rotate-90"}`} />
            </button>
          )}
          <span className="text-[10px] text-gray-600">{timeStr}</span>
        </div>
      </div>

      {/* Content */}
      {isCollapsed ? (
        <div className="relative z-20 px-4 py-1 text-xs text-gray-500 italic leading-relaxed">
          {message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join(" ")
            .slice(0, 120) || "(空)"}
        </div>
      ) : (
        <div className="relative z-20">
        <MessageBubble message={message} />
        </div>
      )}

      {/* Footer — only for assistant messages (not entry) with actions/token */}
      {isAssistant && !isEntry && !isCollapsed && (
        <div className="relative z-20 mt-0.5">
          {message.tokenUsage && (
            <div className="flex items-center justify-end px-4 pb-0.5">
              <span className="flex items-center gap-1 text-[10px] font-mono text-gray-600">
                <span>输入 {formatTokenCount(message.tokenUsage.input)}</span>
                <span className="text-gray-800">→</span>
                <span>输出 {formatTokenCount(message.tokenUsage.output)}</span>
                <span className="text-gray-800">·</span>
                <span>{formatTokenCount(message.tokenUsage.input + message.tokenUsage.output)}</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const HeaderActions = memo(function HeaderActions({ message }: { message: ChatMessage }) {
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const messages = useChatStore((s) => sessionId ? (s.messagesBySession[sessionId] || []) : []);

  const resolveEntryId = useCallback(async (): Promise<{ entryId: string; parentId: string | null } | null> => {
    if (!sessionId) return null;
    try {
      const tree = await apiClient.call("agent.getTree", { sessionId }) as Record<string, unknown>;
      const rawEntries = Array.isArray(tree) ? tree : ((tree as Record<string, unknown>)?.entries as unknown[] || []);
      const allAssistantMsgs = messages.filter(m => m.role === "assistant");
      const assistantMsgIdx = allAssistantMsgs.findIndex(m => m.id === message.id);
      const assistantTreeEntries = rawEntries.filter((e: Record<string, unknown>) => (e as { type: string }).type === "message" && (e as { label: string }).label === "assistant");
      if (assistantMsgIdx !== -1 && assistantMsgIdx < assistantTreeEntries.length) {
        const e = assistantTreeEntries[assistantMsgIdx];
        return { entryId: e.id, parentId: e.parentId };
      }
      const last = rawEntries[rawEntries.length - 1];
      return last ? { entryId: last.id, parentId: last.parentId } : null;
    } catch { return null; }
  }, [sessionId, message.id, messages]);

  const handleFork = useCallback(async () => {
    const resolved = await resolveEntryId();
    if (!sessionId || !resolved?.parentId) return;
    apiClient.call("agent.fork", { sessionId, entryId: resolved.parentId }).catch(() => {});
  }, [sessionId, resolveEntryId]);

  const handleRollbackMessage = useCallback(async () => {
    const resolved = await resolveEntryId();
    if (!sessionId || !resolved?.parentId) return;
    await apiClient.call("agent.navigateTree", { sessionId, targetId: resolved.parentId, summarize: false }).catch(() => {});
    useChatStore.getState().loadSessionMessages(sessionId, { force: true });
  }, [sessionId, resolveEntryId]);

  const handleRollbackAll = useCallback(async () => {
    const resolved = await resolveEntryId();
    if (!sessionId || !resolved?.parentId) return;
    await apiClient.call("agent.navigateTree", { sessionId, targetId: resolved.parentId, summarize: false }).catch(() => {});
    useChatStore.getState().loadSessionMessages(sessionId, { force: true });
  }, [sessionId, resolveEntryId]);

  return (
    <>
      <ActionBtn icon={GitBranch} title="Fork" onClick={handleFork} />
      <ActionBtn icon={RotateCcw} title="回滚消息" onClick={handleRollbackMessage} />
      <ActionBtn icon={Undo2} title="回滚全部" onClick={handleRollbackAll} />
    </>
  );
});

const ActionBtn = memo(function ActionBtn({
  icon: Icon,
  title,
  onClick,
  active,
  activeClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
  onClick?: () => void;
  active?: boolean;
  activeClassName?: string;
}) {
  if (!onClick) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`p-1 rounded transition-colors ${active ? activeClassName : "text-gray-600 hover:text-gray-300 hover:bg-gray-700/50"}`}
    >
      <Icon className={`w-3.5 h-3.5 ${active ? "fill-current" : ""}`} />
    </button>
  );
});

import { MessageSquare, Clock, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Conversation } from "./mock-data";
import { conversations as mockConversations } from "./mock-data";

interface MessageListProps {
  conversations?: Conversation[];
  activeId?: string;
  onSelect?: (id: string) => void;
}

export function MessageList({
  conversations = mockConversations,
  activeId,
  onSelect,
}: MessageListProps) {
  const { t } = useTranslation("chat");
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-secondary flex items-center justify-between shrink-0">
        <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-semantic-accent" />
          {t("sessionList")}
        </span>
        <button className="p-1 rounded hover:bg-surface-dim text-text-tertiary">
          <Settings2 className="w-3 h-3" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === activeId}
            onClick={() => onSelect?.(conv.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ConversationItem({
  conversation: conv,
  isActive,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  const { t, i18n } = useTranslation("chat");
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 border-b border-border-secondary/30 transition-colors group ${
        isActive ? "bg-semantic-accent/10" : "hover:bg-surface-dim/30"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div
            className={`text-[11px] font-medium truncate ${isActive ? "text-semantic-accent" : "text-text-secondary"}`}
          >
            {conv.title || t("newSession")}
          </div>
          <div className="text-[10px] text-text-secondary mt-0.5 flex items-center gap-1 truncate">
            <Clock className="w-2.5 h-2.5 shrink-0" />
            {new Date(conv.updatedAt).toLocaleString(i18n.language)}
          </div>
        </div>
        {conv.status && (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
              conv.status === "running"
                ? "bg-status-success/20 text-status-success animate-pulse"
                : conv.status === "error"
                  ? "bg-status-error/20 text-status-error"
                  : "bg-surface-hover text-text-tertiary"
            }`}
          >
            {conv.status}
          </span>
        )}
      </div>
    </button>
  );
}

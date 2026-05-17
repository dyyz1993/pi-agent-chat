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
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between shrink-0">
        <span className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-semantic-accent" />
          {t("sessionList")}
        </span>
        <button className="p-1 rounded hover:bg-gray-800 text-gray-500">
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
      className={`w-full text-left px-3 py-2 border-b border-gray-800/30 transition-colors group ${
        isActive ? "bg-indigo-600/10" : "hover:bg-gray-800/30"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div
            className={`text-[11px] font-medium truncate ${isActive ? "text-indigo-300" : "text-gray-300"}`}
          >
            {conv.title || t("newSession")}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5 flex items-center gap-1 truncate">
            <Clock className="w-2.5 h-2.5 shrink-0" />
            {new Date(conv.updatedAt).toLocaleString(i18n.language)}
          </div>
        </div>
        {conv.status && (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
              conv.status === "running"
                ? "bg-green-600/20 text-green-400 animate-pulse"
                : conv.status === "error"
                  ? "bg-red-600/20 text-red-400"
                  : "bg-gray-700 text-gray-500"
            }`}
          >
            {conv.status}
          </span>
        )}
      </div>
    </button>
  );
}

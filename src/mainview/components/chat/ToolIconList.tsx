import { useMemo } from "react";
import type { ChatMessage } from "../../types";
import { getToolIcon, getRoleIcon } from "./tool-icon-map";

export function getMessageIcon(message: ChatMessage) {
  if (message.role === "user") return getRoleIcon("user");

  const toolBlock = message.content.find(
    (b) => b.type === "toolCall" || b.type === "toolExecution" || b.type === "toolResult"
  );
  if (toolBlock) {
    const name =
      toolBlock.type === "toolCall"
        ? toolBlock.name
        : "toolName" in toolBlock
          ? toolBlock.toolName
          : "tool";
    return getToolIcon(name);
  }

  if (message.role === "toolResult") return getRoleIcon("toolResult");
  return getRoleIcon("assistant");
}

export function ToolIconList({
  messages,
  scrollRef,
  onScrollSync,
}: {
  messages: ChatMessage[];
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScrollSync?: () => void;
}) {
  const icons = useMemo(() => messages.map((m) => ({ id: m.id, ...getMessageIcon(m) })), [messages]);

  return (
    <div
      ref={scrollRef as React.Ref<HTMLDivElement>}
      className="h-full overflow-y-auto"
      onScroll={onScrollSync}
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      <div className="flex flex-col items-center py-3 space-y-2">
        {icons.map(({ id, icon: Icon, color, label }) => (
          <button
            key={id}
            className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${color} hover:bg-gray-800/80`}
            title={label}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

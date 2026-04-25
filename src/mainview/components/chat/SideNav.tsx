import { useMemo, useCallback, useState, memo } from "react";
import {
  User,
  Bot,
  FileText,
  type LucideIcon,
} from "lucide-react";
import type { ChatMessage } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { getToolIcon } from "./tool-icon-map";



type SubItem = {
  kind: "text" | "tool";
  icon: LucideIcon;
  color: string;
  label: string;
  toolName?: string;
};

type NavItem = {
  id: string;
  role: "user" | "assistant";
  icon: LucideIcon;
  color: string;
  label: string;
  subs: SubItem[];
};

function buildNavItems(messages: ChatMessage[]): NavItem[] {
  return messages.map((msg) => {
    if (msg.role === "user") {
      return {
        id: msg.id,
        role: "user",
        icon: User,
        color: "text-indigo-400",
        label: "用户",
        subs: [],
      };
    }

    const subs: SubItem[] = [];
    const hasText = msg.content.some((b) => b.type === "text");
    const toolNames: string[] = [];

    for (const b of msg.content) {
      if (b.type === "toolCall") toolNames.push(b.name);
      else if (b.type === "toolExecution") toolNames.push(b.toolName);
      else if (b.type === "toolResult") toolNames.push(b.toolName);
    }

    const uniqueTools = [...new Set(toolNames)];

    if (hasText && uniqueTools.length > 0) {
      subs.push({ kind: "text", icon: FileText, color: "text-gray-400", label: "文本" });
    }

    for (const name of uniqueTools) {
      const ti = getToolIcon(name);
      subs.push({ kind: "tool", icon: ti.icon, color: ti.color, label: ti.label, toolName: name });
    }

    const hasError = msg.content.some(
      (b) => (b.type === "toolResult" && b.isError) || (b.type === "toolExecution" && b.status === "error")
    );

    return {
      id: msg.id,
      role: "assistant",
      icon: Bot,
      color: hasError ? "text-red-400" : "text-green-400",
      label: hasError ? "出错" : "助手",
      subs,
    };
  });
}

const NavDot = memo(function NavDot({
  id: _id,
  Icon,
  color,
  isActive,
  isSelected,
  onClick,
  onContextMenu,
  onDoubleClick,
}: {
  id: string;
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  isActive: boolean;
  isSelected: boolean;
  onClick?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  const base = "relative w-10 h-8 rounded-r flex items-center justify-center transition-all cursor-pointer";

  let stateClass = "";
  let iconColor = color;
  let barClass = "absolute left-0 top-1 bottom-1 w-[3px] rounded-full transition-all opacity-0";

  if (isSelected) {
    stateClass = "bg-red-500/20";
    iconColor = "text-red-400";
    barClass += " bg-red-500 opacity-100";
  } else if (isActive) {
    stateClass = "bg-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.25)]";
    iconColor = "text-blue-300";
    barClass += " bg-blue-400 opacity-100";
  } else {
    stateClass = "hover:bg-gray-800/60";
  }

  return (
    <button
      className={`${base} ${stateClass}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      <span className={barClass} />
      <Icon className={`w-4 h-4 ${iconColor} transition-colors`} />
    </button>
  );
});

const NavSubDot = memo(function NavSubDot({
  Icon,
  color,
  label,
  onClick,
  onContextMenu,
  onDoubleClick,
  isActive,
  isSelected,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  isActive?: boolean;
  isSelected?: boolean;
}) {
  let stateClass = "hover:bg-gray-800/60";
  let iconColor = color;
  if (isSelected) {
    stateClass = "bg-red-500/20";
    iconColor = "text-red-400";
  } else if (isActive) {
    stateClass = "bg-blue-500/20";
    iconColor = "text-blue-300";
  }

  return (
    <button
      className={`relative w-10 h-7 rounded-r flex items-center justify-center transition-colors cursor-pointer ${stateClass}`}
      title={label}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
    </button>
  );
});

const NavDotGroup = memo(function NavDotGroup({
  id,
  Icon,
  color,
  subs,
  isActive,
  isSelected,
  subActiveKey,
  onDotClick,
  onSubDotClick,
  onContextMenu,
  onDoubleClick,
}: {
  id: string;
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  subs: SubItem[];
  isActive: boolean;
  isSelected: boolean;
  subActiveKey: string | null;
  onDotClick: (id: string) => void;
  onSubDotClick: (id: string, key: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (id: string) => void;
}) {
  return (
    <div className="flex flex-col items-center w-full">
      <NavDot
        id={id}
        Icon={Icon}
        color={color}
        isActive={isActive && !subActiveKey}
        isSelected={isSelected}
        onClick={() => onDotClick(id)}
        onContextMenu={(e) => onContextMenu(e, id)}
        onDoubleClick={() => onDoubleClick(id)}
      />
      {subs.length > 0 && (
        <div className="flex flex-col items-center ml-1 mt-0.5 space-y-0.5">
          {subs.map((sub, i) => {
            const key = `${id}-${i}`;
            return (
              <NavSubDot
                key={key}
                Icon={sub.icon}
                color={sub.color}
                label={sub.label}
                onClick={() => onSubDotClick(id, key)}
                onContextMenu={(e) => onContextMenu(e, id)}
                onDoubleClick={() => onDoubleClick(id)}
                isActive={subActiveKey === key}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

export function SideNav({
  messages,
  scrollRef,
  onScrollSync,
  onNavDotClick,
  onNavDotScroll,
}: {
  messages: ChatMessage[];
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScrollSync?: () => void;
  onNavDotClick?: (msgId: string) => void;
  onNavDotScroll?: (msgId: string) => void;
}) {
  const activeId = useChatNavStore((s) => s.activeId);
  const selectedIds = useChatNavStore((s) => s.selectedIds);
  const toggleSelected = useChatNavStore((s) => s.toggleSelected);
  const [subActiveKey, setSubActiveKey] = useState<string | null>(null);

  const navItems = useMemo(() => buildNavItems(messages), [messages]);

  const handleDotClick = useCallback((id: string) => {
    setSubActiveKey(null);
    if (onNavDotClick) onNavDotClick(id);
  }, [onNavDotClick]);

  const handleSubDotClick = useCallback((id: string, key: string) => {
    setSubActiveKey(key);
    if (onNavDotScroll) onNavDotScroll(id);
  }, [onNavDotScroll]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      toggleSelected(id);
    },
    [toggleSelected]
  );

  const handleDoubleClick = useCallback(
    (id: string) => {
      toggleSelected(id);
    },
    [toggleSelected]
  );

  return (
    <div className="h-full flex flex-col bg-gray-900/30 border-l border-gray-800/30">
      <div
        ref={scrollRef as React.Ref<HTMLDivElement>}
        className="flex-1 overflow-y-auto"
        onScroll={onScrollSync}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div className="flex flex-col items-center py-2 space-y-0.5">
          {navItems.map(({ id, icon: Icon, color, subs }) => (
            <NavDotGroup
              key={id}
              id={id}
              Icon={Icon}
              color={color}
              subs={subs}
              isActive={activeId === id}
              isSelected={selectedIds.has(id)}
              subActiveKey={subActiveKey}
              onDotClick={handleDotClick}
              onSubDotClick={handleSubDotClick}
              onContextMenu={handleContextMenu}
              onDoubleClick={handleDoubleClick}
            />
          ))}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="px-1 py-1 text-[10px] text-red-400 text-center border-t border-red-500/20 bg-red-950/20">
          已选 {selectedIds.size}
        </div>
      )}
    </div>
  );
}

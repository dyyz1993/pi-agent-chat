import { useMemo, useCallback, useEffect, useRef, memo } from "react";
import {
  User,
  Bot,
  FileText,
  AlertTriangle,
  Bookmark,
  Terminal,
  ScanSearch,
  Brain,
  type LucideIcon,
} from "lucide-react";
import type { ChatMessage } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { useTurnStore } from "../../stores/use-turn-store";
import { getToolIcon, getPreviewResourceIcon, getCustomTypeIcon } from "./tool-icon-map";
import { useBookmarkStore } from "../../stores/use-bookmark-store";

type SubItem = {
  icon: LucideIcon;
  color: string;
  label: string;
  blockId: string;
};

type NavItem = {
  id: string;
  role: "user" | "assistant" | "custom";
  icon: LucideIcon;
  color: string;
  subs: SubItem[];
};

function buildNavItems(messages: ChatMessage[]): NavItem[] {
  return messages.map((msg) => {
    if (msg.role === "user") {
      return { id: msg.id, role: "user" as const, icon: User, color: "text-indigo-400", subs: [] };
    }

    if (msg.role === "custom") {
      const customBlock = msg.content.find((b) => b.type === "custom") as
        | { type: "custom"; customType: string; data: unknown }
        | undefined;
      const customType = customBlock?.customType ?? "unknown";
      const iconEntry = getCustomTypeIcon(customType);
      return {
        id: msg.id,
        role: "custom",
        icon: iconEntry.icon,
        color: iconEntry.color,
        label: iconEntry.label,
        subs: [],
      };
    }

    const customBlock = msg.content.find((b) => b.type === "custom") as
      | { type: "custom"; customType: string; data: unknown }
      | undefined;
    if (customBlock && customBlock.customType === "lsp_diagnostics") {
      return { id: msg.id, role: "assistant", icon: AlertTriangle, color: "text-yellow-400", subs: [] };
    }

    const subs: SubItem[] = [];
    const seenTools = new Set<string>();

    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      const blockId = `${msg.id}-${bi}`;

      if (b.type === "thinking") {
        subs.push({ icon: Brain, color: "text-purple-400/60", label: "Thinking", blockId });
      } else if (b.type === "text") {
        subs.push({ icon: FileText, color: "text-gray-500", label: "文本", blockId });
      } else if (b.type === "toolExecution" && !seenTools.has(b.toolName)) {
        seenTools.add(b.toolName);
        let ti = getToolIcon(b.toolName);
        let label = ti.label;
        if (b.toolName.toLowerCase() === "preview" && (b as { details?: unknown }).details) {
          const rt = ((b as { details?: { resourceType?: string } }).details as { resourceType?: string })?.resourceType;
          if (rt) { ti = getPreviewResourceIcon(rt); label = ti.label; }
        }
        subs.push({ icon: ti.icon, color: ti.color, label, blockId });
      } else if (b.type === "custom") {
        let icon: LucideIcon = Brain;
        let color = "text-yellow-400/70";
        let label = b.customType;
        switch (b.customType) {
          case "bash_background_exit": icon = Terminal; color = "text-cyan-400/70"; label = "后台进程"; break;
          case "lsp_diagnostics": icon = ScanSearch; color = "text-yellow-400/70"; break;
          case "memory_prefetch": color = "text-blue-400/70"; label = "Memory"; break;
          case "memory_extract": color = "text-green-400/70"; label = "Memory"; break;
          case "memory_dream": color = "text-purple-400/70"; label = "Memory"; break;
        }
        subs.push({ icon, color, label, blockId });
      }
    }

    const hasError = msg.content.some(
      (b) => (b.type === "toolResult" && b.isError) || (b.type === "toolExecution" && b.status === "error")
    );
    return { id: msg.id, role: "assistant", icon: Bot, color: hasError ? "text-red-400" : "text-green-400", subs };
  });
}

const NavDot = memo(function NavDot({
  Icon,
  color,
  isClicked,
  isMultiSelected,
  isBookmarked,
  onClick,
  onContextMenu,
  onDoubleClick,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  isClicked: boolean;
  isMultiSelected: boolean;
  isBookmarked?: boolean;
  onClick?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  let cls = "relative w-10 h-8 rounded-r flex items-center justify-center transition-all cursor-pointer ";
  let iconColor = color;
  let barCls = "absolute left-0 top-1 bottom-1 w-[3px] rounded-full transition-all opacity-0 ";

  if (isMultiSelected) {
    cls += "bg-red-500/20 ";
    iconColor = "text-red-400";
    barCls += "bg-red-500 opacity-100 ";
  } else if (isClicked) {
    cls += "bg-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.25)] ";
    iconColor = "text-blue-300";
    barCls += "bg-blue-400 opacity-100 ";
  } else {
    cls += "hover:bg-gray-800/60 ";
  }

  return (
    <button className={cls} onClick={onClick} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick}>
      <span className={barCls} />
      <Icon className={`w-4 h-4 ${iconColor} transition-colors`} />
      {isBookmarked && (
        <span
          style={{
            position: "absolute",
            top: -1,
            right: -1,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#e3b341",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Bookmark size={6} style={{ width: 6, height: 6, fill: "#5c4b0a" }} />
        </span>
      )}
    </button>
  );
});

const NavSubDot = memo(function NavSubDot({
  Icon,
  color,
  label,
  isActive,
  onClick,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
  isActive: boolean;
  onClick?: () => void;
}) {
  let cls = "relative w-10 h-7 rounded-r flex items-center justify-center transition-colors cursor-pointer ";
  let iconColor = color;

  if (isActive) {
    cls += "bg-blue-500/30 shadow-[0_0_6px_rgba(59,130,246,0.3)] ";
    iconColor = "text-blue-300";
  } else {
    cls += "hover:bg-gray-800/60 ";
  }

  return (
    <button className={cls} title={label} onClick={onClick}>
      <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
    </button>
  );
});

export function SideNav({
  messages,
  onNavDotClick,
}: {
  messages: ChatMessage[];
  onNavDotClick: (navId: string) => void;
}) {
  const selectedNavId = useTurnStore((s) => s.selectedNavId);
  const setNavId = useTurnStore((s) => s.setNavId);
  const selectedItems = useChatNavStore((s) => s.selectedItems);
  const toggleItemSelect = useChatNavStore((s) => s.toggleItemSelect);

  const itemsByProject = useBookmarkStore((s) => s.itemsByProject);
  const bookmarkedMessageIds = useMemo(() => {
    const ids = new Set<string>()
    for (const items of Object.values(itemsByProject)) {
      for (const item of items) {
        for (const mid of item.sourceMessageIds) ids.add(mid)
      }
    }
    return ids
  }, [itemsByProject]);

  const navItems = useMemo(() => buildNavItems(messages), [messages]);

  const handleDotClick = useCallback((id: string) => {
    setNavId(id);
    onNavDotClick(id);
  }, [onNavDotClick, setNavId]);

  const handleSubDotClick = useCallback((blockId: string) => {
    setNavId(blockId);
    onNavDotClick(blockId);
  }, [onNavDotClick, setNavId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    toggleItemSelect(id);
  }, [toggleItemSelect]);

  const handleDoubleClick = useCallback((id: string) => {
    toggleItemSelect(id);
  }, [toggleItemSelect]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedNavId || !scrollContainerRef.current) return;
    const msgId = selectedNavId.includes("-") ? selectedNavId.slice(0, selectedNavId.lastIndexOf("-")) : selectedNavId;
    const groupEl = scrollContainerRef.current.querySelector(`[data-nav-id="${msgId}"]`);
    if (!groupEl) return;
    const target = selectedNavId.includes("-")
      ? groupEl.querySelector("button[title]")
      : groupEl.querySelector("button:not([title])");
    if (target) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedNavId]);

  return (
    <div className="h-full flex flex-col bg-gray-900/30 border-l border-gray-800/30">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto sidenav-scroll" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        <div className="flex flex-col items-center py-2 space-y-0.5">
          {navItems.map(({ id, icon: Icon, color, subs }) => (
            <div key={id} data-nav-id={id}>
              <div className="flex flex-col items-center w-full">
                  <NavDot
                    Icon={Icon}
                    color={color}
                    isClicked={selectedNavId === id}
                    isMultiSelected={selectedItems.has(id)}
                    isBookmarked={bookmarkedMessageIds.has(id)}
                    onClick={() => handleDotClick(id)}
                    onContextMenu={(e) => handleContextMenu(e, id)}
                    onDoubleClick={() => handleDoubleClick(id)}
                  />
                  {subs.length > 0 && (
                    <div className="flex flex-col items-center ml-1 mt-0.5 space-y-0.5">
                      {subs.map((sub) => (
                        <NavSubDot
                          key={sub.blockId}
                          Icon={sub.icon}
                          color={sub.color}
                          label={sub.label}
                          isActive={selectedNavId === sub.blockId}
                          onClick={() => handleSubDotClick(sub.blockId)}
                        />
                      ))}
                    </div>
                  )}
                </div>
            </div>
          ))}
        </div>
      </div>

      {selectedItems.size > 0 && (
        <div className="px-1 py-1 text-[10px] text-red-400 text-center border-t border-red-500/20 bg-red-950/20">
          已选 {selectedItems.size}
        </div>
      )}
    </div>
  );
}

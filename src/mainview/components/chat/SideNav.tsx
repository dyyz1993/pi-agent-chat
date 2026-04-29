import { useMemo, useCallback, useEffect, useRef, memo } from "react";
import {
  User,
  Bot,
  FileText,
  AlertTriangle,
  Terminal,
  ScanSearch,
  Brain,
  type LucideIcon,
} from "lucide-react";
import type { ChatMessage } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { getToolIcon, getPreviewResourceIcon, getCustomTypeIcon } from "./tool-icon-map";

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
        subs.push({ icon: Brain, color: "text-purple-400", label: "Thinking", blockId });
      } else if (b.type === "text") {
        subs.push({ icon: FileText, color: "text-gray-400", label: "文本", blockId });
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
        let color = "text-yellow-400";
        let label = b.customType;
        switch (b.customType) {
          case "bash_background_exit": icon = Terminal; color = "text-cyan-400"; label = "后台进程"; break;
          case "lsp_diagnostics": icon = ScanSearch; color = "text-yellow-400"; break;
          case "memory_prefetch": color = "text-blue-400"; label = "Memory"; break;
          case "memory_prefetch_result": color = "text-blue-400"; label = "Memory"; break;
          case "memory_extract": color = "text-green-400"; label = "Memory"; break;
          case "memory_dream": color = "text-purple-400"; label = "Memory"; break;
          case "memory_created": color = "text-teal-400"; label = "Memory"; break;
          case "memory_failed": color = "text-red-400"; label = "Memory"; break;
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
  onClick,
  onContextMenu,
  onDoubleClick,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  isClicked: boolean;
  isMultiSelected: boolean;
  onClick?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  let cls = "relative w-10 h-8 rounded-r flex items-center justify-center transition-all cursor-pointer ";
  let iconColor = color;
  let barCls = "absolute left-0 top-1 bottom-1 w-[3px] rounded-full transition-all opacity-0 ";

  if (isMultiSelected) {
    cls += "bg-red-500/25 ";
    iconColor = "text-red-400";
    barCls += "bg-red-500 opacity-100 ";
  } else if (isClicked) {
    cls += "bg-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.3)] ";
    iconColor = "text-indigo-300";
    barCls += "bg-indigo-400 opacity-100 ";
  } else {
    cls += "hover:bg-gray-800/60 ";
  }

  return (
    <button className={cls} onClick={onClick} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick}>
      <span className={barCls} />
      <Icon className={`w-4 h-4 ${iconColor} transition-colors`} />
    </button>
  );
});

const NavSubDot = memo(function NavSubDot({
  Icon,
  color,
  label,
  isActive,
  blockId,
  onClick,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
  isActive: boolean;
  blockId: string;
  onClick?: () => void;
}) {
  let cls = "relative w-10 h-8 rounded-r flex items-center justify-center transition-all cursor-pointer ";
  let iconColor = color;
  let barCls = "absolute left-0 top-1 bottom-1 w-[3px] rounded-full transition-all opacity-0 ";

  if (isActive) {
    cls += "bg-indigo-500/25 shadow-[0_0_6px_rgba(99,102,241,0.25)] ";
    iconColor = "text-indigo-300";
    barCls += "bg-indigo-400 opacity-100 ";
  } else {
    cls += "hover:bg-gray-800/60 ";
  }

  return (
    <button className={cls} title={label} data-block-id={blockId} onClick={onClick}>
      <span className={barCls} />
      <Icon className={`w-4 h-4 ${iconColor} transition-colors`} />
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
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const selectedNavId = useTurnStore(
    useCallback((s) => sessionId ? (s.selectedNavIdBySession[sessionId] ?? null) : null, [sessionId])
  );
  const navAnchor = useTurnStore(
    useCallback((s) => sessionId ? (s.navAnchorBySession[sessionId] ?? "top") : "top", [sessionId])
  );
  const setNavId = useTurnStore((s) => s.setNavId);
  const selectedItems = useChatNavStore(
    useCallback((s) => sessionId ? (s.selectedItemsBySession[sessionId] ?? EMPTY_SET) : EMPTY_SET, [sessionId])
  );
  const toggleItemSelect = useChatNavStore((s) => s.toggleItemSelect);

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
    const container = scrollContainerRef.current;

    const raf = requestAnimationFrame(() => {
      const target = container.querySelector(
        `[data-nav-id="${selectedNavId}"], [data-block-id="${selectedNavId}"]`
      );
      if (!target) return;

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const isAbove = targetRect.top < containerRect.top;
      const isBelow = targetRect.bottom > containerRect.bottom;
      if (!isAbove && !isBelow) return;

      if (navAnchor === "top") {
        container.scrollTop += targetRect.top - containerRect.top;
      } else {
        container.scrollTop += targetRect.bottom - containerRect.bottom;
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [selectedNavId, navItems, navAnchor]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-gray-900/30 border-l border-gray-800/30">
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto sidenav-scroll" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        <div className="flex flex-col items-center py-2 space-y-1.5">
          {navItems.map(({ id, icon: Icon, color, subs }) => (
            <div key={id} data-nav-id={id}>
              <div className="flex flex-col items-center w-full">
                  <NavDot
                    Icon={Icon}
                    color={color}
                    isClicked={selectedNavId === id}
                    isMultiSelected={selectedItems.has(id)}
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
                          blockId={sub.blockId}
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

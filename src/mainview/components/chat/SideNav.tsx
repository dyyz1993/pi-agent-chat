import {
  useMemo,
  useCallback,
  useEffect,
  useRef,
  memo,
  useImperativeHandle,
  forwardRef,
} from "react";
import { VList, type VListHandle } from "virtua";
import {
  User,
  Bot,
  Type,
  AlertTriangle,
  Terminal,
  ScanSearch,
  Brain,
  Archive,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { getToolIcon, getPreviewResourceIcon, getCustomTypeIcon } from "./tool-icon-map";
import { ALL_MEMORY_TYPE_KEYS } from "./memory-config";
import { useSettingsStore } from "../../stores/use-settings-store";

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

function buildNavItems(messages: ChatMessage[], t: (key: string) => string): NavItem[] {
  return messages.map((msg) => {
    if (msg.role === "user") {
      return {
        id: msg.id,
        role: "user" as const,
        icon: User,
        color: "text-semantic-accent",
        subs: [],
      };
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

    if (msg.role === "compactionSummary") {
      return {
        id: msg.id,
        role: "assistant" as const,
        icon: Archive,
        color: "text-semantic-tool",
        subs: [],
      };
    }

    const customBlock = msg.content.find((b) => b.type === "custom") as
      | { type: "custom"; customType: string; data: unknown }
      | undefined;
    if (customBlock && customBlock.customType === "lsp_diagnostics") {
      return {
        id: msg.id,
        role: "assistant",
        icon: AlertTriangle,
        color: "text-status-warning",
        subs: [],
      };
    }

    const subs: SubItem[] = [];
    const seenTools = new Set<string>();

    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      const blockId = `${msg.id}-${bi}`;

      if (b.type === "text") {
        subs.push({ icon: Type, color: "text-text-tertiary", label: t("sideNav.text"), blockId });
      } else if (b.type === "toolExecution" && !seenTools.has(b.toolName)) {
        seenTools.add(b.toolName);
        let ti = getToolIcon(b.toolName);
        let label = ti.label;
        if (b.toolName.toLowerCase() === "preview" && (b as { details?: unknown }).details) {
          const rt = (
            (b as { details?: { resourceType?: string } }).details as { resourceType?: string }
          )?.resourceType;
          if (rt) {
            ti = getPreviewResourceIcon(rt);
            label = ti.label;
          }
        }
        subs.push({ icon: ti.icon, color: ti.color, label, blockId });
      } else if (b.type === "custom") {
        let icon: LucideIcon = Brain;
        let color = "text-status-warning";
        let label = b.customType;
        switch (b.customType) {
          case "bash_background_exit":
            icon = Terminal;
            color = "text-semantic-tool";
            label = t("sideNav.backgroundProcess");
            break;
          case "lsp_diagnostics":
            icon = ScanSearch;
            color = "text-status-warning";
            break;
          default:
            if (ALL_MEMORY_TYPE_KEYS.has(b.customType)) {
              const memIcon = getCustomTypeIcon(b.customType);
              icon = memIcon.icon;
              color = memIcon.color;
              label = t("sideNav.memory");
            }
            break;
        }
        subs.push({ icon, color, label, blockId });
      }
    }

    const hasError = msg.content.some((b) =>
      b.type === "toolResult" && b.isError
        ? true
        : b.type === "toolExecution" && b.status === "error",
    );
    return {
      id: msg.id,
      role: "assistant",
      icon: Bot,
      color: hasError ? "text-status-error" : "text-status-success",
      subs,
    };
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
  let cls =
    "relative w-10 h-8 rounded-r flex items-center justify-center leading-none transition-all cursor-pointer ";
  let iconColor = color;
  let barCls = "absolute left-0 top-1 bottom-1 w-[3px] rounded-full transition-all opacity-0 ";

  if (isMultiSelected) {
    cls += "bg-status-error/25 ";
    iconColor = "text-status-error";
    barCls += "bg-status-error opacity-100 ";
  } else if (isClicked) {
    cls += "bg-semantic-accent/25 shadow-[0_0_10px_rgba(99,102,241,0.3)] ";
    iconColor = "text-semantic-accent";
    barCls += "bg-semantic-accent opacity-100 ";
  } else {
    cls += "hover:bg-surface-hover ";
  }

  return (
    <button
      className={cls}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      <span className={barCls} />
      <Icon className={`w-4 h-4 shrink-0 ${iconColor} transition-colors`} />
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
  let cls =
    "relative w-10 h-8 rounded-r flex items-center justify-center leading-none transition-all cursor-pointer ";
  let iconColor = color;
  let barCls = "absolute left-0 top-1 bottom-1 w-[3px] rounded-full transition-all opacity-0 ";

  if (isActive) {
    cls += "bg-semantic-accent/25 shadow-[0_0_6px_rgba(99,102,241,0.25)] ";
    iconColor = "text-semantic-accent";
    barCls += "bg-semantic-accent opacity-100 ";
  } else {
    cls += "hover:bg-surface-hover ";
  }

  return (
    <button className={cls} title={label} data-block-id={blockId} onClick={onClick}>
      <span className={barCls} />
      <Icon className={`w-4 h-4 shrink-0 ${iconColor} transition-colors`} />
    </button>
  );
});

export const SideNav = memo(
  forwardRef<
    { getFirstIconId: () => string | null; getLastIconId: () => string | null },
    { messages: ChatMessage[]; onNavDotClick: (navId: string) => void }
  >(function SideNavInner({ messages, onNavDotClick }, ref) {
    const { t } = useTranslation("chat");
    const sessionId = useSessionStore((s) => s.activeSessionId);
    const selectedNavId = useTurnStore(
      useCallback(
        (s) => (sessionId ? (s.selectedNavIdBySession[sessionId] ?? null) : null),
        [sessionId],
      ),
    );
    const setNavId = useTurnStore((s) => s.setNavId);
    const selectedItems = useChatNavStore(
      useCallback(
        (s) => (sessionId ? (s.selectedItemsBySession[sessionId] ?? EMPTY_SET) : EMPTY_SET),
        [sessionId],
      ),
    );
    const toggleItemSelect = useChatNavStore((s) => s.toggleItemSelect);

    const navItems = useMemo(() => buildNavItems(messages, t), [messages, t]);

    const showToolCalls = useSettingsStore((s) => s.showToolCalls);
    const showThinking = useSettingsStore((s) => s.showThinking);

    const filteredNavItems = useMemo(() => {
      if (showToolCalls && showThinking) return navItems;
      return navItems.map((item) => ({
        ...item,
        subs: item.subs.filter((sub) => {
          if (!showToolCalls && sub.label !== t("sideNav.text")) return false;
          return true;
        }),
      }));
    }, [navItems, showToolCalls, showThinking, t]);

    const sidenavVlistRef = useRef<VListHandle>(null);

    const flatIconIds = useMemo(() => {
      const ids: string[] = [];
      for (const item of filteredNavItems) {
        if (item.subs.length > 0) {
          for (const sub of item.subs) {
            ids.push(sub.blockId);
          }
        } else {
          ids.push(item.id);
        }
      }
      return ids;
    }, [filteredNavItems]);

    useImperativeHandle(
      ref,
      () => ({
        getFirstIconId: () => flatIconIds[0] ?? null,
        getLastIconId: () => flatIconIds[flatIconIds.length - 1] ?? null,
      }),
      [flatIconIds],
    );

    const handleDotClick = useCallback(
      (id: string) => {
        setNavId(id);
        onNavDotClick(id);
      },
      [onNavDotClick, setNavId],
    );

    const handleSubDotClick = useCallback(
      (blockId: string) => {
        setNavId(blockId);
        onNavDotClick(blockId);
      },
      [onNavDotClick, setNavId],
    );

    const handleContextMenu = useCallback(
      (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        toggleItemSelect(id);
      },
      [toggleItemSelect],
    );

    const handleDoubleClick = useCallback(
      (id: string) => {
        toggleItemSelect(id);
      },
      [toggleItemSelect],
    );

    useEffect(() => {
      if (!selectedNavId) return;
      let idx = filteredNavItems.findIndex((n) => n.id === selectedNavId);
      if (idx < 0) {
        idx = filteredNavItems.findIndex((n) => n.subs.some((s) => s.blockId === selectedNavId));
      }
      if (idx < 0) return;

      const isEdge = idx === 0 || idx === filteredNavItems.length - 1;
      const align = isEdge ? (idx === 0 ? "start" : "end") : "center";

      const timer = setTimeout(() => {
        sidenavVlistRef.current?.scrollToIndex(idx, { align, smooth: true });
      }, 120);
      return () => clearTimeout(timer);
    }, [selectedNavId, filteredNavItems]);

    return (
      <div className="h-full min-h-0 flex flex-col bg-surface-dim/30 dark:bg-surface-code/30 border-l border-border-secondary/30">
        <VList
          ref={sidenavVlistRef}
          style={{ flex: 1, minHeight: 0, scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {filteredNavItems.map(({ id, icon: Icon, color, subs }) => (
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
        </VList>

        {selectedItems.size > 0 && (
          <div className="px-1 py-1 text-[10px] text-status-error text-center border-t border-status-error/20 bg-status-error/5">
            {t("sideNav.selected", { count: selectedItems.size })}
          </div>
        )}
      </div>
    );
  }),
);

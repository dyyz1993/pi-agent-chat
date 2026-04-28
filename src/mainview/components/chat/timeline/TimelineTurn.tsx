import { memo, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Trash2,
  GitBranch,
  RotateCcw,
  MessageSquare,
  Check,
} from "lucide-react";
import type { TimelineTurn as TTurn, TimelineItem } from "../../../types";
import { getItemId } from "../../../lib/turn-aggregator";
import { useChatNavStore } from "../../../stores/use-chat-nav-store";
import { useClipboard } from "../preview/use-clipboard";

interface TimelineTurnProps {
  turn: TTurn;
  isLast?: boolean;
}

export const TimelineTurn = memo(function TimelineTurn({ turn, isLast: _isLast }: TimelineTurnProps) {
  void _isLast;
  const { copied: turnCopied, copy: copyTurn } = useClipboard();
  const collapsed = useChatNavStore(
    useCallback((s: { isTurnCollapsed: (id: string) => boolean }) => s.isTurnCollapsed(turn.id), [turn.id])
  );
  const hasSelection = useChatNavStore(useCallback((s: { hasSelection: () => boolean }) => s.hasSelection(), []));
  const isTurnSelected = useChatNavStore(
    useCallback((s: { isTurnSelected: (id: string) => boolean }) => s.isTurnSelected(turn.id), [turn.id])
  );

  const allItemIds = turn.items.map(getItemId);
  const toolCount = turn.items.filter((i: TimelineItem) => i.itemType === "toolExecution").length;
  const textCount = turn.items.filter((i: TimelineItem) => i.itemType === "assistantText").length;

  const toggleCollapse = () => useChatNavStore.getState().toggleTurnCollapse(turn.id);
  const toggleSelectAll = () => useChatNavStore.getState().toggleTurnSelect(turn.id, allItemIds);

  return (
    <div
      id={`turn-${turn.id}`}
      data-turn-id={turn.id}
      className="relative group/turn"
    >
      {/* ── Left Timeline Line & Dots ── */}
      <div className="absolute left-[11px] top-6 bottom-0 w-px bg-gradient-to-b from-indigo-500/40 via-green-500/30 to-transparent" />

      {/* ── Turn Header ── */}
      <div className="flex items-start gap-3 mb-1">
        {/* Dot column */}
        <div className="relative z-10 flex flex-col items-center w-[23px] shrink-0 pt-1">
          {/* User dot (blue) */}
          <div className="w-[9px] h-[9px] rounded-full bg-blue-500 ring-2 ring-blue-500/20 shadow-sm shadow-blue-500/20" />
          {/* Bot dot (green) - only if there's an assistant response */}
          {(turn.assistantMessageId || turn.items.length > 0) && (
            <div className="mt-4 w-[7px] h-[7px] rounded-full bg-green-500 ring-2 ring-green-500/20 shadow-sm shadow-green-500/20" />
          )}
        </div>

        {/* Header content */}
        <div className="flex-1 min-w-0 flex items-center gap-2 py-1">
          {/* Collapse toggle */}
          <button
            onClick={toggleCollapse}
            className="shrink-0 p-0.5 rounded hover:bg-gray-800 transition-colors"
            title={collapsed ? "展开" : "折叠"}
          >
            {collapsed ? (
              <ChevronRight size={13} className="text-gray-500" />
            ) : (
              <ChevronDown size={13} className="text-gray-500" />
            )}
          </button>

          {/* Model / summary info */}
          <span className="text-[11px] text-gray-500 font-medium truncate">
            {turn.model || "Assistant"}
            {toolCount > 0 && (
              <span className="ml-1.5 text-gray-600">· {toolCount} tool{toolCount > 1 ? "s" : ""}</span>
            )}
          </span>

          {/* Token usage badge */}
          {turn.tokenUsage && (
            <span className="text-[10px] text-gray-600 font-mono ml-auto">
              {formatTokens(turn.tokenUsage.input)} / {formatTokens(turn.tokenUsage.output)}
            </span>
          )}

          {/* Streaming indicator */}
          {turn.isStreaming && (
            <span className="text-[10px] text-blue-400 animate-pulse">streaming</span>
          )}

          {/* Turn action buttons (visible on hover) */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover/turn:opacity-100 transition-opacity ml-auto shrink-0">
            <TurnActionButton
              icon={turnCopied ? <Check size={12} /> : <Copy size={12} />}
              label={turnCopied ? "已复制" : "复制"}
              onClick={() => {
                const parts: string[] = [];
                if (turn.userText) parts.push(turn.userText);
                turn.items.forEach((i: TimelineItem) => {
                  if (i.itemType === "assistantText") parts.push(i.text);
                });
                copyTurn(parts.join("\n\n"));
              }}
              active={turnCopied}
            />
            <TurnActionButton icon={<GitBranch size={12} />} label="Fork" onClick={() => {}} />
            <TurnActionButton
              icon={<Trash2 size={12} />}
              label="删除"
              onClick={toggleSelectAll}
              active={isTurnSelected}
            />
            <TurnActionButton icon={<RotateCcw size={12} />} label="回滚代码" onClick={() => useChatNavStore.getState().openRollbackOverlay("code")} variant="warning" />
            <TurnActionButton icon={<MessageSquare size={12} />} label="回滚聊天" onClick={() => useChatNavStore.getState().openRollbackOverlay("chat")} variant="info" />
          </div>
        </div>
      </div>

      {/* ── Collapsed Summary ── */}
      {collapsed && (
        <div className="ml-[38px] py-1.5 px-3 text-[11px] text-gray-500 bg-gray-900/40 rounded-md border border-gray-800/50 cursor-pointer" onClick={toggleCollapse}>
          {turn.userText ? truncate(turn.userText, 60) : "(empty)"}
          {textCount > 0 && ` · ${textCount} text`}
          {toolCount > 0 && ` · ${toolCount} tools`}
        </div>
      )}

      {/* ── Expanded Content ── */}
      {!collapsed && (
        <div className="ml-[38px] space-y-2 pb-2">
          {/* User message (no checkbox) */}
          {turn.userText && (
            <div className="flex justify-end">
              <div className="max-w-[80%] px-3 py-2 rounded-lg bg-indigo-600/90 text-white text-sm whitespace-pre-wrap break-words border border-indigo-500/30">
                {turn.userText}
              </div>
            </div>
          )}

          {/* Assistant items (each with optional checkbox) */}
          {turn.items.map((item: TimelineItem, _idx: number) => {
            void _idx;
            const itemId = getItemId(item);
            return (
              <TimelineItemRenderer
                key={itemId}
                item={item}
                itemId={itemId}
                turnId={turn.id}
                showCheckbox={hasSelection || false}
              />
            );
          })}

          {/* Empty state for turn with no items yet */}
          {!turn.userText && turn.items.length === 0 && !turn.isStreaming && null}
        </div>
      )}
    </div>
  );
});

// ─── Sub-components ───

function TimelineItemRenderer({
  item,
  itemId,
  turnId: _turnId,
  showCheckbox,
}: {
  item: TimelineItem;
  itemId: string;
  turnId: string;
  showCheckbox: boolean;
}) {
  void _turnId;
  const isSelected = useChatNavStore(
    useCallback((s: { isItemSelected: (id: string) => boolean }) => s.isItemSelected(itemId), [itemId])
  );

  const handleToggle = () => useChatNavStore.getState().toggleItemSelect(itemId);

  switch (item.itemType) {
    case "assistantText":
      return (
        <div className="group/item relative flex gap-2">
          {showCheckbox && (
            <ItemCheckbox checked={isSelected} onChange={handleToggle} />
          )}
          <AssistantTextBlock text={item.text} isStreaming={false} />
        </div>
      );
    case "toolExecution":
      return (
        <div className="group/item relative">
          {showCheckbox && (
            <ItemCheckbox checked={isSelected} onChange={handleToggle} />
          )}
          <div className="px-3 py-2 rounded-lg bg-gray-800/60 text-sm text-gray-300 font-mono">
            <span className="text-indigo-400">{item.toolName}</span>
            {item.args && <span className="text-gray-500 ml-1">{item.args.slice(0, 80)}</span>}
          </div>
        </div>
      );
    case "customEntry":
      return (
        <div className="group/item relative flex gap-2">
          {showCheckbox && (
            <ItemCheckbox checked={isSelected} onChange={handleToggle} />
          )}
          <div className="px-3 py-2 rounded-lg bg-gray-800/40 text-sm text-gray-300">
            <span className="text-cyan-400 font-medium">[{item.customType}]</span>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function ItemCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={`absolute -left-[26px] top-2 w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${
        checked
          ? "bg-indigo-500 border-indigo-400 text-white"
          : "border-gray-600 hover:border-gray-400 bg-transparent"
      }`}
    >
      {checked && <Check size={10} />}
    </button>
  );
}

function AssistantTextBlock({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const { copied, copy } = useClipboard();

  if (isStreaming) {
    return (
      <div className="px-3 py-2 rounded-lg bg-gray-700/60 text-sm text-gray-200 whitespace-pre-wrap break-words">
        {text}
        <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
      </div>
    );
  }

  return (
    <div className="group/text relative px-3 py-2 rounded-lg bg-gray-800/40 prose prose-invert prose-sm max-w-none">
      <pre className="whitespace-pre-wrap break-words text-sm text-gray-200">{text}</pre>
      <button
        onClick={() => copy(text)}
        className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover/text:opacity-100 hover:bg-gray-700 transition-all"
        title={copied ? "已复制" : "复制文本"}
      >
        <Copy size={11} className={copied ? "text-green-400" : "text-gray-500"} />
      </button>
    </div>
  );
}

function TurnActionButton({
  icon,
  label,
  onClick,
  variant = "default",
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "warning" | "info";
  active?: boolean;
}) {
  const colorClass =
    variant === "warning"
      ? "text-yellow-400/70 hover:text-yellow-400 hover:bg-yellow-400/10"
      : variant === "info"
        ? "text-blue-400/70 hover:text-blue-400 hover:bg-blue-400/10"
        : "text-gray-500 hover:text-gray-300 hover:bg-gray-800";

  const activeClass = active ? "!bg-indigo-500/20 !text-indigo-400" : "";

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`p-1 rounded transition-colors ${colorClass} ${activeClass}`}
      title={label}
    >
      {icon}
    </button>
  );
}

// ─── Utilities ───

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return `${n}`;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "..." : s;
}

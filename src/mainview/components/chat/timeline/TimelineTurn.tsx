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
import { useTranslation } from "react-i18next";
import type { TimelineTurn as TTurn, TimelineItem } from "../../../types";
import { getItemId } from "../../../lib/turn-aggregator";
import { useChatNavStore } from "../../../stores/use-chat-nav-store";
import { useClipboard } from "../preview/use-clipboard";
import { useRollbackStore } from "../../../stores/use-rollback-store";
import type { ModifiedFile } from "../../../stores/use-rollback-store";
import { useSessionStore } from "../../../stores/use-session-store";
import { useChatStore } from "../../../stores/use-chat-store";
import { apiClient } from "../../../lib/api-client";

interface TimelineTurnProps {
  turn: TTurn;
  isLast?: boolean;
}

export const TimelineTurn = memo(function TimelineTurn({
  turn,
  isLast: _isLast,
}: TimelineTurnProps) {
  void _isLast;
  const { t } = useTranslation(["chat", "common"]);
  const { copied: turnCopied, copy: copyTurn } = useClipboard();
  const collapsed = useChatNavStore(
    useCallback(
      (s: { isTurnCollapsed: (id: string) => boolean }) => s.isTurnCollapsed(turn.id),
      [turn.id],
    ),
  );
  const hasSelection = useChatNavStore(
    useCallback((s: { hasSelection: () => boolean }) => s.hasSelection(), []),
  );
  const isTurnSelected = useChatNavStore(
    useCallback(
      (s: { isTurnSelected: (id: string) => boolean }) => s.isTurnSelected(turn.id),
      [turn.id],
    ),
  );

  const allItemIds = turn.items.map(getItemId);
  const toolCount = turn.items.filter((i: TimelineItem) => i.itemType === "toolExecution").length;
  const textCount = turn.items.filter((i: TimelineItem) => i.itemType === "assistantText").length;

  const toggleCollapse = () => useChatNavStore.getState().toggleTurnCollapse(turn.id);
  const toggleSelectAll = () => useChatNavStore.getState().toggleTurnSelect(turn.id, allItemIds);

  const handleRollback = useCallback(
    async (mode: "message" | "withFiles") => {
      const sessionId = useSessionStore.getState().activeSessionId;
      if (!sessionId) return;
      try {
        const result = await apiClient.call("agent.getTree", { sessionId });
        const entries: Array<{
          id: string;
          parentId: string | null;
          type: string;
          label?: string;
        }> = result.entries ?? result ?? [];
        if (!Array.isArray(entries) || entries.length === 0) return;

        const byId = new Map(entries.map((e) => [e.id, e]));

        const findAncestorMessage = (start: {
          id: string;
          parentId: string | null;
          type: string;
          label?: string;
        }): { id: string; parentId: string | null; type: string; label?: string } | null => {
          let cur = start;
          while (cur.parentId) {
            const parent = byId.get(cur.parentId);
            if (!parent) return null;
            if (parent.type === "message") return parent;
            cur = parent;
          }
          return null;
        };

        let targetId: string | null = null;

        const assistantEntries = entries.filter(
          (e) => e.type === "message" && e.label === "assistant",
        );

        if (turn.assistantMessageId && assistantEntries.length > 0) {
          const entry = assistantEntries[assistantEntries.length - 1];
          const userMsg = findAncestorMessage(entry);
          if (userMsg && userMsg.label === "user") {
            const grandParent = findAncestorMessage(userMsg);
            if (grandParent) {
              targetId = grandParent.parentId ?? null;
            }
          }
        }

        if (!targetId) return;

        if (mode === "withFiles") {
          const msgs = useChatStore.getState().messagesBySession[sessionId] ?? [];
          // 用 targetId 切片：从 targetId 对应消息到当前消息
          const targetIdx = targetId ? msgs.findIndex((m) => m.entryId === targetId) : -1;
          const assistantId = turn.assistantMessageId;
          const currentIdx = msgs.findIndex((m) => m.id === assistantId);
          const fromIdx = targetIdx >= 0 ? targetIdx + 1 : 0;
          const toIdx = currentIdx >= 0 ? currentIdx + 1 : msgs.length;
          const slice = msgs.slice(fromIdx, toIdx);
          const files: ModifiedFile[] = [];
          const seen = new Set<string>();
          for (const msg of slice.length > 0 ? slice : msgs) {
            for (const block of msg.content) {
              if (block.type !== "toolExecution") continue;
              const tb = block as Extract<typeof block, { type: "toolExecution" }>;
              if (
                tb.toolName !== "Edit" &&
                tb.toolName !== "edit" &&
                tb.toolName !== "Write" &&
                tb.toolName !== "write"
              )
                continue;
              try {
                const args: unknown = JSON.parse(tb.args || "{}");
                const fp =
                  typeof args === "object" && args !== null && "path" in args
                    ? ((args as Record<string, unknown>).path as string | undefined)
                    : undefined;
                if (fp && !seen.has(fp)) {
                  seen.add(fp);
                  let details = "";
                  if (typeof args === "object" && args !== null) {
                    const r = args as Record<string, unknown>;
                    if (tb.toolName.toLowerCase() === "write") {
                      const content = r.content as string | undefined;
                      if (content)
                        details = `创建文件，内容:\n${content.slice(0, 500)}${content.length > 500 ? "\n...(截断)" : ""}`;
                    } else {
                      const oldContent = r.oldContent as string | undefined;
                      const newContent = r.newContent as string | undefined;
                      if (oldContent !== undefined && newContent !== undefined) {
                        details = `修改前:\n${oldContent.slice(0, 300)}${oldContent.length > 300 ? "\n...(截断)" : ""}\n\n修改后:\n${newContent.slice(0, 300)}${newContent.length > 300 ? "\n...(截断)" : ""}`;
                      }
                    }
                  }
                  files.push({
                    path: fp,
                    status: tb.toolName.toLowerCase() === "write" ? "added" : "modified",
                    turnIndex: files.length,
                    entryId: "",
                    details: details || undefined,
                  });
                }
              } catch {
                /* skip */
              }
            }
          }
          const summary = {
            totalFiles: files.length,
            added: files.filter((f) => f.status === "added").length,
            modified: files.filter((f) => f.status === "modified").length,
            deleted: files.filter((f) => f.status === "deleted").length,
          };
          useRollbackStore
            .getState()
            .openRollback(
              { targetId, mode: "withFiles" },
              { restored: [], deleted: [], files, summary },
            );
        } else {
          useRollbackStore.getState().openRollback(
            { targetId, mode: "message" },
            {
              restored: [],
              deleted: [],
              files: [],
              summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
            },
          );
        }
      } catch {
        // Silent
      }
    },
    [turn.assistantMessageId],
  );

  return (
    <div id={`turn-${turn.id}`} data-turn-id={turn.id} className="relative group/turn">
      {/* ── Left Timeline Line & Dots ── */}
      <div className="absolute left-[11px] top-6 bottom-0 w-px bg-gradient-to-b from-semantic-accent/40 via-status-success/30 to-transparent" />

      {/* ── Turn Header ── */}
      <div className="flex items-start gap-3 mb-1">
        {/* Dot column */}
        <div className="relative z-10 flex flex-col items-center w-[23px] shrink-0 pt-1">
          {/* User dot (blue) */}
          <div className="w-[9px] h-[9px] rounded-full bg-status-info ring-2 ring-status-info/20 shadow-sm shadow-status-info/20" />
          {/* Bot dot (green) - only if there's an assistant response */}
          {(turn.assistantMessageId ?? turn.items.length > 0) && (
            <div className="mt-4 w-[7px] h-[7px] rounded-full bg-status-success ring-2 ring-status-success/20 shadow-sm shadow-status-success/20" />
          )}
        </div>

        {/* Header content */}
        <div className="flex-1 min-w-0 flex items-center gap-2 py-1">
          {/* Collapse toggle */}
          <button
            onClick={toggleCollapse}
            className="shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            title={collapsed ? t("chat:expand") : t("chat:collapse")}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("chat:expandTurn") : t("chat:collapseTurn")}
          >
            {collapsed ? (
              <ChevronRight size={13} className="text-gray-500" />
            ) : (
              <ChevronDown size={13} className="text-gray-500" />
            )}
          </button>

          {/* Model / summary info */}
          <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium truncate">
            {turn.model ?? "Assistant"}
            {toolCount > 0 && (
              <span className="ml-1.5 text-gray-400 dark:text-gray-600">
                · {toolCount} tool{toolCount > 1 ? "s" : ""}
              </span>
            )}
          </span>

          {/* Token usage badge */}
          {turn.tokenUsage && (
            <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono ml-auto">
              {formatTokens(turn.tokenUsage.input)} / {formatTokens(turn.tokenUsage.output)}
            </span>
          )}

          {/* Streaming indicator */}
          {turn.isStreaming && (
            <span className="text-[10px] text-status-info animate-pulse">
              {t("chat:streaming")}
            </span>
          )}

          {/* Turn action buttons (visible on hover) */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover/turn:opacity-100 transition-opacity ml-auto shrink-0">
            <TurnActionButton
              icon={turnCopied ? <Check size={12} /> : <Copy size={12} />}
              label={turnCopied ? t("common:copied") : t("common:copy")}
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
            <TurnActionButton
              icon={<GitBranch size={12} />}
              label={t("chat:fork")}
              onClick={() => {}}
            />
            <TurnActionButton
              icon={<Trash2 size={12} />}
              label={t("common:delete")}
              onClick={toggleSelectAll}
              active={isTurnSelected}
            />
            <TurnActionButton
              icon={<RotateCcw size={12} />}
              label={t("chat:rollbackCode")}
              onClick={() => handleRollback("withFiles")}
              variant="warning"
            />
            <TurnActionButton
              icon={<MessageSquare size={12} />}
              label={t("chat:rollbackChat")}
              onClick={() => handleRollback("message")}
              variant="info"
            />
          </div>
        </div>
      </div>

      {/* ── Collapsed Summary ── */}
      {collapsed && (
        <div
          className="ml-[38px] py-1.5 px-3 text-[11px] text-gray-400 dark:text-gray-500 bg-gray-50/40 dark:bg-gray-900/40 rounded-md border border-gray-200/50 dark:border-gray-800/50 cursor-pointer"
          onClick={toggleCollapse}
        >
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
              <div className="max-w-[80%] px-3 py-2 rounded-lg bg-semantic-accent/90 text-white text-sm whitespace-pre-wrap break-words border border-semantic-accent/30">
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
    useCallback(
      (s: { isItemSelected: (id: string) => boolean }) => s.isItemSelected(itemId),
      [itemId],
    ),
  );

  const handleToggle = () => useChatNavStore.getState().toggleItemSelect(itemId);

  switch (item.itemType) {
    case "assistantText":
      return (
        <div className="group/item relative flex gap-2">
          {showCheckbox && <ItemCheckbox checked={isSelected} onChange={handleToggle} />}
          <AssistantTextBlock text={item.text} isStreaming={false} />
        </div>
      );
    case "toolExecution":
      return (
        <div className="group/item relative">
          {showCheckbox && <ItemCheckbox checked={isSelected} onChange={handleToggle} />}
          <div className="px-3 py-2 rounded-lg bg-gray-100/60 dark:bg-gray-800/60 text-sm text-gray-700 dark:text-gray-300 font-mono">
            <span className="text-semantic-accent">{item.toolName}</span>
            {item.args && (
              <span className="text-gray-400 dark:text-gray-500 ml-1">
                {item.args.slice(0, 80)}
              </span>
            )}
          </div>
        </div>
      );
    case "customEntry":
      return (
        <div className="group/item relative flex gap-2">
          {showCheckbox && <ItemCheckbox checked={isSelected} onChange={handleToggle} />}
          <div className="px-3 py-2 rounded-lg bg-gray-100/40 dark:bg-gray-800/40 text-sm text-gray-700 dark:text-gray-300">
            <span className="text-semantic-tool font-medium">[{item.customType}]</span>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function ItemCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`absolute -left-[26px] top-2 w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${
        checked
          ? "bg-semantic-accent border-semantic-accent text-white"
          : "border-gray-400 dark:border-gray-600 hover:border-gray-400 bg-transparent"
      }`}
    >
      {checked && <Check size={10} />}
    </button>
  );
}

function AssistantTextBlock({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const { t } = useTranslation(["chat", "common"]);
  const { copied, copy } = useClipboard();

  if (isStreaming) {
    return (
      <div className="px-3 py-2 rounded-lg bg-gray-200/60 dark:bg-gray-700/60 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
        {text}
        <span className="inline-block w-1.5 h-4 bg-semantic-accent animate-pulse ml-0.5 align-text-bottom" />
      </div>
    );
  }

  return (
    <div className="group/text relative px-3 py-2 rounded-lg bg-gray-100/40 dark:bg-gray-800/40 prose dark:prose-invert prose-sm max-w-none">
      <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-200">
        {text}
      </pre>
      <button
        onClick={() => copy(text)}
        className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover/text:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
        title={copied ? t("common:copied") : t("chat:copyText")}
      >
        <Copy
          size={11}
          className={copied ? "text-status-success" : "text-gray-400 dark:text-gray-500"}
        />
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
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "warning" | "info";
  active?: boolean;
  disabled?: boolean;
}) {
  const colorClass = disabled
    ? "text-gray-300 dark:text-gray-700 cursor-not-allowed"
    : variant === "warning"
      ? "text-status-warning/70 hover:text-status-warning hover:bg-status-warning/10"
      : variant === "info"
        ? "text-status-info/70 hover:text-status-info hover:bg-status-info/10"
        : "text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800";

  const activeClass = active ? "!bg-semantic-accent/20 !text-semantic-accent" : "";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      className={`p-1 rounded transition-colors ${colorClass} ${activeClass}`}
      title={label}
      disabled={disabled}
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

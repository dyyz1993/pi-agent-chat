import { memo, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Trash2,
  GitFork,
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
import { useForkDialogStore } from "../../../stores/use-fork-dialog-store";
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

  const sessionId = useSessionStore.getState().activeSessionId;
  const isSessionStreaming = useSessionStore(
    useCallback(
      (s: { sessionStatusMap: Record<string, import("../../../types").SessionStatus> }) => {
        const status = sessionId ? s.sessionStatusMap[sessionId] : undefined;
        return status === "streaming" || status === "compacting" || status === "retrying";
      },
      [sessionId],
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
        // Pass userEntryId so backend's navigateTree jumps over the entire turn
        // (user + assistant), removing the turn completely.
        let targetId: string | null = turn.userEntryId ?? null;

        // Fallback: resolve via tree lookup using the frontend message ID
        if (!targetId) {
          const result = await apiClient.call("agent.getTree", { sessionId });
          const entries: Array<{
            id: string;
            parentId: string | null;
            type: string;
            label?: string;
          }> = result.entries ?? result ?? [];
          if (!Array.isArray(entries) || entries.length === 0) return;

          const byId = new Map(entries.map((e) => [e.id, e]));

          if (turn.userMessageId) {
            const entry = byId.get(turn.userMessageId);
            if (entry) {
              targetId = entry.id;
            }
          }
        }

        if (!targetId) return;

        const currentInput = useChatStore.getState().inputText;
        if (currentInput.trim()) {
          try {
            localStorage.setItem(`pi-draft:${sessionId}`, currentInput);
          } catch {
            /* ignore */
          }
        }

        if (mode === "withFiles") {
          try {
            const modResult = await apiClient.call("agent.getModifiedFiles", {
              sessionId,
              toUserMsgEntryId: turn.userEntryId ?? undefined,
            });
            // Defensive: handle both { files, resolvedFromEntryId } and raw array formats
            const isArr = Array.isArray(modResult);
            const rawFiles = isArr
              ? (modResult as unknown[])
              : ((modResult as { files?: unknown[] }).files ?? []);
            const resolvedFromEntryId = isArr
              ? null
              : ((modResult as { resolvedFromEntryId?: string | null }).resolvedFromEntryId ??
                null);
            const files: ModifiedFile[] = await Promise.all(
              rawFiles.map(async (raw) => {
                const f = raw as {
                  path: string;
                  status: "added" | "modified" | "deleted";
                  turnIndex: number;
                  entryId: string;
                };
                try {
                  const diffResult = await apiClient.call("agent.getFileDiff", {
                    sessionId,
                    filePath: f.path,
                    fromEntryId: resolvedFromEntryId ?? undefined,
                    toEntryId: f.entryId,
                  });
                  const diff = diffResult as {
                    oldContent?: string | null;
                    newContent?: string | null;
                    unifiedDiff?: string;
                  } | null;
                  if (diff) {
                    const oldLines = diff.oldContent?.split("\n").length ?? 0;
                    const newLines = diff.newContent?.split("\n").length ?? 0;
                    return {
                      path: f.path,
                      status: f.status,
                      turnIndex: f.turnIndex,
                      entryId: f.entryId,
                      details: diff.unifiedDiff ?? undefined,
                      oldContent: diff.oldContent,
                      newContent: diff.newContent,
                      addedLines:
                        f.status === "added" ? newLines : Math.max(0, newLines - oldLines),
                      removedLines:
                        f.status === "added"
                          ? 0
                          : f.status === "deleted"
                            ? oldLines
                            : Math.max(0, oldLines - newLines),
                    };
                  }
                } catch {
                  /* skip diff for this file */
                }
                return {
                  path: f.path,
                  status: f.status,
                  turnIndex: f.turnIndex,
                  entryId: f.entryId,
                };
              }),
            );
            const restored = files
              .filter((f) => f.status === "modified" || f.status === "added")
              .map((f) => f.path);
            const deleted = files.filter((f) => f.status === "deleted").map((f) => f.path);
            const summary = {
              totalFiles: files.length,
              added: files.filter((f) => f.status === "added").length,
              modified: files.filter((f) => f.status === "modified").length,
              deleted: deleted.length,
            };
            useRollbackStore
              .getState()
              .openRollback({ targetId, mode: "withFiles" }, { restored, deleted, files, summary });
          } catch {
            useRollbackStore.getState().openRollback(
              { targetId, mode: "withFiles" },
              {
                restored: [],
                deleted: [],
                files: [],
                summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
              },
            );
          }
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
    [turn.userEntryId, turn.userMessageId],
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
            className="shrink-0 p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors"
            title={collapsed ? t("chat:expand") : t("chat:collapse")}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("chat:expandTurn") : t("chat:collapseTurn")}
          >
            {collapsed ? (
              <ChevronRight size={13} className="text-text-tertiary" />
            ) : (
              <ChevronDown size={13} className="text-text-tertiary" />
            )}
          </button>

          {/* Model / summary info */}
          <span className="text-[11px] text-text-tertiary font-medium truncate">
            {turn.model ?? "Assistant"}
            {toolCount > 0 && (
              <span className="ml-1.5 text-text-tertiary">
                · {toolCount} tool{toolCount > 1 ? "s" : ""}
              </span>
            )}
          </span>

          {/* Token usage badge */}
          {turn.tokenUsage && (
            <span className="text-[10px] text-text-tertiary font-mono ml-auto">
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
              icon={<Trash2 size={12} />}
              label={t("common:delete")}
              onClick={toggleSelectAll}
              active={isTurnSelected}
            />
          </div>
        </div>
      </div>

      {/* ── Collapsed Summary ── */}
      {collapsed && (
        <div
          className="ml-[38px] py-1.5 px-3 text-[11px] text-text-tertiary bg-surface-dim/40 dark:bg-surface-code/40 rounded-md border border-border-secondary/50 cursor-pointer"
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
            <div className="flex justify-end items-center gap-1">
              <div className="flex items-center gap-0.5 opacity-0 group-hover/turn:opacity-100 transition-opacity shrink-0">
                <TurnActionButton
                  icon={<GitFork size={12} />}
                  label={t("chat:fork")}
                  onClick={async () => {
                    const sessionId = useSessionStore.getState().activeSessionId;
                    if (!sessionId) return;
                    try {
                      let entryId: string | null =
                        turn.userEntryId ?? turn.assistantEntryId ?? null;
                      if (!entryId) {
                        const result = await apiClient.call("agent.getTree", { sessionId });
                        const entries: Array<{ id: string; type: string; label?: string }> =
                          result.entries ?? result ?? [];
                        if (!Array.isArray(entries) || entries.length === 0) return;
                        const byId = new Map(entries.map((e) => [e.id, e]));
                        if (turn.userMessageId) {
                          const entry = byId.get(turn.userMessageId);
                          if (entry) entryId = entry.id;
                        }
                        if (!entryId && turn.assistantMessageId) {
                          const entry = byId.get(turn.assistantMessageId);
                          if (entry) entryId = entry.id;
                        }
                      }
                      if (!entryId) return;
                      useForkDialogStore
                        .getState()
                        .openDialog({ sessionId, entryId, source: "timelineTurn" });
                    } catch {
                      /* skip */
                    }
                  }}
                  disabled={isSessionStreaming}
                />
                <TurnActionButton
                  icon={<RotateCcw size={12} />}
                  label={t("chat:rollbackCode")}
                  onClick={() => handleRollback("withFiles")}
                  variant="warning"
                  disabled={isSessionStreaming}
                />
                <TurnActionButton
                  icon={<MessageSquare size={12} />}
                  label={t("chat:rollbackChat")}
                  onClick={() => handleRollback("message")}
                  variant="info"
                  disabled={isSessionStreaming}
                />
              </div>
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
          <div className="px-3 py-2 rounded-lg bg-surface-code/60 dark:bg-surface-dim/60 text-sm text-text-secondary font-mono">
            <span className="text-semantic-accent">{item.toolName}</span>
            {item.args && <span className="text-text-tertiary ml-1">{item.args.slice(0, 80)}</span>}
          </div>
        </div>
      );
    case "customEntry":
      return (
        <div className="group/item relative flex gap-2">
          {showCheckbox && <ItemCheckbox checked={isSelected} onChange={handleToggle} />}
          <div className="px-3 py-2 rounded-lg bg-surface-code/40 dark:bg-surface-dim/40 text-sm text-text-secondary">
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
          : "border-border-secondary hover:border-border-secondary bg-transparent"
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
      <div className="px-3 py-2 rounded-lg bg-surface-hover/60 text-sm text-text-primary whitespace-pre-wrap break-words">
        {text}
        <span className="inline-block w-1.5 h-4 bg-semantic-accent animate-pulse ml-0.5 align-text-bottom" />
      </div>
    );
  }

  return (
    <div className="group/text relative px-3 py-2 rounded-lg bg-surface-code/40 dark:bg-surface-dim/40 prose dark:prose-invert prose-sm max-w-none">
      <pre className="whitespace-pre-wrap break-words text-sm text-text-primary">{text}</pre>
      <button
        onClick={() => copy(text)}
        className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover/text:opacity-100 hover:bg-surface-hover dark:hover:bg-surface-hover transition-all"
        title={copied ? t("common:copied") : t("chat:copyText")}
      >
        <Copy size={11} className={copied ? "text-status-success" : "text-text-tertiary"} />
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
    ? "text-text-secondary cursor-not-allowed"
    : variant === "warning"
      ? "text-status-warning/70 hover:text-status-warning hover:bg-status-warning/10"
      : variant === "info"
        ? "text-status-info/70 hover:text-status-info hover:bg-status-info/10"
        : "text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-dim";

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

import { memo, useCallback, useRef } from "react";
import { RotateCcw, Undo2, GitFork, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useRollbackStore } from "../../stores/use-rollback-store";
import { useForkDialogStore } from "../../stores/use-fork-dialog-store";
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";
import type { TreeEntry } from "../../../shared/modules/agent";
import type { ChatMessage, ContentBlock, SessionStatus } from "../../types";
import type { ModifiedFile } from "../../stores/use-rollback-store";
import { EMPTY_MSGS } from "./message-card-helpers";

const log = createLogger("chat");

const ActionBtn = memo(function ActionBtn({
  icon: Icon,
  title,
  onClick,
  active,
  activeClassName,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
  onClick?: () => void;
  active?: boolean;
  activeClassName?: string;
  disabled?: boolean;
}) {
  if (!onClick) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      title={title}
      disabled={disabled}
      className={`p-1 rounded transition-colors ${disabled ? "text-text-tertiary dark:text-text-secondary cursor-not-allowed" : active ? activeClassName : "text-text-tertiary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-secondary hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50"}`}
    >
      {disabled ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Icon className={`w-3.5 h-3.5 ${active ? "fill-current" : ""}`} />
      )}
    </button>
  );
});

export const HeaderActions = memo(function HeaderActions({
  message,
  isUserCard,
}: {
  message: ChatMessage;
  isUserCard?: boolean;
}) {
  const { t } = useTranslation("chat");
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const isSessionStreaming = useSessionStore(
    useCallback(
      (s: { sessionStatusMap: Record<string, SessionStatus> }) => {
        const status = sessionId ? s.sessionStatusMap[sessionId] : undefined;
        return status === "streaming" || status === "compacting" || status === "retrying";
      },
      [sessionId],
    ),
  );
  const pushNotification = useNotificationStore((s) => s.push);
  const rollingBackRef = useRef(false);

  const fetchTree = useCallback(async (): Promise<TreeEntry[] | null> => {
    if (!sessionId) {
      log.warn("fetchTree skipped: no sessionId");
      return null;
    }
    try {
      const tree = await apiClient.call("agent.getTree", { sessionId });
      const entries = tree.entries ?? [];
      log.info("fetchTree result", { sessionId, entryCount: entries.length });
      return entries;
    } catch (err) {
      log.error("fetchTree failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }, [sessionId]);

  const resolveEntryId = useCallback(
    async (treeEntries?: TreeEntry[] | null): Promise<string | null> => {
      if (message.entryId) {
        log.info("resolveEntryId: using message.entryId", { entryId: message.entryId });
        return message.entryId;
      }
      const entries = treeEntries ?? (await fetchTree());
      if (!entries || !sessionId) {
        log.warn("resolveEntryId failed: no entries or sessionId", {
          hasEntries: !!entries,
          sessionId,
        });
        return null;
      }
      const msgs = sessionId
        ? useChatStore.getState().messagesBySession[sessionId] || EMPTY_MSGS
        : EMPTY_MSGS;
      if (isUserCard) {
        const allUserMsgs = msgs.filter((m) => m.role === "user");
        const userMsgIdx = allUserMsgs.findIndex((m) => m.id === message.id);
        const userTreeEntries = entries.filter((e) => e.type === "message" && e.label === "user");
        log.info("resolveEntryId: user card matching", {
          userMsgIdx,
          userMsgCount: allUserMsgs.length,
          userTreeCount: userTreeEntries.length,
        });
        if (userMsgIdx !== -1 && userMsgIdx < userTreeEntries.length) {
          return userTreeEntries[userMsgIdx].id;
        }
        log.warn("resolveEntryId: user index out of range", {
          userMsgIdx,
          userTreeCount: userTreeEntries.length,
        });
        return null;
      }
      const allAssistantMsgs = msgs.filter((m) => m.role === "assistant");
      const assistantMsgIdx = allAssistantMsgs.findIndex((m) => m.id === message.id);
      const assistantTreeEntries = entries.filter(
        (e) => e.type === "message" && e.label === "assistant",
      );
      log.info("resolveEntryId: assistant card matching", {
        assistantMsgIdx,
        assistantMsgCount: allAssistantMsgs.length,
        assistantTreeCount: assistantTreeEntries.length,
      });
      if (assistantMsgIdx !== -1 && assistantMsgIdx < assistantTreeEntries.length) {
        return assistantTreeEntries[assistantMsgIdx].id;
      }
      log.warn("resolveEntryId: assistant index out of range", {
        assistantMsgIdx,
        assistantTreeCount: assistantTreeEntries.length,
      });
      return null;
    },
    [sessionId, message.id, message.entryId, isUserCard, fetchTree],
  );

  const findTurnBoundary = useCallback((entryId: string, entries: TreeEntry[]): string | null => {
    // The backend's navigateTree handles the parentId jump for all message types
    // (user, assistant, etc.), so the frontend just passes the clicked entryId directly.
    // However, if this is the FIRST user message entry in the tree, rolling back would
    // navigate to before any conversation content exists, effectively clearing everything.
    // Return null to trigger the first-message guard.
    const entry = entries.find((e) => e.id === entryId);
    if (entry && entry.type === "message" && entry.label === "user") {
      const userEntries = entries.filter((e) => e.type === "message" && e.label === "user");
      if (userEntries.length > 0 && userEntries[0].id === entryId) {
        return null;
      }
    }
    return entryId;
  }, []);

  const resolveRollbackTarget = useCallback(async (): Promise<{
    targetId: string;
    tree: TreeEntry[];
  } | null> => {
    if (!sessionId) {
      log.warn("resolveRollbackTarget: no sessionId");
      return null;
    }
    const tree = await fetchTree();
    if (!tree || tree.length === 0) {
      log.warn("resolveRollbackTarget: tree is empty", { treeLength: tree?.length ?? 0 });
      return null;
    }

    const entryId = await resolveEntryId(tree);
    if (!entryId) {
      log.warn("resolveRollbackTarget: resolveEntryId returned null", {
        messageId: message.id,
        isUserCard,
        treeSize: tree.length,
      });
      return null;
    }
    const targetId = findTurnBoundary(entryId, tree);
    if (!targetId) {
      log.warn("resolveRollbackTarget: findTurnBoundary returned null (first message?)", {
        entryId,
      });
      return null;
    }
    log.info("resolveRollbackTarget: success", { entryId, targetId });
    return targetId ? { targetId, tree } : null;
  }, [sessionId, fetchTree, resolveEntryId, findTurnBoundary]);

  const handleFork = useCallback(async () => {
    const tree = await fetchTree();
    const entryId = await resolveEntryId(tree);
    if (!sessionId || !entryId) return;
    useForkDialogStore.getState().openDialog({
      sessionId,
      entryId,
      source: "messageCard",
    });
  }, [sessionId, fetchTree, resolveEntryId]);

  const requestRollback = useCallback(
    async (mode: "message" | "withFiles") => {
      if (rollingBackRef.current) return;
      rollingBackRef.current = true;
      log.info("rollback requested", { sessionId, mode });
      try {
        if (!sessionId) {
          log.warn("rollback aborted: no active session");
          return;
        }

        const result = await resolveRollbackTarget();
        if (!result) {
          log.warn("rollback aborted: resolveRollbackTarget returned null", {
            sessionId,
            mode,
            messageId: message.id,
            hasEntryId: !!message.entryId,
            messagesCount: (useChatStore.getState().messagesBySession[sessionId ?? ""] ?? [])
              .length,
          });
          pushNotification({
            message: t("messageCard.rollbackFirstMessage"),
            level: "info",
          });
          return;
        }
        if (message.role === "user") {
          const currentInput = useChatStore.getState().inputText;
          if (currentInput.trim()) {
            const sid = useSessionStore.getState().activeSessionId;
            if (sid) {
              try {
                localStorage.setItem(`pi-draft:${sid}`, currentInput);
              } catch {
                /* ignore storage errors */
              }
            }
          }
          const userText = message.content
            .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
            .map((b) => b.text)
            .join("\n");
          if (userText) {
            useChatStore.getState().setInputText(userText);
          }
        }
        const emptyPreview = {
          restored: [] as string[],
          deleted: [] as string[],
          files: [] as never[],
          summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
        };
        const preview =
          mode === "withFiles"
            ? await (async () => {
                try {
                  // Let the backend resolve fromEntryId from toUserMsgEntryId.
                  // Previously the frontend set fromEntryId to the snapshot
                  // BEFORE the target turn, but getModifiedFiles uses inclusive
                  // semantics for fromEntryId — this included one extra turn's
                  // file changes.  By only passing toUserMsgEntryId the backend
                  // correctly resolves fromEntryId to the target turn's own
                  // snapshot.
                  const modResponse = await apiClient.call("agent.getModifiedFiles", {
                    sessionId,
                    toUserMsgEntryId: result.targetId ?? message.entryId ?? undefined,
                  });
                  log.info("rollback getModifiedFiles", {
                    sessionId,
                    targetId: result.targetId,
                    messageEntryId: message.entryId,
                    fileCount: Array.isArray(modResponse)
                      ? (modResponse as unknown[]).length
                      : ((modResponse as { files?: unknown[] }).files ?? []).length,
                    resolvedFromEntryId: Array.isArray(modResponse)
                      ? null
                      : (modResponse as { resolvedFromEntryId?: unknown }).resolvedFromEntryId,
                  });
                  // Defensive: handle both { files, resolvedFromEntryId } and raw array formats
                  const isArray = Array.isArray(modResponse);
                  const rawFiles = isArray
                    ? (modResponse as unknown[])
                    : ((modResponse as { files?: unknown[] }).files ?? []);
                  const resolvedFromEntryId = isArray
                    ? null
                    : ((modResponse as { resolvedFromEntryId?: string | null })
                        .resolvedFromEntryId ?? null);
                  const files: ModifiedFile[] = await Promise.all(
                    rawFiles.map(async (raw) => {
                      const f = raw as {
                        path: string;
                        status: "added" | "modified" | "deleted";
                        turnIndex: number;
                        entryId: string;
                      };
                      try {
                        // Compare rollback target (fromEntryId) against
                        // the LATEST file state (no toEntryId → backend uses
                        // lastCommittedTreeHash / working tree).
                        const diffResult = await apiClient.call("agent.getFileDiff", {
                          sessionId,
                          filePath: f.path,
                          fromEntryId: resolvedFromEntryId ?? undefined,
                        });
                        const diff = diffResult as {
                          oldContent?: string | null;
                          newContent?: string | null;
                          unifiedDiff?: string;
                        } | null;
                        if (diff) {
                          const oldLines = diff.oldContent?.split("\n").length ?? 0;
                          const newLines = diff.newContent?.split("\n").length ?? 0;
                          // Count actual added/removed lines from unifiedDiff for accuracy.
                          // unifiedDiff is oldContent→newContent (rollback-target→current),
                          // but rollback preview shows current→rollback-target (swapped),
                          // so we swap the counts: "+" lines (current has) → "removed",
                          // "-" lines (current lacks) → "added back".
                          const diffStr = diff.unifiedDiff ?? "";
                          const diffAdded = diffStr
                            .split("\n")
                            .filter((l) => l.startsWith("+") && !l.startsWith("++")).length;
                          const diffRemoved = diffStr
                            .split("\n")
                            .filter((l) => l.startsWith("-") && !l.startsWith("--")).length;
                          return {
                            path: f.path,
                            status: f.status,
                            turnIndex: f.turnIndex,
                            entryId: f.entryId,
                            details: diff.unifiedDiff ?? undefined,
                            oldContent: diff.oldContent,
                            newContent: diff.newContent,
                            // Rollback preview: "+" in unifiedDiff = lines in current
                            // that will disappear (removed); "-" = lines to be restored (added).
                            addedLines:
                              f.status === "deleted"
                                ? newLines
                                : f.status === "added"
                                  ? 0
                                  : diffRemoved,
                            removedLines:
                              f.status === "added"
                                ? newLines
                                : f.status === "deleted"
                                  ? oldLines
                                  : diffAdded,
                          };
                        }
                      } catch {
                        /* skip diff */
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
                  return {
                    restored,
                    deleted,
                    files,
                    summary: {
                      totalFiles: files.length,
                      added: files.filter((f) => f.status === "added").length,
                      modified: files.filter((f) => f.status === "modified").length,
                      deleted: deleted.length,
                    },
                  };
                } catch (err) {
                  log.warn("getModifiedFiles failed, using empty preview", {
                    err: err instanceof Error ? err.message : String(err),
                  });
                  return emptyPreview;
                }
              })()
            : emptyPreview;
        log.info("opening rollback overlay", {
          sessionId,
          mode,
          targetId: result.targetId,
          fileCount: preview.files.length,
        });
        useRollbackStore.getState().openRollback({ targetId: result.targetId, mode }, preview);
      } catch (err) {
        log.error("rollback request failed unexpectedly", {
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        rollingBackRef.current = false;
      }
    },
    [sessionId, resolveRollbackTarget, message.id, message.role, pushNotification],
  );

  return (
    <>
      <ActionBtn
        icon={GitFork}
        title={t("fork")}
        onClick={handleFork}
        disabled={isSessionStreaming}
      />
      <ActionBtn
        icon={Undo2}
        title={t("messageCard.rollbackMessage")}
        onClick={() => requestRollback("message")}
        disabled={rollingBackRef.current || isSessionStreaming}
      />
      <ActionBtn
        icon={RotateCcw}
        title={t("messageCard.rollbackMessageAndCode")}
        onClick={() => requestRollback("withFiles")}
        disabled={rollingBackRef.current || isSessionStreaming}
      />
    </>
  );
});

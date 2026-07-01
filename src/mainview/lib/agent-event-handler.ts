import type { ContentBlock, ChatMessage, TokenUsage, PermissionMeta } from "../types";
import type { SessionMeta } from "../types";
import type { AgentEvent } from "../../shared/modules/agent";
import type { AssistantMessage, Message, Usage } from "@dyyz1993/pi-ai";
import {
  getMemorySemanticTimestamp,
  insertChatMessageByDisplayOrder,
  useChatStore,
} from "../stores/use-chat-store";
import {
  getMemoryCustomDedupeKey as getChatMemoryCustomDedupeKey,
  getMemoryEntryScore,
} from "./memory-entry-dedupe";
import { useSessionStore, clearAgentStarted } from "../stores/use-session-store";
import { useSessionQueueStore } from "../stores/use-session-queue-store";
import { useMemoryStore } from "../stores/use-memory-store";
import { useStatusStore, type MCPServerInfo } from "../stores/use-status-store";
import { useRetryStore } from "../stores/use-retry-store";
import { useUIDialogStore } from "../stores/use-ui-dialog-store";
import { useChangeReviewStore } from "../stores/use-change-review-store";
import { useCompactionStore } from "../stores/use-compaction-store";
import { notificationGateway } from "./notification-gateway";
import { apiClient } from "./api-client";
import { batchMessageUpdate, flushNow } from "./message-batcher";
import { messageToChatMessage, extractTokenUsage } from "./message-mapper";
import { ALL_MEMORY_TYPE_KEYS } from "../components/chat/memory-config";
import { isBashBackgroundProcessType } from "../components/chat/bash-background-process";
import { createLogger } from "../../shared/lib/logger";
import {
  closeRunningToolExecutions,
  findMatchingToolExecution,
  formatToolArgs,
  hasRenderableContent,
  isDelayedTerminalMessageUpdate,
  isTerminalToolStatus,
  type ToolExecBlock,
} from "./agent-event-reconciler";

const log = createLogger("event-handler");

export const toolCallNameMap: Record<string, string> = {};
export const toolCallArgsMap: Record<string, string> = {};

// Track sessions where compaction_end was deferred due to active streaming.
// When agent_end fires for these sessions, a force reload is triggered to sync
// messages with the compacted JSONL data.
const compactionDeferredSessions = new Set<string>();
const compactionCompletionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MIN_COMPACTION_RUNNING_CARD_MS = 1800;

function clearCompactionCompletionTimer(sessionId: string): void {
  const timer = compactionCompletionTimers.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  compactionCompletionTimers.delete(sessionId);
}

function finishCompactionAfterMinimumVisibility(sessionId: string, finish: () => void): void {
  clearCompactionCompletionTimer(sessionId);
  const activity = useCompactionStore.getState().activitiesBySession[sessionId];
  const elapsed = activity?.status === "running" ? Date.now() - activity.startedAt : Infinity;
  const delay = Math.max(0, MIN_COMPACTION_RUNNING_CARD_MS - elapsed);

  if (delay <= 0) {
    finish();
    return;
  }

  const timer = setTimeout(() => {
    compactionCompletionTimers.delete(sessionId);
    finish();
  }, delay);
  compactionCompletionTimers.set(sessionId, timer);
}

const pendingPrefetchMap = new Map<
  string,
  Map<string, { agentEvent: AgentEvent; timer: ReturnType<typeof setTimeout> }>
>();
const memoryPrefetchDataBySession = new Map<string, Map<string, Record<string, unknown>>>();
const PREFETCH_FALLBACK_MS = 5000;

function refreshAuthoritativeContextUsage(sessionId: string): void {
  Promise.resolve(apiClient.call("agent.getContextUsage", { sessionId }))
    .then((usage) => {
      if (!usage) return;
      if (usage.tokens !== undefined || usage.contextWindow > 0) {
        const { contextWindow, ...rest } = usage;
        useSessionStore.getState().updateSessionContext(sessionId, {
          ...rest,
          ...(contextWindow > 0 ? { contextWindow } : {}),
        });
      }
    })
    .catch((err) => {
      log.warn("refreshAuthoritativeContextUsage failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
}

function setToolActive(sessionId: string, toolCallId: string, active: boolean): void {
  const chat = useChatStore.getState();
  if (typeof chat.setActiveToolCallIds !== "function") return;
  const current = chat.activeToolCallIdsBySession?.[sessionId];
  if (active) {
    const next = Array.from(new Set([...(current ?? []), toolCallId]));
    chat.setActiveToolCallIds(sessionId, next);
    return;
  }
  if (current === undefined) {
    chat.setActiveToolCallIds(sessionId, []);
    return;
  }
  chat.setActiveToolCallIds(
    sessionId,
    current.filter((id) => id !== toolCallId),
  );
}

export function buildTokenUsage(usage: Usage): { tokenUsage?: TokenUsage } {
  const result = extractTokenUsage(usage);
  return result ? { tokenUsage: result } : {};
}

/** Clean up module-level maps (toolCallNameMap, toolCallArgsMap, pendingPrefetchMap, etc.) for a session. */
export function cleanupEventHandlerMaps(sessionId: string): void {
  // Reset toolCallNameMap & toolCallArgsMap for this session
  const msgs = useChatStore.getState().messagesBySession[sessionId] || [];
  for (const msg of msgs) {
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "toolExecution") {
          delete toolCallNameMap[block.toolCallId];
          delete toolCallArgsMap[block.toolCallId];
        }
      }
    }
  }

  // Clean up pending prefetch entries and timers for this session
  const prefetchMap = pendingPrefetchMap.get(sessionId);
  if (prefetchMap) {
    for (const entry of prefetchMap.values()) {
      clearTimeout(entry.timer);
    }
    pendingPrefetchMap.delete(sessionId);
  }
  memoryPrefetchDataBySession.delete(sessionId);

  // Remove from compaction deferred set
  compactionDeferredSessions.delete(sessionId);
  clearCompactionCompletionTimer(sessionId);
  useCompactionStore.getState().clear(sessionId);
}

function replaceMsgAt(msgs: ChatMessage[], idx: number, replacement: ChatMessage): ChatMessage[] {
  const next = [...msgs];
  next[idx] = replacement;
  return next;
}

function getMemoryOperationId(data: unknown): string | undefined {
  const record = data as Record<string, unknown> | undefined;
  return typeof record?.operationId === "string" ? record.operationId : undefined;
}

function findTimedOutMemoryPrefetchIndex(msgs: ChatMessage[], operationId: string): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role !== "custom") continue;
    const block = msg.content[0];
    if (block?.type !== "custom" || block.customType !== "memory_prefetch") continue;
    const data = block.data as Record<string, unknown> | undefined;
    if (data?._timedOut === true && data.operationId === operationId) return i;
  }
  return -1;
}

function upsertMemoryCustomMessage(messages: ChatMessage[], customMsg: ChatMessage): ChatMessage[] {
  const block = customMsg.content[0];
  if (block?.type !== "custom") {
    return insertChatMessageByDisplayOrder(messages, customMsg);
  }

  const dedupeKey = getChatMemoryCustomDedupeKey(block.customType, block.data);
  if (!dedupeKey) {
    return insertChatMessageByDisplayOrder(messages, customMsg);
  }

  const existingSameKey = messages.find((message) => {
    if (message.role !== "custom") return false;
    const candidateBlock = message.content[0];
    if (candidateBlock?.type !== "custom") return false;
    return (
      getChatMemoryCustomDedupeKey(candidateBlock.customType, candidateBlock.data) === dedupeKey
    );
  });
  if (existingSameKey) {
    const existingBlock = existingSameKey.content[0];
    const existingScore =
      existingBlock?.type === "custom"
        ? getMemoryEntryScore(existingBlock.customType, existingBlock.data)
        : 0;
    const nextScore = getMemoryEntryScore(block.customType, block.data);
    if (nextScore < existingScore) return messages;
  }

  const filtered = messages.filter((message) => {
    if (message.role !== "custom") return true;
    const candidateBlock = message.content[0];
    if (candidateBlock?.type !== "custom") return true;
    return (
      getChatMemoryCustomDedupeKey(candidateBlock.customType, candidateBlock.data) !== dedupeKey
    );
  });

  return insertChatMessageByDisplayOrder(filtered, customMsg);
}

function mergePrefetchResultData(
  resultData: unknown,
  prefetchData: Record<string, unknown> | undefined,
): unknown {
  const prefetchOccurredAt =
    typeof prefetchData?.occurredAt === "number" && Number.isFinite(prefetchData.occurredAt)
      ? prefetchData.occurredAt
      : undefined;
  return {
    ...(typeof resultData === "object" && resultData !== null
      ? (resultData as Record<string, unknown>)
      : {}),
    _prefetchQuery: typeof prefetchData?.query === "string" ? prefetchData.query : "",
    _prefetchAvailableFiles:
      typeof prefetchData?.availableFiles === "number" ? prefetchData.availableFiles : 0,
    ...(prefetchOccurredAt !== undefined ? { _prefetchOccurredAt: prefetchOccurredAt } : {}),
  };
}

function setMemoryPrefetchData(
  sessionId: string,
  operationId: string,
  data: Record<string, unknown>,
): void {
  let sessionMap = memoryPrefetchDataBySession.get(sessionId);
  if (!sessionMap) {
    sessionMap = new Map();
    memoryPrefetchDataBySession.set(sessionId, sessionMap);
  }
  sessionMap.set(operationId, data);
}

function getMemoryPrefetchData(
  sessionId: string,
  operationId: string | undefined,
): Record<string, unknown> | undefined {
  if (!operationId) return undefined;
  return memoryPrefetchDataBySession.get(sessionId)?.get(operationId);
}

function scheduleEmptyStreamingReload(sessionId: string, messageId: string): void {
  setTimeout(() => {
    const chat = useChatStore.getState();
    const current = chat.messagesBySession[sessionId] || [];
    const last = current[current.length - 1];
    if (
      !last ||
      last.id !== messageId ||
      last.role !== "assistant" ||
      last.isStreaming !== true ||
      hasRenderableContent(last)
    ) {
      return;
    }

    chat.loadSessionMessages(sessionId, { force: true, preserveStreaming: false }).catch((err) => {
      log.warn("empty streaming recovery reload failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }, 750);
}

function isToolUseStopReason(stopReason: string | null | undefined): boolean {
  return stopReason === "toolUse" || stopReason === "tool_use";
}

function isRecoverableBoundaryStopReason(stopReason: string | null | undefined): boolean {
  return (
    stopReason === "stop" ||
    stopReason === "endTurn" ||
    stopReason === "end_turn" ||
    isToolUseStopReason(stopReason)
  );
}

function isErrorStopReason(stopReason: string | null | undefined): boolean {
  return stopReason === "error";
}

function buildEmptyTurnErrorMessage(afterMessage?: ChatMessage): ChatMessage {
  return {
    id: `error_empty_turn_${Date.now()}`,
    role: "error",
    content: [
      {
        type: "text",
        text:
          "Agent 未返回有效响应\n" +
          "本轮 Agent 已结束，但没有产生可展示的 assistant 内容。可能是模型/API 返回为空、模型配置错误、网络中断，或进程在生成前退出。",
      },
    ],
    timestamp: Math.max(Date.now(), (afterMessage?.timestamp ?? 0) + 1),
    stopReason: "empty_response",
    isStreaming: false,
  };
}

function hasAssistantContentSinceLastUser(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") return false;
    if (msg.role === "assistant" && hasRenderableContent(msg)) return true;
  }
  return false;
}

function findToolExecutionPosition(
  messages: ChatMessage[],
  toolCallId: string,
): { msgIndex: number; blockIndex: number; block: ToolExecBlock } | null {
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi];
    if (msg.role !== "assistant") continue;
    const blockIndex = msg.content.findIndex(
      (block): block is ToolExecBlock =>
        block.type === "toolExecution" && block.toolCallId === toolCallId,
    );
    if (blockIndex >= 0) {
      return {
        msgIndex: mi,
        blockIndex,
        block: msg.content[blockIndex] as ToolExecBlock,
      };
    }
  }
  return null;
}

/**
 * Process tool_execution_start / tool_execution_update events directly,
 * bypassing the message batcher. The batcher coalesces by session which
 * causes parallel tool events in the same frame to replace each other.
 * Tool events are low-frequency, so processing them immediately has no
 * performance impact and ensures no events are lost.
 */
function applyToolExecutionEvent(
  sessionId: string,
  event: AgentEvent,
  toolCallId: string,
  toolName: string,
): void {
  if (event.type !== "tool_execution_start" && event.type !== "tool_execution_update") return;
  const chat = useChatStore.getState();
  const existing = chat.messagesBySession[sessionId] || [];

  // --- Branch 1: block found in a non-last message ---
  const exactPosition = findToolExecutionPosition(existing, toolCallId);
  if (exactPosition && exactPosition.msgIndex !== existing.length - 1) {
    if (event.type === "tool_execution_start" && isTerminalToolStatus(exactPosition.block.status)) {
      return;
    }
    const msg = existing[exactPosition.msgIndex];
    const blocks = [...msg.content];
    if (event.type === "tool_execution_start") {
      const { args: argsStr, timeout, description } = formatToolArgs(event.args);
      blocks[exactPosition.blockIndex] = {
        ...exactPosition.block,
        toolName:
          exactPosition.block.toolName === "unknown" ? toolName : exactPosition.block.toolName,
        args: argsStr || exactPosition.block.args,
        status: isTerminalToolStatus(exactPosition.block.status)
          ? exactPosition.block.status
          : "running",
        timeout: timeout ?? exactPosition.block.timeout,
        description: description ?? exactPosition.block.description,
        startedAt: exactPosition.block.startedAt ?? event.timestamp ?? Date.now(),
      };
    } else {
      const partial = event.partialResult as
        | { content?: Array<{ type: string; text?: string }> }
        | undefined;
      let output = "";
      if (partial && Array.isArray(partial.content)) {
        output = partial.content.map((c) => c.text ?? "").join("");
      }
      blocks[exactPosition.blockIndex] = {
        ...exactPosition.block,
        output: isTerminalToolStatus(exactPosition.block.status)
          ? exactPosition.block.output && exactPosition.block.output.length > 0
            ? exactPosition.block.output
            : output
          : output,
        status: isTerminalToolStatus(exactPosition.block.status)
          ? exactPosition.block.status
          : "running",
      };
    }
    const updated = [...existing];
    updated[exactPosition.msgIndex] = { ...msg, content: blocks };
    chat.setMessagesForSession(sessionId, updated, { bumpStreamVersion: true });
    return;
  }

  // --- Branch 2: operate on the last assistant message ---
  const lastMsg = existing[existing.length - 1];
  if (!lastMsg || lastMsg.role !== "assistant") return;

  const blocks = [...lastMsg.content];
  const targetIdx = blocks.findIndex(
    (b): b is ToolExecBlock => b.type === "toolExecution" && b.toolCallId === toolCallId,
  );

  if (event.type === "tool_execution_start") {
    const { args: argsStr, timeout, description } = formatToolArgs(event.args);
    const matchedByExactId = targetIdx >= 0;
    let resolvedTargetIdx = matchedByExactId
      ? targetIdx
      : findMatchingToolExecution(blocks, toolName, argsStr, { includeTerminal: true });

    // Don't reuse a running block from a different tool_execution_start
    // — that's a parallel execution, not a re-delivery. But DO allow
    // matching blocks created by message_update (different ID source).
    if (!matchedByExactId && resolvedTargetIdx >= 0) {
      const matched = blocks[resolvedTargetIdx] as ToolExecBlock;
      if (
        matched.status === "running" &&
        matched.toolCallId !== toolCallId &&
        toolCallNameMap[matched.toolCallId]
      ) {
        resolvedTargetIdx = -1;
      }
    }
    if (resolvedTargetIdx >= 0) {
      const prev = blocks[resolvedTargetIdx] as ToolExecBlock;
      if (isTerminalToolStatus(prev.status)) {
        blocks[resolvedTargetIdx] = {
          ...prev,
          toolCallId: matchedByExactId ? toolCallId : prev.toolCallId,
          toolName: prev.toolName === "unknown" ? toolName : prev.toolName,
          args: argsStr || prev.args,
          timeout: timeout ?? prev.timeout,
          description: description ?? prev.description,
        };
      } else {
        blocks[resolvedTargetIdx] = {
          type: "toolExecution",
          toolCallId,
          toolName,
          args: argsStr,
          status: "running",
          timeout,
          startedAt: event.timestamp ?? Date.now(),
          description,
        };
      }
    } else {
      blocks.push({
        type: "toolExecution",
        toolCallId,
        toolName,
        args: argsStr,
        status: "running",
        timeout,
        startedAt: event.timestamp ?? Date.now(),
        description,
      });
    }
  } else if (event.type === "tool_execution_update") {
    const partial = event.partialResult as
      | { content?: Array<{ type: string; text?: string }> }
      | undefined;
    let output = "";
    if (partial) {
      if (Array.isArray(partial.content)) {
        output = partial.content.map((c) => c.text ?? "").join("");
      }
    }
    if (targetIdx >= 0) {
      const prev = blocks[targetIdx] as ToolExecBlock;
      const previousOutput = prev.output;
      // Preserve the bash-streamed output when the agent's tool_execution_update
      // arrives with empty partialResult. This happens right after a page refresh
      // while the agent process is still reconnecting — the bash process is
      // already streaming output (visible in the bash sidebar), but the agent
      // hasn't relayed any of it yet. Without this guard the chat's "Output"
      // section would be wiped to empty on every agent update.
      const preservedOutput = output.length > 0 || !previousOutput ? output : previousOutput;
      blocks[targetIdx] = {
        ...prev,
        output: isTerminalToolStatus(prev.status)
          ? previousOutput && previousOutput.length > 0
            ? previousOutput
            : output
          : preservedOutput,
        status: isTerminalToolStatus(prev.status) ? prev.status : "running",
      };
    } else {
      // Block not found — batcher may have swallowed the start event.
      // Create a running block so streaming output is visible.
      blocks.push({
        type: "toolExecution",
        toolCallId,
        toolName,
        args: toolCallArgsMap[toolCallId] || "",
        status: "running",
        output,
        startedAt: Date.now(),
      });
    }
  }

  const updated = [...existing];
  updated[existing.length - 1] = { ...lastMsg, content: blocks };
  chat.setMessagesForSession(sessionId, updated, { bumpStreamVersion: true });
}

function applyToolResultMessage(sessionId: string, rawMessage: unknown): boolean {
  const msg = messageToChatMessage(rawMessage as Message, undefined, toolCallNameMap);
  if (!msg || msg.role !== "toolResult") return false;

  const resultBlock = msg.content.find(
    (block): block is Extract<ContentBlock, { type: "toolResult" }> => block.type === "toolResult",
  );
  if (!resultBlock) return false;

  const toolCallId = resultBlock.toolCallId;
  setToolActive(sessionId, toolCallId, false);

  const chat = useChatStore.getState();
  const existing = chat.messagesBySession[sessionId] || [];
  const endedAt = (rawMessage as { timestamp?: number } | undefined)?.timestamp ?? Date.now();
  const nextStatus = resultBlock.isError ? "error" : "done";

  for (let i = existing.length - 1; i >= 0; i--) {
    const current = existing[i];
    if (current.role !== "assistant") continue;

    const toolIdx = current.content.findIndex(
      (block) =>
        (block.type === "toolExecution" && block.toolCallId === toolCallId) ||
        (block.type === "toolCall" && block.id === toolCallId),
    );
    if (toolIdx < 0) continue;

    const blocks = [...current.content];
    const previous = blocks[toolIdx];
    if (previous.type === "toolExecution") {
      blocks[toolIdx] = {
        ...previous,
        toolName:
          previous.toolName === "unknown" ? (resultBlock.toolName ?? "unknown") : previous.toolName,
        status: nextStatus,
        output: resultBlock.content,
        details: resultBlock.details,
        endedAt,
      };
    } else if (previous.type === "toolCall") {
      const { args } = formatToolArgs(previous.input);
      blocks[toolIdx] = {
        type: "toolExecution",
        toolCallId,
        toolName: resultBlock.toolName ?? previous.name ?? "unknown",
        args: resultBlock.args ?? args,
        status: nextStatus,
        output: resultBlock.content,
        details: resultBlock.details,
        endedAt,
      };
    } else {
      continue;
    }

    const updated = [...existing];
    updated[i] = { ...current, content: blocks };
    chat.setMessagesForSession(sessionId, updated, { bumpStreamVersion: true });
    return true;
  }

  for (let i = existing.length - 1; i >= 0; i--) {
    const current = existing[i];
    if (current.role !== "assistant") continue;
    const fallbackBlock: Extract<ContentBlock, { type: "toolExecution" }> = {
      type: "toolExecution",
      toolCallId,
      toolName: resultBlock.toolName ?? toolCallNameMap[toolCallId] ?? "unknown",
      args: resultBlock.args ?? toolCallArgsMap[toolCallId] ?? "",
      status: nextStatus,
      output: resultBlock.content,
      details: resultBlock.details,
      endedAt,
    };
    const updated = [...existing];
    updated[i] = { ...current, content: [...current.content, fallbackBlock] };
    chat.setMessagesForSession(sessionId, updated, { bumpStreamVersion: true });
    return true;
  }

  return true;
}

export function handleAgentEvent(sessionId: string, event: AgentEvent) {
  const storeGet = () => useSessionStore.getState();

  if ((event as { type?: string }).type === "test_clear_all") {
    useUIDialogStore.getState().clearPendingBySession(sessionId);
    return;
  }

  if (event.type === "agent_start") {
    storeGet().updateSessionStatus(sessionId, "streaming");
    // Bump updatedAt so the session bubbles to the top of the sidebar list
    const now = Date.now();
    const { sessionsByProject } = storeGet();
    for (const [projectPath, sessions] of Object.entries(sessionsByProject)) {
      const idx = sessions.findIndex((sess) => sess.sessionId === sessionId);
      if (idx !== -1) {
        const updated = [...sessions];
        updated[idx] = { ...updated[idx], updatedAt: now };
        useSessionStore.setState((prev) => ({
          sessionsByProject: { ...prev.sessionsByProject, [projectPath]: updated },
        }));
        break;
      }
    }
    return;
  }

  if (event.type === "agent_end") {
    clearAgentStarted(sessionId);
    storeGet().updateSessionStatus(sessionId, "idle");
    useUIDialogStore.getState().clearPendingBySession(sessionId);
    useChangeReviewStore.getState().fetchPending();
    useSessionQueueStore.getState().clearSessionQueue(sessionId);
    const allSessions = storeGet().sessionsByProject;
    for (const sessList of Object.values(allSessions)) {
      const session = sessList.find((s) => s.sessionId === sessionId);
      if (session) {
        useMemoryStore.getState().loadFiles(session.projectPath, sessionId);
        break;
      }
    }

    // If compaction was deferred during streaming, force reload now that
    // streaming has ended to sync the store with the compacted JSONL data.
    if (compactionDeferredSessions.has(sessionId)) {
      compactionDeferredSessions.delete(sessionId);
      log.info("agent_end → deferred compaction reload", { sessionId });
      void useChatStore
        .getState()
        .loadSessionMessages(sessionId, { force: true })
        .finally(() => {
          useCompactionStore.getState().clear(sessionId);
        });
    }

    const crashReason = (event as { reason?: string }).reason;
    // 先 flush 批处理队列，确保待处理的 message_update 已写入 store。
    // 若 agent 异常退出（crash）没有 message_end，最后一批 message_update
    // 可能仍滞留在批处理队列中，否则下方读取的 msgs 会是过期数据。
    flushNow();
    const chat = useChatStore.getState();
    if (typeof chat.setActiveToolCallIds === "function") {
      chat.setActiveToolCallIds(sessionId, []);
    }
    const msgs = chat.messagesBySession[sessionId] || [];
    const fallbackToolStatus = crashReason ? "error" : "done";
    let changed = false;
    const closedMsgs = msgs.map((msg) => {
      if (msg.role !== "assistant") return msg;
      const content = closeRunningToolExecutions(msg.content, fallbackToolStatus);
      const contentChanged = content !== msg.content;
      const wasStreaming = msg.isStreaming === true;
      if (!contentChanged && !wasStreaming) return msg;
      changed = true;
      return { ...msg, content, isStreaming: false };
    });
    if (changed) {
      chat.setMessagesForSession(sessionId, closedMsgs);
    }

    if (crashReason) {
      notificationGateway.emit({
        type: "session_complete",
        sessionId,
        title: "Agent 进程异常退出",
        body: crashReason,
        level: "error",
      });
    } else {
      const currentMsgs = changed ? closedMsgs : msgs;
      const lastMsg = currentMsgs[currentMsgs.length - 1];
      const lastIsUser = lastMsg && (lastMsg.role === "user" || lastMsg.role === "custom");

      if (lastIsUser) {
        chat.setMessagesForSession(sessionId, [
          ...currentMsgs,
          buildEmptyTurnErrorMessage(lastMsg),
        ]);
        notificationGateway.emit({
          type: "session_error",
          sessionId,
          title: "响应失败",
          body: "Agent 未返回任何响应，请检查模型配置或重试",
          level: "error",
        });
      } else {
        notificationGateway.emit({
          type: "session_complete",
          sessionId,
          title: "会话完成",
          body: `会话 ${sessionId.slice(0, 8)}... 执行完毕`,
          level: "info",
        });
      }
    }
    return;
  }

  if (event.type === "compaction_start") {
    clearCompactionCompletionTimer(sessionId);
    useCompactionStore.getState().markRunning(sessionId, event.reason);
    storeGet().updateSessionStatus(sessionId, "compacting");
    return;
  }

  if (event.type === "compaction_end") {
    log.info("compaction_end → force reload", { sessionId });
    refreshAuthoritativeContextUsage(sessionId);

    finishCompactionAfterMinimumVisibility(sessionId, () => {
      if (event.aborted || (event.reason && event.reason !== "success")) {
        const errMsg = event.reason ?? "压缩失败";
        useCompactionStore
          .getState()
          .markFinished(sessionId, event.aborted ? "aborted" : "failed", errMsg);
        notificationGateway.emit({
          type: "session_error",
          sessionId,
          title: "上下文压缩失败",
          body: errMsg,
          level: "warning",
        });
      } else {
        useCompactionStore.getState().markFinished(sessionId, "completed", event.reason);
      }

      // ❌ 不再强制切到 idle，保持当前状态（streaming 或其他）
      const chatState = useChatStore.getState();
      const currentMsgs = chatState.messagesBySession[sessionId] || [];
      const isActivelyStreaming = currentMsgs.some(
        (m) => m.role === "assistant" && m.isStreaming === true,
      );
      if (isActivelyStreaming) {
        // Defer the reload: agent_end will trigger it once streaming finishes.
        compactionDeferredSessions.add(sessionId);
        log.info("compaction_end → session streaming, deferred reload to agent_end", {
          sessionId,
        });
      } else {
        void chatState.loadSessionMessages(sessionId, { force: true }).finally(() => {
          useCompactionStore.getState().clear(sessionId);
        });
        storeGet().updateSessionStatus(sessionId, "idle");
      }
    });
    return;
  }

  if (event.type === "auto_retry_start") {
    storeGet().updateSessionStatus(sessionId, "retrying");
    useRetryStore.getState().startRetry(sessionId, {
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      delayMs: event.delayMs,
      errorMessage: event.errorMessage,
    });
    notificationGateway.emit({
      type: "retry_start",
      sessionId,
      title: "自动重试",
      body: `第 ${event.attempt}/${event.maxAttempts} 次重试`,
      level: "warning",
    });
    return;
  }

  if (event.type === "auto_retry_end") {
    useRetryStore.getState().endRetry(sessionId);
    notificationGateway.emit({
      type: event.success ? "retry_success" : "retry_failed",
      sessionId,
      title: event.success ? "重试成功" : "重试失败",
      body: event.success ? "会话已恢复执行" : (event.finalError ?? "已达最大重试次数"),
      level: event.success ? "info" : "error",
    });
    const current = storeGet().sessionStatusMap[sessionId];
    if (current === "retrying") {
      storeGet().updateSessionStatus(sessionId, "streaming");
    }
    return;
  }

  if (event.type === "extension_llm_error") {
    const errMsg = event.error || "Unknown error";
    notificationGateway.emit({
      type: "extension_llm_error",
      sessionId,
      title: "LLM 服务异常",
      body: errMsg.length > 100 ? `${errMsg.slice(0, 100)}...` : errMsg,
      level: "warning",
    });
    return;
  }

  if (event.type === "extension_ui_request") {
    const INTERACTIVE = new Set(["askUserQuestion", "confirm", "input", "select", "editor"]);
    const method = event.method;
    const id = event.id;
    if (!id || !method) return;

    if (INTERACTIVE.has(method)) {
      useUIDialogStore.getState().registerUIRequest({
        requestId: id,
        sessionId,
        method: method as "askUserQuestion" | "confirm" | "input" | "select" | "editor",
        title: event.title,
        message: event.message,
        options: event.options,
        questions: event.questions,
        multiple: event.multiple,
        placeholder: event.placeholder,
        prefill: event.prefill,
        timeout: event.timeout,
        toolCallId: event.toolCallId,
        confirmText: event.confirmText,
        cancelText: event.cancelText,
        hookMeta: (
          event as {
            hookMeta?: {
              toolName: string;
              matcher: string;
              description?: string;
              command?: string;
              hookCommand?: string;
              eventName?: string;
              source?: string;
              reason: string;
              confirmText?: string;
              cancelText?: string;
            };
          }
        ).hookMeta,
        permissionMeta: (event as { permissionMeta?: PermissionMeta }).permissionMeta,
      });

      storeGet().updateSessionStatus(sessionId, "permission");
      notificationGateway.emit({
        type: "permission_request",
        sessionId,
        title: "权限请求",
        body: event.title ?? "Agent 需要你的确认",
        level: "warning",
        data: { requestId: id },
      });
    }

    return;
  }

  if (event.type === "extension_ui_resolved") {
    const id = (event as { id?: string }).id;
    const reason = (event as { reason?: string }).reason ?? "responded";
    if (id) {
      useUIDialogStore
        .getState()
        .resolveFromRemote(id, reason as "responded" | "timeout" | "aborted");
    }
    return;
  }

  if (event.type === "message_start") {
    const raw = event.message;
    const msgObj = typeof raw === "object" && raw !== null ? raw : null;
    const role: string =
      msgObj && "role" in msgObj && typeof msgObj.role === "string" ? msgObj.role : "";

    if (role === "toolResult") {
      applyToolResultMessage(sessionId, raw);
      return;
    }

    if (role === "custom") {
      if (!msgObj) return;
      if ("display" in msgObj && msgObj.display === false) return;
      const customType =
        "customType" in msgObj && typeof msgObj.customType === "string"
          ? msgObj.customType
          : "unknown";

      const data: Record<string, unknown> =
        "details" in msgObj && typeof msgObj.details === "object" && msgObj.details !== null
          ? (msgObj.details as Record<string, unknown>)
          : "data" in msgObj && typeof msgObj.data === "object" && msgObj.data !== null
            ? (msgObj.data as Record<string, unknown>)
            : {};

      const chat = useChatStore.getState();
      const existing = chat.messagesBySession[sessionId] || [];
      const customMsg: ChatMessage = {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "custom",
        content: [{ type: "custom", customType, data }],
        timestamp: Date.now(),
      };
      chat.setMessagesForSession(sessionId, [...existing, customMsg]);
      return;
    }

    if (role === "user") {
      const msg = messageToChatMessage(raw as Message);
      if (msg) {
        log.info("message_start user → adding to store", { sessionId });
        const chat = useChatStore.getState();
        const existing = chat.messagesBySession[sessionId] || [];
        const localIdx = existing.findIndex((m) => m.role === "user" && m._local);
        if (localIdx >= 0) {
          const updated = [...existing];
          const localMsg = existing[localIdx];
          const serverHasImages = msg.content.some((b) => b.type === "imageBlock");
          const localHasImages = localMsg.content.some((b) => b.type === "imageBlock");
          if (!serverHasImages && localHasImages) {
            const textBlocks = msg.content.filter((b) => b.type !== "imageBlock");
            const imageBlocks = localMsg.content.filter((b) => b.type === "imageBlock");
            updated[localIdx] = { ...msg, content: [...textBlocks, ...imageBlocks] };
          } else {
            updated[localIdx] = { ...msg };
          }
          chat.setMessagesForSession(sessionId, updated);
        } else {
          chat.setMessagesForSession(sessionId, [...existing, msg]);
        }
      }
      return;
    }

    if (role !== "assistant") return;

    const msg = messageToChatMessage(raw as Message, undefined, toolCallNameMap);

    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    const lastMsg = existing[existing.length - 1];

    if (lastMsg && lastMsg.role === "assistant" && lastMsg.isStreaming === true) {
      const content = msg
        ? msg.content.map((b) => {
            if (b.type === "toolCall") {
              const { args } = formatToolArgs(b.input);
              return {
                type: "toolExecution" as const,
                toolCallId: b.id,
                toolName: b.name,
                args,
                status: "running" as const,
              };
            }
            return b;
          })
        : lastMsg.content;
      chat.setMessagesForSession(sessionId, [
        ...existing.slice(0, -1),
        { ...lastMsg, content, isStreaming: true },
      ]);
    } else if (msg) {
      msg.content = msg.content.map((b) => {
        if (b.type === "toolCall") {
          const { args } = formatToolArgs(b.input);
          return {
            type: "toolExecution" as const,
            toolCallId: b.id,
            toolName: b.name,
            args,
            status: "running" as const,
          };
        }
        return b;
      });
      chat.setMessagesForSession(sessionId, [...existing, { ...msg, isStreaming: true }]);
    } else {
      chat.setMessagesForSession(sessionId, [
        ...existing,
        {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "assistant",
          content: [],
          timestamp: Date.now(),
          isStreaming: true,
        },
      ]);
    }
    return;
  }

  if (event.type === "message_update") {
    const message = event.message as AssistantMessage;
    const incoming = message.content;
    const existingBeforeUpdate = useChatStore.getState().messagesBySession[sessionId] || [];
    if (isDelayedTerminalMessageUpdate(existingBeforeUpdate, incoming)) return;

    if (storeGet().sessionStatusMap[sessionId] !== "streaming") {
      storeGet().updateSessionStatus(sessionId, "streaming");
    }
    batchMessageUpdate(sessionId, () => {
      const chat = useChatStore.getState();
      const existing = chat.messagesBySession[sessionId] || [];
      if (!incoming || !Array.isArray(incoming)) return;

      // Search backwards for the last assistant message (step_snapshot and
      // other custom entries may be appended after it).
      let lastAssistantIdx = -1;
      for (let i = existing.length - 1; i >= 0; i--) {
        if (existing[i].role === "assistant") {
          lastAssistantIdx = i;
          break;
        }
      }
      const lastAssistant = lastAssistantIdx >= 0 ? existing[lastAssistantIdx] : null;

      if (!lastAssistant || !lastAssistant.isStreaming) {
        // Session already ended – a late message_update should not
        // re-introduce an isStreaming:true message.
        const curStatus = useSessionStore.getState().sessionStatusMap[sessionId];
        if (curStatus === "idle" || curStatus === "permission") {
          return;
        }
        const synthMsg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "assistant",
          content: [],
          timestamp: Date.now(),
          isStreaming: true,
        };
        chat.setMessagesForSession(sessionId, [...existing, synthMsg]);
      }

      const currentMsgs = chat.messagesBySession[sessionId] || [];
      // Search backwards for the streaming assistant (same pattern as above).
      let currentAssistant: ChatMessage | null = null;
      let currentAssistantIdx = -1;
      for (let i = currentMsgs.length - 1; i >= 0; i--) {
        if (currentMsgs[i].role === "assistant") {
          currentAssistant = currentMsgs[i];
          currentAssistantIdx = i;
          break;
        }
      }

      const preservedToolExecs = (currentAssistant?.content ?? []).filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      );
      const execByCallId = new Map<string, Extract<ContentBlock, { type: "toolExecution" }>>();
      for (const exec of preservedToolExecs) {
        execByCallId.set(exec.toolCallId, exec);
      }
      const usedExecs = new Set<string>();

      const orderedBlocks: ContentBlock[] = [];

      for (const block of incoming) {
        if (block.type === "toolCall" && block.id) {
          const { args: newArgs, timeout, description } = formatToolArgs(block.arguments);
          const semanticIdx = findMatchingToolExecution(preservedToolExecs, block.name, newArgs, {
            includeTerminal: true,
          });
          const exec = execByCallId.get(block.id) ?? preservedToolExecs[semanticIdx];
          if (exec) {
            orderedBlocks.push({
              ...exec,
              toolName: exec.toolName === "unknown" ? block.name : exec.toolName,
              args: newArgs || exec.args,
              timeout: timeout ?? exec.timeout,
              description: description ?? exec.description,
            });
            usedExecs.add(exec.toolCallId);
          } else {
            const toolName = block.name;
            log.warn("[message_update] creating NEW running block (no existing match)", {
              sessionId,
              toolCallId: block.id,
              toolName,
              preservedCount: preservedToolExecs.length,
              preservedIds: preservedToolExecs.map((e) => e.toolCallId),
            });
            orderedBlocks.push({
              type: "toolExecution",
              toolCallId: block.id,
              toolName,
              args: newArgs,
              status: "running",
            });
            usedExecs.add(block.id);
          }
        } else if (block.type === "text") {
          orderedBlocks.push(block);
        } else if (block.type === "thinking") {
          orderedBlocks.push(block);
        }
      }

      const preservedBlocks = preservedToolExecs.filter((exec) => !usedExecs.has(exec.toolCallId));

      if (!currentAssistant) return;

      chat.setMessagesForSession(
        sessionId,
        replaceMsgAt(currentMsgs, currentAssistantIdx, {
          ...currentAssistant,
          content: [...preservedBlocks, ...orderedBlocks],
          ...buildTokenUsage(message.usage),
          ...(message.stopReason ? { stopReason: message.stopReason } : {}),
        }),
        { bumpStreamVersion: true, streamingFastPath: true },
      );
    });
    return;
  }

  if (event.type === "message_end") {
    const entryId = (event as { entryId?: string }).entryId;
    const message = event.message as Message;
    const role = message.role;

    if (role === "toolResult") {
      applyToolResultMessage(sessionId, message);
      return;
    }

    if (role === "user" && entryId) {
      const chat = useChatStore.getState();
      const existing = chat.messagesBySession[sessionId] || [];
      const userMsg = existing.find((m) => m.role === "user" && !m.entryId);
      if (userMsg) {
        chat.setMessagesForSession(
          sessionId,
          existing.map((m) => (m.id === userMsg.id ? { ...m, entryId, _local: false } : m)),
        );
      }
      return;
    }

    if (role !== "assistant") return;

    // 在读取 store 之前，先 flush 批处理队列中待处理的 message_update。
    // 最后一批 message_update（携带最终累积内容）和 message_end 经常落在同一帧
    // （~16ms）内到达。若不先 flush，下方捕获的 lastMsg/existing 会指向 flush
    // 之前的状态，本处理器末尾的 setMessagesForSession 会用过期内容把刚 flush
    // 进 store 的最终内容覆盖掉，导致助手消息显示不完整/被截断。
    flushNow();

    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    // Find the last assistant message (may not be the array's last element if
    // custom entries like step_snapshot were appended after it).
    let lastMsg: ChatMessage | undefined;
    let lastMsgIdx = -1;
    for (let i = existing.length - 1; i >= 0; i--) {
      if (existing[i].role === "assistant") {
        lastMsg = existing[i];
        lastMsgIdx = i;
        break;
      }
    }
    if (!lastMsg) return;

    const assistantMsg = message as AssistantMessage;

    refreshAuthoritativeContextUsage(sessionId);

    const hasContent = hasRenderableContent(lastMsg);

    // During streaming, message_end may arrive before replayed message_update events
    // populate the content. Prefer the final message payload if it already has
    // content; otherwise schedule a reload so the empty streaming bubble does
    // not remain stuck forever.
    if (!hasContent && storeGet().sessionStatusMap[sessionId] === "streaming") {
      const finalMsg = messageToChatMessage(message, entryId, toolCallNameMap);
      if (finalMsg && hasRenderableContent(finalMsg)) {
        chat.setMessagesForSession(
          sessionId,
          replaceMsgAt(existing, lastMsgIdx, {
            ...lastMsg,
            content: finalMsg.content,
            isStreaming: false,
            stopReason: assistantMsg.stopReason ?? lastMsg.stopReason ?? null,
            provider: assistantMsg.api ?? lastMsg.provider,
            model: assistantMsg.model ?? lastMsg.model,
            ...buildTokenUsage(assistantMsg.usage),
            entryId,
          }),
        );
      } else {
        scheduleEmptyStreamingReload(sessionId, lastMsg.id);
      }
      return;
    }

    if (!hasContent) {
      const priorMessages = [...existing.slice(0, lastMsgIdx), ...existing.slice(lastMsgIdx + 1)];
      const hasPriorAssistantContent = hasAssistantContentSinceLastUser(priorMessages);
      const stopReason = assistantMsg.stopReason ?? lastMsg.stopReason ?? null;

      if (hasPriorAssistantContent || isRecoverableBoundaryStopReason(stopReason)) {
        chat.setMessagesForSession(sessionId, priorMessages);
        chat
          .loadSessionMessages(sessionId, { force: true, preserveStreaming: false })
          .catch((err) => {
            log.warn("empty assistant boundary reload failed", {
              sessionId,
              stopReason,
              err: err instanceof Error ? err.message : String(err),
            });
          });
        return;
      }

      const errorDetail =
        assistantMsg.errorMessage ??
        (isErrorStopReason(stopReason) ? "LLM 返回了错误响应" : undefined) ??
        "LLM 返回了空响应";
      const errorTitle = "LLM 未返回有效响应";
      chat.setMessagesForSession(
        sessionId,
        replaceMsgAt(existing, lastMsgIdx, {
          ...lastMsg,
          role: "error" as const,
          content: [{ type: "text" as const, text: `${errorTitle}\n${errorDetail}` }],
          stopReason,
          isStreaming: false,
        }),
      );
      notificationGateway.emit({
        type: "session_error",
        sessionId,
        title: "响应为空",
        body: "LLM 返回了空响应，可能是模型配置问题或 API 错误",
        level: "warning",
      });
      return;
    }

    const closedContent = closeRunningToolExecutions(
      lastMsg.content,
      isErrorStopReason(assistantMsg.stopReason) ? "error" : "done",
    );

    chat.setMessagesForSession(
      sessionId,
      replaceMsgAt(existing, lastMsgIdx, {
        ...lastMsg,
        content: closedContent,
        isStreaming: false,
        stopReason: assistantMsg.stopReason ?? lastMsg.stopReason ?? null,
        provider: assistantMsg.api ?? lastMsg.provider,
        model: assistantMsg.model ?? lastMsg.model,
        ...buildTokenUsage(assistantMsg.usage),
        entryId,
      }),
    );
    return;
  }

  if (event.type === "tool_execution_start" || event.type === "tool_execution_update") {
    const toolCallId = event.toolCallId;
    const toolName = event.toolName || "unknown";

    if (event.type === "tool_execution_start") {
      toolCallNameMap[toolCallId] = toolName;
      toolCallArgsMap[toolCallId] = formatToolArgs(event.args).args;
      setToolActive(sessionId, toolCallId, true);
    }

    // Tool events bypass the batcher — they're low-frequency and must not
    // be coalesced (parallel tools would lose events). Process directly.
    applyToolExecutionEvent(sessionId, event, toolCallId, toolName);
    return;
  }

  if (event.type === "tool_execution_end") {
    const sessionStore = storeGet();
    if (typeof sessionStore.scheduleWorkspaceResourceRefresh === "function") {
      sessionStore.scheduleWorkspaceResourceRefresh(sessionId);
    }
    flushNow();
    const toolCallId = event.toolCallId;
    setToolActive(sessionId, toolCallId, false);
    type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;
    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];

    for (let i = existing.length - 1; i >= 0; i--) {
      const msg = existing[i];
      if (msg.role !== "assistant") continue;
      const blockIdx = msg.content.findIndex(
        (b): b is ToolExecBlock => b.type === "toolExecution" && b.toolCallId === toolCallId,
      );
      if (blockIdx < 0) continue;

      const isError = event.isError;
      let output = "";
      const result = event.result as
        | { content?: Array<{ type: string; text?: string }>; details?: unknown }
        | undefined;
      if (result) {
        if (Array.isArray(result.content)) {
          output = result.content.map((c) => c.text ?? "").join("");
        } else {
          output = JSON.stringify(result, null, 2);
        }
      }

      const blocks = [...msg.content];
      const prev = blocks[blockIdx] as ToolExecBlock;
      blocks[blockIdx] = {
        ...prev,
        status: isError ? "error" : "done",
        output,
        details: result?.details,
        endedAt: event.timestamp ?? Date.now(),
      };

      const updated = [...existing];
      updated[i] = { ...msg, content: blocks };
      chat.setMessagesForSession(sessionId, updated, { bumpStreamVersion: true });
      return;
    }

    // BLOCK NOT FOUND — batcher coalescing may have swallowed the
    // tool_execution_start that would have created this block.
    // Create it directly as done/error so the card closes properly.
    const isError = event.isError;
    let output = "";
    const result = event.result as
      | { content?: Array<{ type: string; text?: string }>; details?: unknown }
      | undefined;
    if (result) {
      if (Array.isArray(result.content)) {
        output = result.content.map((c) => c.text ?? "").join("");
      } else {
        output = JSON.stringify(result, null, 2);
      }
    }
    const argsStr = toolCallArgsMap[toolCallId] || "";
    const fallbackBlock: ToolExecBlock = {
      type: "toolExecution",
      toolCallId,
      toolName: event.toolName || toolCallNameMap[toolCallId] || "unknown",
      args: argsStr,
      status: isError ? "error" : "done",
      output,
      details: result?.details,
      startedAt: event.timestamp ? event.timestamp - 1 : Date.now() - 1,
      endedAt: event.timestamp ?? Date.now(),
    };
    for (let i = existing.length - 1; i >= 0; i--) {
      const msg = existing[i];
      if (msg.role !== "assistant") continue;
      const blocks = [...msg.content, fallbackBlock];
      const updated = [...existing];
      updated[i] = { ...msg, content: blocks };
      chat.setMessagesForSession(sessionId, updated, { bumpStreamVersion: true });
      log.info("[tool_execution_end] created missing block as done", {
        sessionId,
        toolCallId,
        toolName: fallbackBlock.toolName,
      });
      return;
    }

    return;
  }

  if (event.type === "custom_entry") {
    const SNAPSHOT_TYPE = "step_snapshot";
    const isSnapshot = event.customType === SNAPSHOT_TYPE;
    const isBashBackgroundProcess = isBashBackgroundProcessType(event.customType);
    if (!ALL_MEMORY_TYPE_KEYS.has(event.customType) && !isSnapshot && !isBashBackgroundProcess) {
      return;
    }

    if (isSnapshot || isBashBackgroundProcess) {
      if (event.display === false) return;
      const chat = useChatStore.getState();
      const existing = chat.messagesBySession[sessionId] || [];
      const customMsg: ChatMessage = {
        id: event.id || `custom-${Date.now()}`,
        role: "custom",
        content: [{ type: "custom", customType: event.customType, data: event.data }],
        timestamp: Date.now(),
      };
      chat.setMessagesForSession(sessionId, [...existing, customMsg]);
      return;
    }

    const memoryOperationId = getMemoryOperationId(event.data);
    if (
      event.customType === "memory_prefetch" &&
      memoryOperationId &&
      event.data &&
      typeof event.data === "object"
    ) {
      setMemoryPrefetchData(sessionId, memoryOperationId, event.data as Record<string, unknown>);
    }

    let effectiveMemoryData = event.data;
    if (event.customType === "memory_prefetch_result" || event.customType === "memory_inject") {
      effectiveMemoryData = mergePrefetchResultData(
        event.data,
        getMemoryPrefetchData(sessionId, memoryOperationId),
      );
    }

    const memoryStore = useMemoryStore.getState();
    memoryStore.addEvent(sessionId, {
      id: event.id || `custom-${Date.now()}`,
      customType: event.customType,
      data: effectiveMemoryData,
      timestamp: getMemorySemanticTimestamp(effectiveMemoryData, Date.now()),
    });

    if (event.customType === "memory_prefetch_result" || event.customType === "memory_inject") {
      const data = effectiveMemoryData as { summary?: string; snippet?: string } | undefined;
      const skippedInjection =
        event.customType === "memory_inject" &&
        ((effectiveMemoryData as Record<string, unknown> | undefined)?.skipped === true ||
          (effectiveMemoryData as Record<string, unknown> | undefined)?.alreadyInjected === true);
      if (data && !skippedInjection) {
        memoryStore.addInjected(sessionId, {
          summary: data.summary ?? "",
          snippet: data.snippet ?? "",
        });
      }
    }

    if (event.customType === "memory_irrelevant_marked") {
      const data = event.data as { selectedFiles?: string[]; query?: string } | undefined;
      if (data && Array.isArray(data.selectedFiles) && data.selectedFiles.length > 0) {
        const eventId = event.id ?? `irrelevant-${Date.now()}`;
        memoryStore.addIrrelevantMark(sessionId, eventId);
      }
    }

    if (event.display === false) return;

    if (event.customType === "memory_prefetch") {
      const eventId = event.id || `prefetch-${Date.now()}`;
      const operationId = getMemoryOperationId(event.data);
      if (!operationId) return;
      if (!pendingPrefetchMap.has(sessionId)) {
        pendingPrefetchMap.set(sessionId, new Map());
      }
      const sessionMap = pendingPrefetchMap.get(sessionId);
      if (!sessionMap) return;

      const timer = setTimeout(() => {
        sessionMap.delete(operationId);
        if (sessionMap.size === 0) pendingPrefetchMap.delete(sessionId);
        const chat = useChatStore.getState();
        const msgs = chat.messagesBySession[sessionId] || [];
        const customMsg: ChatMessage = {
          id: eventId,
          role: "custom" as const,
          content: [
            {
              type: "custom" as const,
              customType: "memory_prefetch",
              data: { ...(event.data as Record<string, unknown>), _timedOut: true },
            },
          ],
          timestamp: getMemorySemanticTimestamp(event.data, Date.now()),
        };
        chat.setMessagesForSession(sessionId, upsertMemoryCustomMessage(msgs, customMsg));
      }, PREFETCH_FALLBACK_MS);

      sessionMap.set(operationId, { agentEvent: event, timer });
      return;
    }

    if (event.customType === "memory_prefetch_result") {
      const sessionMap = pendingPrefetchMap.get(sessionId);
      let resultData: unknown = event.data;
      const operationId = getMemoryOperationId(event.data);
      const storedPrefetchData = getMemoryPrefetchData(sessionId, operationId);

      if (sessionMap && operationId) {
        const firstPending = sessionMap.get(operationId);
        if (firstPending) {
          clearTimeout(firstPending.timer);
          sessionMap.delete(operationId);
          if (sessionMap.size === 0) pendingPrefetchMap.delete(sessionId);

          const prefetchData = (
            firstPending.agentEvent.type === "custom_entry"
              ? firstPending.agentEvent.data
              : undefined
          ) as Record<string, unknown> | undefined;
          resultData = mergePrefetchResultData(event.data, prefetchData);
        }
      }
      if (resultData === event.data && storedPrefetchData) {
        resultData = mergePrefetchResultData(event.data, storedPrefetchData);
      }

      const chat = useChatStore.getState();
      const existingMsgs = chat.messagesBySession[sessionId] || [];
      const timedOutPrefetchIndex = operationId
        ? findTimedOutMemoryPrefetchIndex(existingMsgs, operationId)
        : -1;
      if (timedOutPrefetchIndex >= 0) {
        const timedOutMsg = existingMsgs[timedOutPrefetchIndex];
        const timedOutBlock = timedOutMsg.content[0];
        const prefetchData =
          timedOutBlock?.type === "custom"
            ? (timedOutBlock.data as Record<string, unknown> | undefined)
            : undefined;
        const mergedResultData = mergePrefetchResultData(resultData, prefetchData);
        const replacement: ChatMessage = {
          id: event.id || timedOutMsg.id,
          role: "custom",
          content: [
            {
              type: "custom",
              customType: "memory_prefetch_result",
              data: mergedResultData,
            },
          ],
          timestamp: getMemorySemanticTimestamp(mergedResultData, Date.now()),
        };
        chat.setMessagesForSession(
          sessionId,
          replaceMsgAt(existingMsgs, timedOutPrefetchIndex, replacement),
        );
        return;
      }
      const customMsg: ChatMessage = {
        id: event.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "custom",
        content: [{ type: "custom", customType: "memory_prefetch_result", data: resultData }],
        timestamp: getMemorySemanticTimestamp(resultData, Date.now()),
      };
      chat.setMessagesForSession(sessionId, upsertMemoryCustomMessage(existingMsgs, customMsg));
      return;
    }

    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    const customData = event.customType === "memory_inject" ? effectiveMemoryData : event.data;
    const customMsg: ChatMessage = {
      id: event.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "custom",
      content: [{ type: "custom", customType: event.customType, data: customData }],
      timestamp: ALL_MEMORY_TYPE_KEYS.has(event.customType)
        ? getMemorySemanticTimestamp(customData, Date.now())
        : Date.now(),
    };
    chat.setMessagesForSession(
      sessionId,
      ALL_MEMORY_TYPE_KEYS.has(event.customType)
        ? upsertMemoryCustomMessage(existing, customMsg)
        : [...existing, customMsg],
    );

    return;
  }

  if (event.type === "turn_end") {
    useChangeReviewStore.getState().fetchPending();
    return;
  }

  if (event.type === "session_rename") {
    const { newName } = event;
    useSessionStore.setState((s) => {
      const updated: Record<string, SessionMeta[]> = {};
      for (const [path, sessions] of Object.entries(s.sessionsByProject)) {
        updated[path] = sessions.map((sess) =>
          sess.sessionId === sessionId ? { ...sess, name: newName } : sess,
        );
      }
      return { sessionsByProject: updated };
    });
    return;
  }

  if (event.type === "queue_update") {
    useSessionQueueStore.getState().setSessionQueue(sessionId, {
      steering: event.steering,
      followUp: event.followUp,
    });
    return;
  }

  if (event.type === "mcp_connection_change") {
    const { name, status, error, tools } = event as {
      type: "mcp_connection_change";
      name: string;
      status: "connecting" | "connected" | "error" | "disconnected";
      error?: string;
      tools?: Array<{ originalName: string; fullName: string; description: string }>;
    };
    useStatusStore.setState((s) => {
      const existing = s.mcpServers.find((srv) => srv.name === name);
      const updated: MCPServerInfo = {
        name,
        status,
        error,
        toolCount: tools?.length ?? existing?.toolCount ?? 0,
        tools:
          tools?.map((t) => ({ name: t.originalName, description: t.description })) ??
          existing?.tools ??
          [],
        scope: existing?.scope ?? "global",
        disabled: existing?.disabled,
      };
      const idx = s.mcpServers.findIndex((srv) => srv.name === name);
      if (idx >= 0) {
        const servers = [...s.mcpServers];
        servers[idx] = updated;
        return { mcpServers: servers };
      }
      return { mcpServers: [...s.mcpServers, updated] };
    });
    return;
  }
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__toolCallNameMap = toolCallNameMap;
  (window as unknown as Record<string, unknown>).__toolCallArgsMap = toolCallArgsMap;
}

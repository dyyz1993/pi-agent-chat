import { create } from "zustand";
import type { Message, ImageContent } from "@dyyz1993/pi-ai";
import type { ChatMessage, ContentBlock } from "../types";
import { buildPreservedStreamingMessage, normalizeToolBlocks } from "../lib/chat-tool-normalizer";
import { hasSameMessageSnapshots } from "../utils/chat-message-snapshot";
import { isAgentNotStartedError, sendAgentMessageWithTimeout } from "../lib/chat-send-utils";
import { readDraft, writeDraft } from "../utils/chat-input-draft";
import { apiClient } from "../lib/api-client";
import { useAppStore } from "./use-app-store";
import { useNotificationStore } from "./use-notification-store";
import { clearAgentStarted, useSessionStore } from "./use-session-store";
import {
  useSessionQueueStore,
  type FollowUpQueueItemRef,
  type QueueItemRef,
} from "./use-session-queue-store";
import { useMemoryStore } from "./use-memory-store";
import { ALL_MEMORY_TYPE_KEYS } from "../components/chat/memory-config";
import { isBashBackgroundProcessType } from "../components/chat/bash-background-process";
import { messageToChatMessage } from "../lib/message-mapper";
import { findNearestProviderRequest } from "../lib/provider-error-diagnostics";
import {
  getMemoryCustomDedupeKey,
  getMemoryEntryScore,
  getMemoryOperationIdFromData,
  getMemoryQueryFromData,
} from "../lib/memory-entry-dedupe";
import type { AgentMessageForUI } from "../../shared/modules/agent";
import { createLogger } from "../../shared/lib/logger";

export { normalizeToolBlocks } from "../lib/chat-tool-normalizer";
export {
  getMemoryCustomDedupeKey,
  getMemoryEntryScore,
  getMemoryOperationIdFromData,
  getMemoryQueryFromData,
} from "../lib/memory-entry-dedupe";

const log = createLogger("chat-store");
const perfLog = createLogger("session-perf");

const PAGE_SIZE = 50;
export const MAIN_MESSAGE_HISTORY_WINDOW_SIZE = PAGE_SIZE * 6;
const MAX_MESSAGE_CACHE_SESSIONS = 8;
const MEMORY_SAME_QUERY_DEDUP_WINDOW_MS = 15_000;
const backgroundRefreshGenerationBySession = new Map<string, number>();
const topWindowMessageIdsBySession = new Map<string, Set<string>>();
const bottomPaginationSnapshotBySession = new Map<
  string,
  { hasMore: boolean | undefined; nextCursor: string | null | undefined }
>();
const RENDERABLE_MEMORY_CUSTOM_TYPES = new Set([
  "memory_prefetch",
  "memory_prefetch_result",
  "memory_inject",
  "memory_extract",
  "memory_extract_result",
  "memory_dream",
  "memory_dream_result",
  "memory_created",
  "memory_failed",
  "memory_irrelevant_marked",
]);

function parseManualCompactionCommand(
  text: string,
): { command: "compact" | "compact-force"; customInstructions?: string } | null {
  const trimmed = text.trim();
  const match = /^\/(compact|compact-force)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;
  const customInstructions = match[2]?.trim();
  return {
    command: match[1] as "compact" | "compact-force",
    ...(customInstructions ? { customInstructions } : {}),
  };
}

function normalizeCompactionFailureReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  const text = String(reason ?? "").trim();
  return text || "压缩失败";
}

export function buildCompactionFailureMessage(
  reason: unknown,
  options?: {
    id?: string;
    status?: "failed" | "aborted";
    startedAt?: number;
    timestamp?: number;
  },
): ChatMessage {
  const status = options?.status ?? "failed";
  const normalizedReason = normalizeCompactionFailureReason(reason);
  const timestamp = options?.timestamp ?? Date.now();
  return {
    id: options?.id ?? `compact_failed_${timestamp}`,
    role: "compactionSummary",
    content: [
      {
        type: "compactionSummary",
        summary: status === "aborted" ? "上下文压缩已中止。" : "上下文压缩失败，请查看原因后重试。",
        status,
        reason: normalizedReason,
        startedAt: options?.startedAt,
      },
    ],
    timestamp,
    _local: true,
  };
}

function getCompactionFailureSignature(message: ChatMessage): string | null {
  if (message.role !== "compactionSummary") return null;
  const block = message.content.find((b) => b.type === "compactionSummary");
  if (!block || (block.status !== "failed" && block.status !== "aborted")) return null;
  return `${block.status}:${block.reason ?? ""}`;
}

export function appendLocalCompactionFailureMessage(
  sessionId: string,
  reason: unknown,
  options?: { status?: "failed" | "aborted"; startedAt?: number },
): void {
  const store = useChatStore.getState();
  const nextMessage = buildCompactionFailureMessage(reason, options);
  const nextSignature = getCompactionFailureSignature(nextMessage);
  const current = store.messagesBySession[sessionId] || [];
  if (
    nextSignature &&
    current.some((message) => getCompactionFailureSignature(message) === nextSignature)
  ) {
    return;
  }
  store.setMessagesForSession(sessionId, [...current, nextMessage]);
}

export function clearBackgroundRefreshGeneration(sessionId: string): void {
  backgroundRefreshGenerationBySession.delete(sessionId);
}

export type MessageHydrationState = "idle" | "loading" | "ready" | "error";
export type MessageViewMode = "tail" | "focus";

type FocusWindowMeta = {
  targetEntryId: string;
  beforeCursor: string | null;
  afterCursor: string | null;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};

function setSessionMessagesWithCacheLimit(
  current: Record<string, ChatMessage[]>,
  sessionId: string,
  messages: ChatMessage[],
): Record<string, ChatMessage[]> {
  const { [sessionId]: _existing, ...rest } = current;
  const next = { ...rest, [sessionId]: messages };
  const sessionIds = Object.keys(next);
  if (sessionIds.length <= MAX_MESSAGE_CACHE_SESSIONS) {
    return next;
  }

  const trimmed = { ...next };
  for (const id of sessionIds.slice(0, sessionIds.length - MAX_MESSAGE_CACHE_SESSIONS)) {
    delete trimmed[id];
  }
  return trimmed;
}

export function limitLoadedHistoryWindow(
  messages: ChatMessage[],
  maxMessages = MAIN_MESSAGE_HISTORY_WINDOW_SIZE,
): { messages: ChatMessage[]; trimmedTail: boolean } {
  if (messages.length <= maxMessages) {
    return { messages, trimmedTail: false };
  }
  return {
    messages: messages.slice(0, maxMessages),
    trimmedTail: true,
  };
}

function getMemoryMessageDedupeKey(message: ChatMessage): string | undefined {
  if (message.role !== "custom") return undefined;
  const block = message.content[0];
  if (block?.type !== "custom") return undefined;
  return getMemoryCustomDedupeKey(block.customType, block.data);
}

function getMemoryMessageOperationId(message: ChatMessage): string | undefined {
  if (message.role !== "custom") return undefined;
  const block = message.content[0];
  if (block?.type !== "custom") return undefined;
  return getMemoryOperationIdFromData(block.data);
}

type MemoryPrefetchResultCandidate = {
  message: ChatMessage;
  operationId: string | undefined;
  query: string;
  score: number;
  timestamp: number;
};

function getMemoryPrefetchResultCandidate(
  message: ChatMessage,
): MemoryPrefetchResultCandidate | undefined {
  if (message.role !== "custom") return undefined;
  const block = message.content[0];
  if (block?.type !== "custom" || block.customType !== "memory_prefetch_result") {
    return undefined;
  }
  const query = getMemoryQueryFromData(block.data);
  if (!query) return undefined;
  return {
    message,
    operationId: getMemoryOperationIdFromData(block.data),
    query,
    score: getMemoryEntryScore(block.customType, block.data),
    timestamp: getMemorySemanticTimestamp(block.data, message.timestamp),
  };
}

function chooseBetterMemoryResultCandidate(
  current: MemoryPrefetchResultCandidate,
  candidate: MemoryPrefetchResultCandidate,
): MemoryPrefetchResultCandidate {
  if (candidate.score > current.score) return candidate;
  if (candidate.score === current.score && candidate.timestamp >= current.timestamp) {
    return candidate;
  }
  return current;
}

function findRedundantMemoryOperationIds(messages: ChatMessage[]): Set<string> {
  const groups: {
    query: string;
    anchorTimestamp: number;
    best: MemoryPrefetchResultCandidate;
    members: MemoryPrefetchResultCandidate[];
  }[] = [];

  for (const message of messages) {
    const candidate = getMemoryPrefetchResultCandidate(message);
    if (!candidate) continue;

    const group = groups.find(
      (item) =>
        item.query === candidate.query &&
        Math.abs(candidate.timestamp - item.anchorTimestamp) <= MEMORY_SAME_QUERY_DEDUP_WINDOW_MS,
    );
    if (!group) {
      groups.push({
        query: candidate.query,
        anchorTimestamp: candidate.timestamp,
        best: candidate,
        members: [candidate],
      });
      continue;
    }

    group.members.push(candidate);
    group.best = chooseBetterMemoryResultCandidate(group.best, candidate);
  }

  const redundantOperationIds = new Set<string>();
  for (const group of groups) {
    if (group.members.length < 2) continue;
    const bestOperationId = group.best.operationId;
    for (const candidate of group.members) {
      if (!candidate.operationId || candidate.operationId === bestOperationId) continue;
      redundantOperationIds.add(candidate.operationId);
    }
  }
  return redundantOperationIds;
}

function isRedundantMemoryOperationMessage(
  message: ChatMessage,
  redundantOperationIds: Set<string>,
): boolean {
  if (redundantOperationIds.size === 0 || message.role !== "custom") return false;
  const block = message.content[0];
  if (block?.type !== "custom" || !ALL_MEMORY_TYPE_KEYS.has(block.customType)) return false;
  const operationId = getMemoryMessageOperationId(message);
  return operationId !== undefined && redundantOperationIds.has(operationId);
}

function findBestMemoryInjectMessageByOperationId(
  messages: ChatMessage[],
): Map<string, ChatMessage> {
  const bestByOperationId = new Map<string, ChatMessage>();

  for (const message of messages) {
    if (message.role !== "custom") continue;
    const block = message.content[0];
    if (block?.type !== "custom" || block.customType !== "memory_inject") continue;
    const operationId = getMemoryOperationIdFromData(block.data);
    if (!operationId) continue;

    const current = bestByOperationId.get(operationId);
    if (!current) {
      bestByOperationId.set(operationId, message);
      continue;
    }

    const currentBlock = current.content[0];
    const currentScore =
      currentBlock?.type === "custom"
        ? getMemoryEntryScore(currentBlock.customType, currentBlock.data)
        : 0;
    const candidateScore = getMemoryEntryScore(block.customType, block.data);
    if (
      candidateScore > currentScore ||
      (candidateScore === currentScore && message.timestamp >= current.timestamp)
    ) {
      bestByOperationId.set(operationId, message);
    }
  }

  return bestByOperationId;
}

function isWeakerMemoryInjectForSameOperation(
  message: ChatMessage,
  bestInjectByOperationId: Map<string, ChatMessage>,
): boolean {
  if (message.role !== "custom") return false;
  const block = message.content[0];
  if (block?.type !== "custom" || block.customType !== "memory_inject") return false;
  const operationId = getMemoryOperationIdFromData(block.data);
  return operationId !== undefined && bestInjectByOperationId.get(operationId) !== message;
}

export function dedupeMemoryInjectMessages(messages: ChatMessage[]): ChatMessage[] {
  const redundantOperationIds = findRedundantMemoryOperationIds(messages);
  const bestInjectByOperationId = findBestMemoryInjectMessageByOperationId(messages);
  const chosenByKey = new Map<string, { message: ChatMessage; score: number }>();
  let changed = redundantOperationIds.size > 0;

  for (const message of messages) {
    if (isRedundantMemoryOperationMessage(message, redundantOperationIds)) continue;
    if (isWeakerMemoryInjectForSameOperation(message, bestInjectByOperationId)) {
      changed = true;
      continue;
    }
    const dedupeKey = getMemoryMessageDedupeKey(message);
    if (!dedupeKey) continue;
    const block = message.content[0];
    const score = block?.type === "custom" ? getMemoryEntryScore(block.customType, block.data) : 0;
    const existing = chosenByKey.get(dedupeKey);
    if (!existing || score >= existing.score) {
      chosenByKey.set(dedupeKey, { message, score });
    }
    if (existing) changed = true;
  }

  if (!changed) return messages;

  const emittedKeys = new Set<string>();
  const result: ChatMessage[] = [];
  for (const message of messages) {
    if (isRedundantMemoryOperationMessage(message, redundantOperationIds)) continue;
    if (isWeakerMemoryInjectForSameOperation(message, bestInjectByOperationId)) continue;
    const dedupeKey = getMemoryMessageDedupeKey(message);
    if (!dedupeKey) {
      result.push(message);
      continue;
    }
    const chosen = chosenByKey.get(dedupeKey);
    if (chosen?.message !== message || emittedKeys.has(dedupeKey)) continue;
    emittedKeys.add(dedupeKey);
    result.push(message);
  }

  return result;
}

function primaryTextOf(message: ChatMessage): string {
  return (
    message.content.find(
      (block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text",
    )?.text ?? ""
  );
}

function llmErrorDetailKey(message: ChatMessage): string | null {
  if (message.role !== "error" || message.stopReason !== "error") return null;
  const text = primaryTextOf(message).trim();
  if (!text) return null;

  const [title, ...detailLines] = text.split("\n");
  const detail = detailLines.join("\n").trim();
  const key = detail || title.trim();
  return key.replace(/\s+/gu, " ");
}

function dedupeLlmErrorMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const errorIndexByKey = new Map<string, number>();
  let changed = false;

  for (const message of messages) {
    if (message.role === "user") {
      errorIndexByKey.clear();
      result.push(message);
      continue;
    }

    const key = llmErrorDetailKey(message);
    if (!key) {
      result.push(message);
      continue;
    }

    const existingIdx = errorIndexByKey.get(key);
    if (existingIdx === undefined) {
      errorIndexByKey.set(key, result.length);
      result.push(message);
      continue;
    }

    const existing = result[existingIdx];
    result[existingIdx] = {
      ...existing,
      content: message.content,
      stopReason: message.stopReason,
      providerRequest: message.providerRequest ?? existing.providerRequest,
      isStreaming: false,
    };
    changed = true;
  }

  return changed ? result : messages;
}

function prepareMessagesForStore(
  msgs: ChatMessage[],
  options: { normalizeTools?: boolean; activeToolCallIds?: string[] } = {},
): ChatMessage[] {
  const nextMsgs = [...dedupeLlmErrorMessages(dedupeMemoryInjectMessages(msgs))];
  const activeToolCallIds =
    options.activeToolCallIds === undefined ? undefined : new Set(options.activeToolCallIds);
  if (options.normalizeTools) {
    normalizeToolBlocks(nextMsgs, false, false);
  }

  const latestStreamingAssistantIndex = (() => {
    for (let i = nextMsgs.length - 1; i >= 0; i--) {
      const msg = nextMsgs[i];
      if (msg.role === "assistant" && msg.isStreaming === true) return i;
    }
    return -1;
  })();

  for (let mi = 0; mi < nextMsgs.length; mi++) {
    const msg = nextMsgs[mi];
    if (msg.role !== "assistant") continue;

    let changed = false;
    const content = msg.content.map((block) => {
      if (block.type !== "toolExecution" || block.status !== "running") return block;
      const details = block.details;
      const isBackground =
        details &&
        typeof details === "object" &&
        "background" in (details as Record<string, unknown>);
      if (isBackground) return block;
      if (activeToolCallIds !== undefined) {
        if (activeToolCallIds.has(block.toolCallId)) return block;
        changed = true;
        return {
          ...block,
          status: "done" as const,
          endedAt: block.endedAt ?? Date.now(),
        };
      }
      if (mi === latestStreamingAssistantIndex) return block;
      changed = true;
      return {
        ...block,
        status: "done" as const,
        endedAt: block.endedAt ?? Date.now(),
      };
    });

    if (changed) {
      nextMsgs[mi] = { ...msg, content, isStreaming: false };
    }
  }

  return nextMsgs;
}

function sameToolCallIds(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

type MemoryCustomEntry = {
  id: string;
  customType: string;
  data: unknown;
  timestamp: number;
};

function rawMessageTimestamp(raw: AgentMessageForUI): number {
  const timestamp = (raw as unknown as { timestamp?: unknown }).timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function rawMessageStopReason(raw: AgentMessageForUI): string | undefined {
  const stopReason = (raw as unknown as { stopReason?: unknown }).stopReason;
  return typeof stopReason === "string" ? stopReason : undefined;
}

function mapMessageWithProviderDiagnostics(
  raw: AgentMessageForUI,
  id: string | undefined,
  toolCallNameMap: Record<string, string>,
  customEntries: unknown[],
): ChatMessage | null {
  const providerRequest =
    raw.role === "assistant" && rawMessageStopReason(raw) === "error"
      ? findNearestProviderRequest(customEntries, rawMessageTimestamp(raw))
      : undefined;
  return messageToChatMessage(raw as unknown as Message, id, toolCallNameMap, providerRequest);
}

function mapRpcMessagesToStoreMessages(
  sessionId: string,
  messages: AgentMessageForUI[],
  rawCustomEntries: MemoryCustomEntry[],
  options: {
    activeToolCallIds?: string[];
    syncMemory?: boolean;
  } = {},
): ChatMessage[] {
  const seenIds = new Set<string>();
  const rawMessages: Array<{ raw: AgentMessageForUI; id?: string }> = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgId = msg.id;
    if (msgId && seenIds.has(msgId)) continue;
    if (msgId) seenIds.add(msgId);
    rawMessages.unshift({ raw: msg, id: msgId });
  }

  const toolCallNameMap: Record<string, string> = {};
  for (const { raw } of rawMessages) {
    if (raw.role !== "assistant" || !Array.isArray(raw.content)) continue;
    for (const block of raw.content) {
      if (block.type === "toolCall" && block.id && block.name) {
        toolCallNameMap[block.id] = block.name;
      }
    }
  }

  const msgs: ChatMessage[] = [];
  for (const { raw, id } of rawMessages) {
    const msg = mapMessageWithProviderDiagnostics(raw, id, toolCallNameMap, rawCustomEntries);
    if (msg) msgs.push(msg);
  }
  normalizeToolBlocks(msgs, true, false);

  const customEntries = normalizeMemoryCustomEntries(rawCustomEntries);
  if (options.syncMemory) {
    syncMemoryCustomEntries(sessionId, customEntries, { clearSession: true });
  }

  const finalMsgs = mergeRenderableCustomMessages(msgs, customEntries);
  normalizeToolBlocks(finalMsgs, true, false);
  return prepareMessagesForStore(finalMsgs, {
    activeToolCallIds: options.activeToolCallIds,
  });
}

function getNumericField(data: unknown, key: string): number | undefined {
  const record = data as Record<string, unknown> | undefined;
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getCustomBlock(
  message: ChatMessage,
): Extract<ContentBlock, { type: "custom" }> | undefined {
  return message.content.find(
    (block): block is Extract<ContentBlock, { type: "custom" }> => block.type === "custom",
  );
}

export function getMemorySemanticTimestamp(data: unknown, fallback: number): number {
  return (
    getNumericField(data, "_prefetchOccurredAt") ?? getNumericField(data, "occurredAt") ?? fallback
  );
}

function getMemoryPhaseOrder(data: unknown, customType: string): number {
  return (
    getNumericField(data, "phaseOrder") ??
    (customType === "memory_prefetch"
      ? 1
      : customType === "memory_prefetch_result"
        ? 2
        : customType === "memory_inject"
          ? 3
          : 50)
  );
}

function getMessageDisplayRank(message: ChatMessage): number {
  if (message.role === "user") return 0;
  const custom = getCustomBlock(message);
  if (custom && ALL_MEMORY_TYPE_KEYS.has(custom.customType)) {
    return 10 + getMemoryPhaseOrder(custom.data, custom.customType);
  }
  if (message.role === "custom") return 40;
  if (message.role === "assistant") return 60;
  return 80;
}

export function compareChatMessagesForDisplay(a: ChatMessage, b: ChatMessage): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  const rankDiff = getMessageDisplayRank(a) - getMessageDisplayRank(b);
  if (rankDiff !== 0) return rankDiff;
  return (a.entryId ?? a.id).localeCompare(b.entryId ?? b.id);
}

export function insertChatMessageByDisplayOrder(
  messages: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  return [...messages, message].sort(compareChatMessagesForDisplay);
}

function getMemoryOperationId(entry: MemoryCustomEntry): string | undefined {
  return getMemoryOperationIdFromData(entry.data);
}

function getMemoryEntryDedupeKey(entry: MemoryCustomEntry): string | undefined {
  return getMemoryCustomDedupeKey(entry.customType, entry.data);
}

function chooseBetterMemoryEntry(
  current: MemoryCustomEntry | undefined,
  candidate: MemoryCustomEntry,
): MemoryCustomEntry {
  if (!current) return candidate;
  const currentScore = getMemoryEntryScore(current.customType, current.data);
  const candidateScore = getMemoryEntryScore(candidate.customType, candidate.data);
  if (candidateScore > currentScore) return candidate;
  if (candidateScore === currentScore && candidate.timestamp >= current.timestamp) return candidate;
  return current;
}

function normalizeMemoryCustomEntries(customEntries: MemoryCustomEntry[]): MemoryCustomEntry[] {
  const entries = customEntries.map((entry) => ({
    ...entry,
    data:
      entry.data && typeof entry.data === "object"
        ? { ...(entry.data as Record<string, unknown>) }
        : entry.data,
  }));
  const prefetchByOperationId = new Map<string, MemoryCustomEntry>();
  const bestResultByKey = new Map<string, MemoryCustomEntry>();
  const bestInjectByKey = new Map<string, MemoryCustomEntry>();
  const bestInjectByOperationId = new Map<string, MemoryCustomEntry>();
  const operationIdsWithFinalEntry = new Set<string>();
  const redundantOperationIds = new Set<string>();

  for (const entry of entries) {
    const operationId = getMemoryOperationId(entry);
    if (entry.customType === "memory_prefetch" && operationId) {
      prefetchByOperationId.set(operationId, entry);
    }
  }

  for (const entry of entries) {
    const operationId = getMemoryOperationId(entry);
    const prefetch = operationId ? prefetchByOperationId.get(operationId) : undefined;
    if (
      (entry.customType === "memory_prefetch_result" || entry.customType === "memory_inject") &&
      prefetch
    ) {
      const prefData = prefetch.data as Record<string, unknown> | undefined;
      const entryData = entry.data as Record<string, unknown> | undefined;
      const prefetchOccurredAt = getMemorySemanticTimestamp(prefetch.data, prefetch.timestamp);
      entry.data = {
        ...(entryData ?? {}),
        _prefetchQuery: typeof prefData?.query === "string" ? prefData.query : "",
        _prefetchAvailableFiles:
          typeof prefData?.availableFiles === "number" ? prefData.availableFiles : 0,
        _prefetchOccurredAt: prefetchOccurredAt,
      };
      entry.timestamp = prefetchOccurredAt;
    }

    const dedupeKey = getMemoryEntryDedupeKey(entry);
    if (!dedupeKey) continue;

    if (entry.customType === "memory_prefetch_result") {
      if (operationId) operationIdsWithFinalEntry.add(operationId);
      bestResultByKey.set(
        dedupeKey,
        chooseBetterMemoryEntry(bestResultByKey.get(dedupeKey), entry),
      );
    } else if (entry.customType === "memory_inject") {
      if (operationId) operationIdsWithFinalEntry.add(operationId);
      bestInjectByKey.set(
        dedupeKey,
        chooseBetterMemoryEntry(bestInjectByKey.get(dedupeKey), entry),
      );
      if (operationId) {
        bestInjectByOperationId.set(
          operationId,
          chooseBetterMemoryEntry(bestInjectByOperationId.get(operationId), entry),
        );
      }
    }
  }

  for (const entry of entries) {
    if (entry.customType !== "memory_prefetch_result") continue;
    const operationId = getMemoryOperationId(entry);
    if (!operationId) continue;
    const dedupeKey = getMemoryEntryDedupeKey(entry);
    if (!dedupeKey) continue;
    const best = bestResultByKey.get(dedupeKey);
    const bestOperationId = best ? getMemoryOperationId(best) : undefined;
    if (best && best.id !== entry.id && bestOperationId && bestOperationId !== operationId) {
      redundantOperationIds.add(operationId);
    }
  }

  const seenKeys = new Set<string>();

  return entries.filter((entry) => {
    const operationId = getMemoryOperationId(entry);
    if (operationId && redundantOperationIds.has(operationId)) return false;

    if (entry.customType === "memory_prefetch") {
      if (operationId && operationIdsWithFinalEntry.has(operationId)) return false;
    }

    if (entry.customType === "memory_prefetch_result") {
      const dedupeKey = getMemoryEntryDedupeKey(entry);
      if (dedupeKey && bestResultByKey.get(dedupeKey)?.id !== entry.id) return false;
    }

    if (entry.customType === "memory_inject") {
      if (operationId && bestInjectByOperationId.get(operationId)?.id !== entry.id) {
        return false;
      }
      const dedupeKey = getMemoryEntryDedupeKey(entry);
      if (dedupeKey && bestInjectByKey.get(dedupeKey)?.id !== entry.id) return false;
    }

    const dedupeKey = getMemoryEntryDedupeKey(entry);
    if (dedupeKey) {
      if (seenKeys.has(dedupeKey)) return false;
      seenKeys.add(dedupeKey);
    }

    return true;
  });
}

function memoryEntriesToChatMessages(customEntries: MemoryCustomEntry[]): ChatMessage[] {
  return customEntries
    .filter((entry) => RENDERABLE_MEMORY_CUSTOM_TYPES.has(entry.customType))
    .map((entry) => ({
      id: entry.id,
      role: "custom" as const,
      content: [{ type: "custom" as const, customType: entry.customType, data: entry.data }],
      timestamp: getMemorySemanticTimestamp(entry.data, entry.timestamp),
    }));
}

function renderableCustomEntriesToChatMessages(customEntries: MemoryCustomEntry[]): ChatMessage[] {
  const memoryMessages = memoryEntriesToChatMessages(customEntries);
  const bashBackgroundMessages = customEntries
    .filter((entry) => isBashBackgroundProcessType(entry.customType))
    .map((entry) => ({
      id: entry.id,
      role: "custom" as const,
      content: [{ type: "custom" as const, customType: entry.customType, data: entry.data }],
      timestamp: entry.timestamp,
    }));
  return [...memoryMessages, ...bashBackgroundMessages];
}

function mergeRenderableCustomMessages(
  messages: ChatMessage[],
  customEntries: MemoryCustomEntry[],
): ChatMessage[] {
  const customMessages = renderableCustomEntriesToChatMessages(customEntries);
  if (customMessages.length === 0) return messages;
  const existingIds = new Set(messages.map((message) => message.id));
  const merged = [...messages, ...customMessages.filter((message) => !existingIds.has(message.id))];
  return merged.sort(compareChatMessagesForDisplay);
}

function syncMemoryCustomEntries(
  sessionId: string,
  customEntries: MemoryCustomEntry[],
  options: { clearSession?: boolean } = {},
) {
  const memoryStore = useMemoryStore.getState();
  if (options.clearSession && typeof memoryStore.clearSession === "function") {
    memoryStore.clearSession(sessionId);
  }

  for (const entry of customEntries) {
    if (!ALL_MEMORY_TYPE_KEYS.has(entry.customType)) continue;

    memoryStore.addEvent(sessionId, {
      id: entry.id,
      customType: entry.customType,
      data: entry.data,
      timestamp: entry.timestamp,
    });

    if (
      (entry.customType === "memory_prefetch_result" || entry.customType === "memory_inject") &&
      entry.data
    ) {
      const payload = entry.data as Record<string, unknown>;
      const isSkippedInjection =
        entry.customType === "memory_inject" &&
        (payload.skipped === true || payload.alreadyInjected === true);
      if (!isSkippedInjection) {
        memoryStore.addInjected(sessionId, {
          summary: (payload.summary as string) ?? "",
          snippet: (payload.snippet as string) ?? "",
        });
      }
    }
  }
}

interface ChatState {
  messagesBySession: Record<string, ChatMessage[]>;
  focusMessagesBySession: Record<string, ChatMessage[]>;
  messageViewBySession: Record<string, MessageViewMode>;
  focusWindowMetaBySession: Record<string, FocusWindowMeta | undefined>;
  activeToolCallIdsBySession: Record<string, string[] | undefined>;
  inputText: string;
  isStreaming: boolean;
  streamContentVersion: number;
  /** Per-session stream version — only the active session's changes trigger ChatPanel re-render */
  streamVersionBySession: Record<string, number>;
  loadingSessions: Set<string>;
  historyLoadVersion: number;
  historyLoadVersionBySession: Record<string, number>;
  messageHydrationBySession: Record<string, MessageHydrationState>;
  hasMoreMessagesBySession: Record<string, boolean>;
  hasTrimmedTailMessagesBySession: Record<string, boolean>;
  isLoadingMoreBySession: Record<string, boolean>;
  nextCursorBySession: Record<string, string | null>;

  pendingImages: ImageContent[];
  setInputText: (text: string) => void;
  setPendingImages: (images: ImageContent[]) => void;
  sendMessage: () => Promise<void>;
  sendSteer: () => Promise<void>;
  sendFollowUp: () => Promise<void>;
  clearQueue: () => Promise<void>;
  clearQueuedMessage: (item: QueueItemRef) => Promise<void>;
  insertQueuedMessageNow: (item: QueueItemRef) => Promise<void>;
  promoteQueuedFollowUp: (item: FollowUpQueueItemRef) => Promise<void>;
  addMessage: (msg: ChatMessage) => void;
  setMessagesForSession: (
    sessionId: string,
    msgs: ChatMessage[],
    options?: { bumpStreamVersion?: boolean; streamingFastPath?: boolean },
  ) => void;
  deleteMessagesForSession: (sessionId: string, messageIds: string[]) => void;
  clearSessionMessages: (sessionId: string) => void;
  setActiveToolCallIds: (sessionId: string, toolCallIds: string[] | undefined) => void;
  loadSessionMessages: (
    sessionId: string,
    options?: { force?: boolean; sessionPath?: string; preserveStreaming?: boolean },
  ) => Promise<void>;
  loadFocusedMessagesAround: (
    sessionId: string,
    targetEntryId: string,
    options?: { sessionPath?: string; before?: number; after?: number },
  ) => Promise<boolean>;
  clearFocusedMessages: (sessionId: string) => void;
  /** Background refresh: fetch latest messages and silently update store if different */
  _backgroundRefreshMessages: (sessionId: string, sessionPath?: string) => Promise<void>;
  loadMoreMessages: (sessionId: string) => Promise<void>;
  loadTopMessages: (sessionId: string) => Promise<void>;
  clearTopWindowMessages: (sessionId: string) => void;
  setIsStreaming: (v: boolean) => void;
  incrementStreamVersion: () => void;
  saveInputDraft: (sessionId: string) => void;
  restoreInputDraft: (sessionId: string) => void;
  clearInputDraft: (sessionId: string) => void;
}

function bumpHistoryLoadVersion(
  s: ChatState,
  sessionId: string,
  bumpGlobal = true,
): Pick<ChatState, "historyLoadVersion" | "historyLoadVersionBySession"> {
  return {
    historyLoadVersion: bumpGlobal ? s.historyLoadVersion + 1 : s.historyLoadVersion,
    historyLoadVersionBySession: {
      ...s.historyLoadVersionBySession,
      [sessionId]: (s.historyLoadVersionBySession[sessionId] ?? 0) + 1,
    },
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesBySession: {},
  focusMessagesBySession: {},
  messageViewBySession: {},
  focusWindowMetaBySession: {},
  activeToolCallIdsBySession: {},
  inputText: "",
  pendingImages: [],
  isStreaming: false,
  streamContentVersion: 0,
  streamVersionBySession: {},
  loadingSessions: new Set<string>(),
  historyLoadVersion: 0,
  historyLoadVersionBySession: {},
  messageHydrationBySession: {},
  hasMoreMessagesBySession: {},
  hasTrimmedTailMessagesBySession: {},
  isLoadingMoreBySession: {},
  nextCursorBySession: {},

  setInputText: (text) => set({ inputText: text }),
  setPendingImages: (images) => set({ pendingImages: images }),

  sendMessage: async () => {
    const { inputText } = get();
    if (!inputText.trim()) return;
    const text = inputText.trim();

    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) {
      useAppStore.getState().addLog("No active session");
      useNotificationStore.getState().push({ message: "No active session", level: "warning" });
      return;
    }

    const activeSubId = (await import("./use-subagent-store")).useSubagentStore.getState()
      .activeSubsessionId;
    if (activeSubId) {
      useAppStore.getState().addLog("Cannot send to subagent session");
      useNotificationStore
        .getState()
        .push({ message: "Cannot send to subagent session", level: "warning" });
      return;
    }

    if (get().hasTrimmedTailMessagesBySession[sessionId]) {
      await get().loadSessionMessages(sessionId, { force: true });
    }

    const compactionCommand = parseManualCompactionCommand(text);
    if (compactionCommand) {
      set({ inputText: "", pendingImages: [], isStreaming: true });
      writeDraft(sessionId, "");
      useSessionStore.getState().updateSessionStatus(sessionId, "compacting");

      try {
        perfLog.info("[compact] begin", {
          sessionId,
          command: compactionCommand.command,
        });
        await apiClient.call("agent.compact", {
          sessionId,
          customInstructions: compactionCommand.customInstructions,
        });
        perfLog.info("[compact] done", { sessionId });
        set({ isStreaming: false });
        if (useSessionStore.getState().sessionStatusMap?.[sessionId] === "compacting") {
          useSessionStore.getState().updateSessionStatus(sessionId, "idle");
        }
      } catch (err) {
        set({ isStreaming: false, inputText: text });
        if (useSessionStore.getState().sessionStatusMap?.[sessionId] === "compacting") {
          useSessionStore.getState().updateSessionStatus(sessionId, "idle");
        }
        const msg = err instanceof Error ? err.message : String(err);
        appendLocalCompactionFailureMessage(sessionId, msg, { status: "failed" });
        useAppStore.getState().addLog(`Compaction error: ${msg}`);
        useNotificationStore
          .getState()
          .push({ message: `Compaction failed: ${msg}`, level: "error" });
      }
      return;
    }

    set({ inputText: "" });
    writeDraft(sessionId, "");

    let sentImages: ImageContent[] = [];

    try {
      sentImages = get().pendingImages;

      const contentBlocks: ContentBlock[] = [{ type: "text", text }];
      for (const img of sentImages) {
        contentBlocks.push({
          type: "imageBlock",
          url: `data:${img.mimeType};base64,${img.data}`,
          alt: "uploaded image",
        });
      }

      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        role: "user",
        content: contentBlocks,
        timestamp: Date.now(),
        _local: true,
      };
      set((s) => {
        const existing = s.messagesBySession[sessionId] || [];
        return {
          messagesBySession: setSessionMessagesWithCacheLimit(s.messagesBySession, sessionId, [
            ...existing,
            userMsg,
          ]),
        };
      });

      set({ isStreaming: true, pendingImages: [] });
      useSessionStore.getState().updateSessionStatus(sessionId, "streaming");

      const sendT0 = performance.now();
      perfLog.info("[send] begin", { sessionId });
      await sendAgentMessageWithTimeout(sessionId, text, sentImages);
      perfLog.info("[send] done", { sessionId, sendMs: Math.round(performance.now() - sendT0) });
      set({ isStreaming: false });
    } catch (err) {
      let finalErr = err;
      if (isAgentNotStartedError(finalErr, sessionId)) {
        clearAgentStarted(sessionId);
        useSessionStore.setState((s) => ({
          sessionReady: { ...s.sessionReady, [sessionId]: false },
        }));
        finalErr = new Error("当前会话连接已断开，请刷新页面或重连后再发送。");
      }

      set((s) => {
        const msgs = s.messagesBySession[sessionId] || [];
        return {
          isStreaming: false,
          messagesBySession: setSessionMessagesWithCacheLimit(
            s.messagesBySession,
            sessionId,
            msgs.filter((m) => !m._local),
          ),
        };
      });
      // ❌ 不再强制切到 idle，保持当前状态
      const msg = finalErr instanceof Error ? finalErr.message : String(finalErr);
      useAppStore.getState().addLog(`Send error: ${msg}`);
      useNotificationStore.getState().push({ message: `Send failed: ${msg}`, level: "error" });
      set({ inputText: text });
    }
  },

  sendSteer: async () => {
    const { inputText } = get();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set({ inputText: "" });
    writeDraft(sessionId, "");

    try {
      const STEER_TIMEOUT_MS = 60_000;
      const steerT0 = performance.now();
      perfLog.info("[steer] begin", { sessionId });
      const pendingImages = get().pendingImages;
      if (pendingImages.length > 0) {
        set({ pendingImages: [] });
      }
      await Promise.race([
        apiClient.call("agent.steer", { sessionId, content: text, images: pendingImages }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Steer timed out (60s)")), STEER_TIMEOUT_MS),
        ),
      ]);
      perfLog.info("[steer] done", { sessionId, steerMs: Math.round(performance.now() - steerT0) });
    } catch (err) {
      set({ inputText: text });
      const msg = err instanceof Error ? err.message : String(err);
      perfLog.info("[steer] failed", { sessionId, msg });
      useAppStore.getState().addLog(`Steer error: ${msg}`);
      useNotificationStore.getState().push({ message: `Steer failed: ${msg}`, level: "error" });
    }
  },

  sendFollowUp: async () => {
    const { inputText } = get();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set({ inputText: "" });
    writeDraft(sessionId, "");

    try {
      const FOLLOWUP_TIMEOUT_MS = 60_000;
      const followUpT0 = performance.now();
      perfLog.info("[followUp] begin", { sessionId });
      const pendingImages = get().pendingImages;
      if (pendingImages.length > 0) {
        set({ pendingImages: [] });
      }
      await Promise.race([
        apiClient.call("agent.followUp", { sessionId, content: text, images: pendingImages }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("FollowUp timed out (60s)")), FOLLOWUP_TIMEOUT_MS),
        ),
      ]);
      perfLog.info("[followUp] done", {
        sessionId,
        followUpMs: Math.round(performance.now() - followUpT0),
      });
    } catch (err) {
      set({ inputText: text });
      const msg = err instanceof Error ? err.message : String(err);
      perfLog.info("[followUp] failed", { sessionId, msg });
      useAppStore.getState().addLog(`FollowUp error: ${msg}`);
      useNotificationStore.getState().push({ message: `Follow-up failed: ${msg}`, level: "error" });
    }
  },

  clearQueue: async () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const queueBeforeClear = useSessionQueueStore.getState().queueBySession[sessionId];
    const sessionStatus = useSessionStore.getState().sessionStatusMap[sessionId] ?? "idle";
    const shouldAbortAfterClear =
      Boolean(queueBeforeClear?.steering.length) &&
      (sessionStatus === "streaming" || sessionStatus === "retrying");
    try {
      await apiClient.call("agent.clearQueue", { sessionId });
      if (shouldAbortAfterClear) {
        await apiClient.call("agent.abort", { sessionId });
      }
    } catch (err) {
      log.warn("clearQueue failed", { error: String(err) });
    }
  },

  clearQueuedMessage: async (item) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const queueStore = useSessionQueueStore.getState();
    const previous = queueStore.queueBySession[sessionId];
    queueStore.removeQueuedMessage(sessionId, item);
    try {
      await apiClient.call("agent.clearQueue", { sessionId, item });
    } catch (err) {
      if (previous) {
        useSessionQueueStore.getState().setSessionQueue(sessionId, previous);
      }
      log.warn("clearQueuedMessage failed", { error: String(err) });
    }
  },

  promoteQueuedFollowUp: async (item) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const queueStore = useSessionQueueStore.getState();
    const previous = queueStore.queueBySession[sessionId];
    queueStore.promoteFollowUpToSteering(sessionId, item);
    try {
      await apiClient.call("agent.promoteQueuedFollowUp", { sessionId, item });
    } catch (err) {
      if (previous) {
        useSessionQueueStore.getState().setSessionQueue(sessionId, previous);
      }
      log.warn("promoteQueuedFollowUp failed", { error: String(err) });
    }
  },

  insertQueuedMessageNow: async (item) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const queueStore = useSessionQueueStore.getState();
    const previous = queueStore.queueBySession[sessionId];
    // Optimistically remove the item from the UI queue for BOTH types.
    // The previous code only removed followUp items, leaving steering items
    // stuck in the UI until the next queue_update event arrived.
    queueStore.removeQueuedMessage(sessionId, item);
    try {
      // Two-step delivery so the message is both removed from the CLI queue
      // and re-injected as an immediate interrupting steer:
      //   1. clearQueue(item) removes it from the CLI's steering/followUp
      //      queue and emits a queue_update event.
      //   2. steer(text, immediate:true) injects it as a fresh steering
      //      message that interrupts the current run.
      // The previous code used steer({promote, immediate}) which is a no-op
      // for steering items and silently fails to promote followUp items in
      // the current runtime.
      await apiClient.call("agent.clearQueue", { sessionId, item });
      await apiClient.call("agent.steer", {
        sessionId,
        content: item.text,
        immediate: true,
      });
    } catch (err) {
      if (previous) {
        useSessionQueueStore.getState().setSessionQueue(sessionId, previous);
      }
      log.warn("insertQueuedMessageNow failed", { error: String(err) });
    }
  },

  addMessage: (msg) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const existing = s.messagesBySession[sessionId] || [];
      return {
        messagesBySession: setSessionMessagesWithCacheLimit(s.messagesBySession, sessionId, [
          ...existing,
          msg,
        ]),
      };
    });
  },

  setMessagesForSession: (sessionId, msgs, options = {}) => {
    set((s) => {
      const nextMsgs = options.streamingFastPath
        ? msgs
        : prepareMessagesForStore(msgs, {
            normalizeTools: true,
            activeToolCallIds: s.activeToolCallIdsBySession[sessionId],
          });
      const next: Partial<ChatState> = {
        messagesBySession: setSessionMessagesWithCacheLimit(
          s.messagesBySession,
          sessionId,
          nextMsgs,
        ),
        hasTrimmedTailMessagesBySession: {
          ...s.hasTrimmedTailMessagesBySession,
          [sessionId]: false,
        },
      };
      if (options.bumpStreamVersion) {
        next.streamContentVersion = s.streamContentVersion + 1;
        next.streamVersionBySession = {
          ...s.streamVersionBySession,
          [sessionId]: (s.streamVersionBySession[sessionId] ?? 0) + 1,
        };
      }
      return next;
    });
  },

  deleteMessagesForSession: (sessionId, messageIds) => {
    const idSet = new Set(messageIds);
    if (idSet.size === 0) return;

    set((s) => {
      const currentMessages = s.messagesBySession[sessionId] ?? [];
      const nextMessages = currentMessages.filter((message) => !idSet.has(message.id));
      const currentFocusMessages = s.focusMessagesBySession[sessionId];
      const nextFocusMessages = currentFocusMessages?.filter((message) => !idSet.has(message.id));
      const messagesChanged = nextMessages.length !== currentMessages.length;
      const focusChanged =
        !!currentFocusMessages && nextFocusMessages?.length !== currentFocusMessages.length;

      if (!messagesChanged && !focusChanged) return {};

      const next: Partial<ChatState> = {
        streamContentVersion: s.streamContentVersion + 1,
        streamVersionBySession: {
          ...s.streamVersionBySession,
          [sessionId]: (s.streamVersionBySession[sessionId] ?? 0) + 1,
        },
        ...bumpHistoryLoadVersion(s, sessionId),
      };

      if (messagesChanged) {
        next.messagesBySession = setSessionMessagesWithCacheLimit(
          s.messagesBySession,
          sessionId,
          nextMessages,
        );
      }

      if (focusChanged && nextFocusMessages) {
        next.focusMessagesBySession = {
          ...s.focusMessagesBySession,
          [sessionId]: nextFocusMessages,
        };
      }

      return next;
    });
  },

  clearSessionMessages: (sessionId) =>
    set((s) => {
      const { [sessionId]: _m, ...restMessages } = s.messagesBySession;
      const { [sessionId]: _fm, ...restFocusMessages } = s.focusMessagesBySession;
      const { [sessionId]: _mv, ...restMessageView } = s.messageViewBySession;
      const { [sessionId]: _fwm, ...restFocusWindowMeta } = s.focusWindowMetaBySession;
      const { [sessionId]: _a, ...restActiveTools } = s.activeToolCallIdsBySession;
      const { [sessionId]: _sv, ...restStreamVersion } = s.streamVersionBySession;
      const { [sessionId]: _hlv, ...restHistoryLoadVersion } = s.historyLoadVersionBySession;
      const { [sessionId]: _hy, ...restHydration } = s.messageHydrationBySession;
      const { [sessionId]: _hm, ...restHasMore } = s.hasMoreMessagesBySession;
      const { [sessionId]: _htt, ...restHasTrimmedTail } = s.hasTrimmedTailMessagesBySession;
      const { [sessionId]: _il, ...restIsLoading } = s.isLoadingMoreBySession;
      const { [sessionId]: _nc, ...restNextCursor } = s.nextCursorBySession;
      const loadingSessions = new Set(s.loadingSessions);
      loadingSessions.delete(sessionId);
      return {
        messagesBySession: restMessages,
        focusMessagesBySession: restFocusMessages,
        messageViewBySession: restMessageView,
        focusWindowMetaBySession: restFocusWindowMeta,
        activeToolCallIdsBySession: restActiveTools,
        streamVersionBySession: restStreamVersion,
        historyLoadVersionBySession: restHistoryLoadVersion,
        messageHydrationBySession: restHydration,
        hasMoreMessagesBySession: restHasMore,
        hasTrimmedTailMessagesBySession: restHasTrimmedTail,
        isLoadingMoreBySession: restIsLoading,
        nextCursorBySession: restNextCursor,
        loadingSessions,
      };
    }),

  setActiveToolCallIds: (sessionId, toolCallIds) =>
    set((s) => {
      const current = s.activeToolCallIdsBySession[sessionId];
      if (sameToolCallIds(current, toolCallIds)) return {};

      const activeToolCallIdsBySession = {
        ...s.activeToolCallIdsBySession,
        [sessionId]: toolCallIds,
      };
      const existing = s.messagesBySession[sessionId];
      const existingFocus = s.focusMessagesBySession[sessionId];
      if (!existing && !existingFocus) return { activeToolCallIdsBySession };

      return {
        activeToolCallIdsBySession,
        ...(existing
          ? {
              messagesBySession: setSessionMessagesWithCacheLimit(
                s.messagesBySession,
                sessionId,
                prepareMessagesForStore(existing, { activeToolCallIds: toolCallIds }),
              ),
            }
          : {}),
        ...(existingFocus
          ? {
              focusMessagesBySession: {
                ...s.focusMessagesBySession,
                [sessionId]: prepareMessagesForStore(existingFocus, {
                  activeToolCallIds: toolCallIds,
                }),
              },
            }
          : {}),
      };
    }),

  setIsStreaming: (v) => set({ isStreaming: v }),

  incrementStreamVersion: () => set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),

  loadSessionMessages: async (
    sessionId: string,
    options?: { force?: boolean; sessionPath?: string; preserveStreaming?: boolean },
  ) => {
    const sid = sessionId;
    if (!sid) return;

    perfLog.info("[loadMessages] begin", { sessionId: sid, force: !!options?.force });
    set((s) => {
      if ((s.messageViewBySession[sid] ?? "tail") === "tail") return {};
      const { [sid]: _focus, ...restFocusMessages } = s.focusMessagesBySession;
      const { [sid]: _meta, ...restFocusMeta } = s.focusWindowMetaBySession;
      return {
        focusMessagesBySession: restFocusMessages,
        focusWindowMetaBySession: restFocusMeta,
        messageViewBySession: { ...s.messageViewBySession, [sid]: "tail" },
      };
    });

    if (get().loadingSessions.has(sid)) {
      log.warn("GUARD-1: already loading, skip", { sessionId: sid });
      return;
    }
    if (!options?.force) {
      const preflight = get().messagesBySession[sid] || [];
      const hasRealMessages = preflight.some(
        (m) => m.role === "user" || (m.role === "assistant" && m.tokenUsage),
      );
      if (hasRealMessages) {
        // Optimistic render: cached messages are already in the store, user sees them instantly.
        // Background refresh: fetch latest from server to guarantee completeness.
        perfLog.info("[loadMessages] GUARD-2: cached messages exist, background refresh", {
          sessionId: sid,
          cachedCount: preflight.length,
        });
        get()._backgroundRefreshMessages(sid, options?.sessionPath);
        return;
      }
    }
    set((s) => ({
      loadingSessions: new Set(s.loadingSessions).add(sid),
      messageHydrationBySession: {
        ...s.messageHydrationBySession,
        [sid]: "loading",
      },
    }));

    try {
      const { apiClient } = await import("../lib/api-client");
      const GET_MESSAGES_TIMEOUT_MS = 60_000;
      const t0 = performance.now();
      perfLog.info("[loadSessionMessages] begin", { sessionId, force: !!options?.force });

      // Use getFullMessages which already handles streaming merge + dedup
      // (entryId, message signature, user text, completed toolCall, compaction).
      // During streaming, it auto-merges in-memory messages from the CLI process.
      const result = (await Promise.race([
        apiClient.call("agent.getFullMessages", {
          sessionId: sid,
          sessionPath: options?.sessionPath,
          limit: PAGE_SIZE,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("getFullMessages timed out (60s)")),
            GET_MESSAGES_TIMEOUT_MS,
          ),
        ),
      ])) as Awaited<ReturnType<typeof apiClient.call<"agent.getFullMessages">>>;

      perfLog.info("[loadMessages] RPC returned", {
        sessionId: sid,
        force: !!options?.force,
        rpcMs: Math.round(performance.now() - t0),
        messageCount: result.messages?.length,
        hasMore: result.hasMore,
        totalCount: result.totalCount,
      });

      if (!options?.force) {
        const current = get().messagesBySession[sid] || [];
        const hasRealNow = current.some(
          (m) => m.role === "user" || (m.role === "assistant" && m.tokenUsage),
        );
        if (hasRealNow) {
          log.warn("GUARD-3: messages added during RPC, skip", {
            sessionId: sid,
            count: current.length,
            roles: current.map((m) => m.role),
          });
          set((s) => ({
            messageHydrationBySession: {
              ...s.messageHydrationBySession,
              [sid]: "ready",
            },
          }));
          return;
        }
      }

      const toolCallNameMap: Record<string, string> = {};

      const messages = result.messages;
      if (!Array.isArray(messages)) {
        log.warn("GUARD-4: messages is not array", { sessionId: sid, type: typeof messages });
        set((s) => ({
          messageHydrationBySession: {
            ...s.messageHydrationBySession,
            [sid]: "error",
          },
        }));
        return;
      }
      log.info("Raw messages count", { sessionId: sid, count: messages.length });

      // Deduplicate by message ID — getFullMessages may return duplicates when
      // JSONL has entries from multiple compaction cycles or when the streaming
      // merge cannot fully eliminate overlaps. Keep the last occurrence (latest).
      const seenIds = new Set<string>();
      const rawMessages: Array<{ raw: AgentMessageForUI; id?: string }> = [];
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const msgId = msg.id;
        if (msgId && seenIds.has(msgId)) continue;
        if (msgId) seenIds.add(msgId);
        rawMessages.unshift({ raw: msg, id: msgId });
      }
      if (rawMessages.length < messages.length) {
        log.info("Dedup removed duplicates", {
          sessionId: sid,
          before: messages.length,
          after: rawMessages.length,
        });
      }
      for (const { raw } of rawMessages) {
        const role = raw.role;
        if (role === "assistant") {
          const content = raw.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "toolCall" && block.id && block.name) {
                toolCallNameMap[block.id] = block.name;
              }
            }
          }
        }
      }

      const rawCustomEntries = Array.isArray(result.customEntries) ? result.customEntries : [];
      const msgs: ChatMessage[] = [];
      const nullCount = { byRole: {} as Record<string, number>, total: 0 };
      for (const { raw, id } of rawMessages) {
        const msg = mapMessageWithProviderDiagnostics(raw, id, toolCallNameMap, rawCustomEntries);
        if (msg) {
          msgs.push(msg);
        } else {
          const role = (raw as unknown as { role: string }).role as string;
          nullCount.byRole[role] = (nullCount.byRole[role] || 0) + 1;
          nullCount.total++;
          log.warn("messageToChatMessage returned null", {
            sessionId: sid,
            id,
            role,
            rawKeys: Object.keys(raw),
          });
        }
      }
      log.info("After messageToChatMessage", {
        sessionId: sid,
        mapped: msgs.length,
        raw: rawMessages.length,
        nullCount,
      });

      normalizeToolBlocks(msgs, true, false);

      const customEntries = normalizeMemoryCustomEntries(rawCustomEntries);
      if (Array.isArray(customEntries)) {
        syncMemoryCustomEntries(sid, customEntries, { clearSession: true });
      }

      const hasMore = result.hasMore === true || msgs.length > PAGE_SIZE;
      const displayMsgs = mergeRenderableCustomMessages(msgs, customEntries);

      log.info("SET messages", {
        sessionId: sid,
        total: msgs.length,
        displayed: displayMsgs.length,
        hasMore,
        serverHasMore: result.hasMore,
        serverTotalCount: result.totalCount,
      });

      perfLog.info("[loadMessages] done", {
        sessionId: sid,
        total: msgs.length,
        displayed: displayMsgs.length,
        totalMs: Math.round(performance.now() - t0),
      });

      const localMsgs = (get().messagesBySession[sid] || []).filter((m) => m._local);
      const currentMsgs = get().messagesBySession[sid] || [];

      // When streaming, preserve the last streaming assistant message.
      // getFullMessages auto-merges CLI in-memory messages, but the merge is not
      // always complete — thinking/text blocks that just arrived may be missing.
      // Without this, a loadSessionMessages triggered during streaming (e.g.
      // empty-streaming recovery reload) would drop the streaming assistant
      // message, causing the next message_update to create a NEW synthetic
      // message — splitting thinking from text into two separate cards.
      const lastCurrent = currentMsgs[currentMsgs.length - 1];
      const isStreamingSession = useSessionStore.getState().sessionStatusMap[sid] === "streaming";
      const preserveStreaming =
        options?.preserveStreaming !== false &&
        isStreamingSession &&
        lastCurrent &&
        lastCurrent.role === "assistant" &&
        lastCurrent.isStreaming === true;

      // Dedup _local messages against server messages to prevent duplicates.
      // The server returns user messages from JSONL; if a _local user message
      // has matching text content with a server message, the server version wins.
      const nonDupLocalMsgs = localMsgs.filter((local) => {
        if (local.role !== "user") return true;
        const localText = local.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("");
        if (!localText) return true;
        return !displayMsgs.some((srv) => {
          if (srv.role !== "user") return false;
          const srvText = srv.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("");
          return srvText === localText;
        });
      });

      let finalMsgs =
        nonDupLocalMsgs.length > 0 ? [...displayMsgs, ...nonDupLocalMsgs] : displayMsgs;

      if (preserveStreaming) {
        const streamingInFinal = finalMsgs.findIndex(
          (m) => m.role === "assistant" && m.isStreaming,
        );
        const preservedStreamingMsg = buildPreservedStreamingMessage(finalMsgs, lastCurrent);
        if (streamingInFinal === -1 && preservedStreamingMsg) {
          finalMsgs = [...finalMsgs, preservedStreamingMsg];
        }
      }

      normalizeToolBlocks(finalMsgs, true, false);
      finalMsgs = prepareMessagesForStore(finalMsgs, {
        activeToolCallIds: get().activeToolCallIdsBySession[sid],
      });

      if (hasSameMessageSnapshots(currentMsgs, finalMsgs)) {
        perfLog.info("[loadMessages] content unchanged, skip update", {
          sessionId: sid,
          count: finalMsgs.length,
        });
        set((s) => ({
          ...(options?.force ? bumpHistoryLoadVersion(s, sid) : {}),
          hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: hasMore },
          hasTrimmedTailMessagesBySession: {
            ...s.hasTrimmedTailMessagesBySession,
            [sid]: false,
          },
          nextCursorBySession: {
            ...s.nextCursorBySession,
            [sid]: result.nextCursor ?? null,
          },
          messageHydrationBySession: {
            ...s.messageHydrationBySession,
            [sid]: "ready",
          },
        }));
      } else {
        set((s) => ({
          messagesBySession: setSessionMessagesWithCacheLimit(s.messagesBySession, sid, finalMsgs),
          ...bumpHistoryLoadVersion(s, sid),
          hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: hasMore },
          hasTrimmedTailMessagesBySession: {
            ...s.hasTrimmedTailMessagesBySession,
            [sid]: false,
          },
          nextCursorBySession: {
            ...s.nextCursorBySession,
            [sid]: result.nextCursor ?? null,
          },
          messageHydrationBySession: {
            ...s.messageHydrationBySession,
            [sid]: "ready",
          },
        }));
      }

      useSessionStore.getState().restoreContextFromHistory(sid);

      // After messages are loaded, replay the bash store into the chat tool
      // blocks. This covers the case where bash events arrived in the window
      // between the bash subscription being set up and the messages being
      // fetched — without this, the chat's "Output" section would stay empty
      // until the next bash event triggers a fresh reconciliation.
      try {
        const { syncBashStoreToChat } = await import("./session-subscriptions");
        syncBashStoreToChat(sid);
      } catch (err) {
        log.warn("syncBashStoreToChat failed after loadSessionMessages", {
          sessionId: sid,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } catch (err) {
      log.error("Failed to load session", {
        error: err instanceof Error ? err.message : String(err),
      });
      useAppStore
        .getState()
        .addLog(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
      set((s) => ({
        messageHydrationBySession: {
          ...s.messageHydrationBySession,
          [sid]: "error",
        },
      }));
    } finally {
      set((s) => {
        const next = new Set(s.loadingSessions);
        next.delete(sid);
        return { loadingSessions: next };
      });
    }
  },

  loadFocusedMessagesAround: async (
    sessionId: string,
    targetEntryId: string,
    options?: { sessionPath?: string; before?: number; after?: number },
  ) => {
    const sid = sessionId;
    if (!sid || !targetEntryId) return false;
    if (get().isLoadingMoreBySession[sid]) return false;

    set((s) => ({
      isLoadingMoreBySession: { ...s.isLoadingMoreBySession, [sid]: true },
    }));

    try {
      const ss = useSessionStore.getState();
      const sessionMeta = Object.values(ss.sessionsByProject)
        .flat()
        .find((s) => s.sessionId === sid);
      const sessionPath = options?.sessionPath ?? sessionMeta?.sessionPath;
      const result = await apiClient.call("agent.getFullMessagesAround", {
        sessionId: sid,
        sessionPath,
        targetEntryId,
        before: options?.before ?? PAGE_SIZE,
        after: options?.after ?? PAGE_SIZE,
      });
      if (!result.targetFound || !Array.isArray(result.messages)) {
        log.warn("Focused message window target not found", { sessionId: sid, targetEntryId });
        return false;
      }

      const rawCustomEntries = Array.isArray(result.customEntries) ? result.customEntries : [];
      const focusedMsgs = mapRpcMessagesToStoreMessages(sid, result.messages, rawCustomEntries, {
        activeToolCallIds: get().activeToolCallIdsBySession[sid],
      });

      set((s) => ({
        focusMessagesBySession: {
          ...s.focusMessagesBySession,
          [sid]: focusedMsgs,
        },
        messageViewBySession: {
          ...s.messageViewBySession,
          [sid]: "focus",
        },
        focusWindowMetaBySession: {
          ...s.focusWindowMetaBySession,
          [sid]: {
            targetEntryId,
            beforeCursor: result.beforeCursor ?? null,
            afterCursor: result.afterCursor ?? null,
            hasMoreBefore: result.hasMoreBefore === true,
            hasMoreAfter: result.hasMoreAfter === true,
          },
        },
        ...bumpHistoryLoadVersion(s, sid, false),
      }));
      return true;
    } catch (err) {
      log.error("Failed to load focused message window", {
        sessionId: sid,
        targetEntryId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      set((s) => ({
        isLoadingMoreBySession: { ...s.isLoadingMoreBySession, [sid]: false },
      }));
    }
  },

  clearFocusedMessages: (sessionId: string) => {
    const sid = sessionId;
    set((s) => {
      const { [sid]: _focus, ...restFocusMessages } = s.focusMessagesBySession;
      const { [sid]: _meta, ...restFocusMeta } = s.focusWindowMetaBySession;
      return {
        focusMessagesBySession: restFocusMessages,
        focusWindowMetaBySession: restFocusMeta,
        messageViewBySession: { ...s.messageViewBySession, [sid]: "tail" },
        ...bumpHistoryLoadVersion(s, sid, false),
      };
    });
  },

  /** Background refresh: fetch latest messages from server and silently update store if different.
   *  Used after optimistic render from cache to guarantee data completeness. */
  _backgroundRefreshMessages: async (sessionId: string, sessionPath?: string) => {
    const sid = sessionId;
    // Don't run if already loading (avoid competing with foreground load)
    if (get().loadingSessions.has(sid)) return;

    const refreshGeneration = (backgroundRefreshGenerationBySession.get(sid) ?? 0) + 1;
    backgroundRefreshGenerationBySession.set(sid, refreshGeneration);

    const t0 = performance.now();
    perfLog.info("[bgRefresh] begin", { sessionId: sid });

    set((s) => ({
      loadingSessions: new Set(s.loadingSessions).add(sid),
      messageHydrationBySession: {
        ...s.messageHydrationBySession,
        [sid]: "loading",
      },
    }));

    try {
      const { apiClient } = await import("../lib/api-client");
      const BG_REFRESH_TIMEOUT_MS = 15_000;
      const result = (await Promise.race([
        apiClient.call("agent.getFullMessages", {
          sessionId: sid,
          sessionPath,
          limit: PAGE_SIZE,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("bgRefresh getFullMessages timed out (15s)")),
            BG_REFRESH_TIMEOUT_MS,
          ),
        ),
      ])) as Awaited<ReturnType<typeof apiClient.call<"agent.getFullMessages">>>;

      const rpcMs = Math.round(performance.now() - t0);
      perfLog.info("[bgRefresh] RPC returned", {
        sessionId: sid,
        rpcMs,
        messageCount: result.messages?.length,
      });

      const messages = result.messages;
      if (!Array.isArray(messages)) {
        set((s) => ({
          messageHydrationBySession: {
            ...s.messageHydrationBySession,
            [sid]: "error",
          },
        }));
        return;
      }
      if (backgroundRefreshGenerationBySession.get(sid) !== refreshGeneration) {
        perfLog.info("[bgRefresh] stale response ignored", { sessionId: sid });
        return;
      }

      // Process messages the same way as loadSessionMessages
      const toolCallNameMap: Record<string, string> = {};
      const msgs: ChatMessage[] = [];
      const rawCustomEntries = Array.isArray(result.customEntries) ? result.customEntries : [];
      for (const msg of messages) {
        const mapped = mapMessageWithProviderDiagnostics(
          msg,
          msg.id,
          toolCallNameMap,
          rawCustomEntries,
        );
        if (mapped) msgs.push(mapped);
      }
      normalizeToolBlocks(msgs, true, false);

      const customEntries = normalizeMemoryCustomEntries(rawCustomEntries);
      if (Array.isArray(customEntries)) {
        syncMemoryCustomEntries(sid, customEntries, { clearSession: true });
      }

      // Compare with current store: only update if different
      const current = get().messagesBySession[sid] || [];

      const serverIds = new Set(msgs.map((m) => m.id));
      const localOnly = current.filter((m) => m._local && !serverIds.has(m.id));
      const hasMore = result.hasMore === true || msgs.length > PAGE_SIZE;
      let finalMsgs =
        localOnly.length > 0
          ? [...msgs, ...localOnly].sort((a, b) => a.timestamp - b.timestamp)
          : msgs;
      finalMsgs = mergeRenderableCustomMessages(finalMsgs, customEntries);

      const lastCurrent = current[current.length - 1];
      const preservedStreamingMsg = buildPreservedStreamingMessage(finalMsgs, lastCurrent);
      if (preservedStreamingMsg) {
        finalMsgs = [...finalMsgs, preservedStreamingMsg];
      }
      normalizeToolBlocks(finalMsgs, true, false);
      finalMsgs = prepareMessagesForStore(finalMsgs, {
        activeToolCallIds: get().activeToolCallIdsBySession[sid],
      });

      if (hasSameMessageSnapshots(current, finalMsgs)) {
        perfLog.info("[bgRefresh] data unchanged, skip update", {
          sessionId: sid,
          count: finalMsgs.length,
        });
        set((s) => ({
          hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: hasMore },
          hasTrimmedTailMessagesBySession: {
            ...s.hasTrimmedTailMessagesBySession,
            [sid]: false,
          },
          nextCursorBySession: {
            ...s.nextCursorBySession,
            [sid]: result.nextCursor ?? null,
          },
          messageHydrationBySession: {
            ...s.messageHydrationBySession,
            [sid]: "ready",
          },
        }));
      } else {
        perfLog.info("[bgRefresh] data changed, updating store", {
          sessionId: sid,
          oldCount: current.length,
          newCount: finalMsgs.length,
        });
        set((s) => ({
          messagesBySession: setSessionMessagesWithCacheLimit(s.messagesBySession, sid, finalMsgs),
          ...bumpHistoryLoadVersion(s, sid),
          hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: hasMore },
          hasTrimmedTailMessagesBySession: {
            ...s.hasTrimmedTailMessagesBySession,
            [sid]: false,
          },
          nextCursorBySession: {
            ...s.nextCursorBySession,
            [sid]: result.nextCursor ?? null,
          },
          messageHydrationBySession: {
            ...s.messageHydrationBySession,
            [sid]: "ready",
          },
        }));
        useSessionStore.getState().restoreContextFromHistory(sid);
      }
    } catch (err) {
      perfLog.info("[bgRefresh] failed (non-critical)", {
        sessionId: sid,
        error: err instanceof Error ? err.message : String(err),
      });
      set((s) => ({
        messageHydrationBySession: {
          ...s.messageHydrationBySession,
          [sid]: "error",
        },
      }));
      // Background refresh failure is non-critical: cached messages are still visible
    } finally {
      if (backgroundRefreshGenerationBySession.get(sid) === refreshGeneration) {
        set((s) => {
          const next = new Set(s.loadingSessions);
          next.delete(sid);
          return { loadingSessions: next };
        });
      }
    }
  },

  loadMoreMessages: async (sessionId: string) => {
    const sid = sessionId;
    if (!sid) return;

    const hasMore = get().hasMoreMessagesBySession[sid];
    if (!hasMore) {
      log.info("No more messages to load", { sessionId: sid });
      return;
    }
    if (get().isLoadingMoreBySession[sid]) {
      log.warn("Already loading more", { sessionId: sid });
      return;
    }

    set((s) => ({
      isLoadingMoreBySession: { ...s.isLoadingMoreBySession, [sid]: true },
    }));

    try {
      const LOAD_MORE_TIMEOUT_MS = 60_000;
      const afterEntryId = get().nextCursorBySession[sid] ?? undefined;
      // Look up sessionPath from session store
      const ss = useSessionStore.getState();
      const sessionMeta = Object.values(ss.sessionsByProject)
        .flat()
        .find((s) => s.sessionId === sid);
      const sessionPath = sessionMeta?.sessionPath;
      perfLog.info("[loadMoreMessages] begin", { sessionId, afterEntryId });
      const result = (await Promise.race([
        apiClient.call("agent.getFullMessages", {
          sessionId,
          sessionPath,
          afterEntryId,
          limit: PAGE_SIZE,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("loadMoreMessages timed out (60s)")),
            LOAD_MORE_TIMEOUT_MS,
          ),
        ),
      ])) as Awaited<ReturnType<typeof apiClient.call<"agent.getFullMessages">>>;
      const messages = result.messages;
      if (!Array.isArray(messages)) return;

      const toolCallNameMap: Record<string, string> = {};
      const allMsgs: ChatMessage[] = [];
      const rawCustomEntries = Array.isArray(result.customEntries) ? result.customEntries : [];

      for (const msg of messages) {
        const role = msg.role;
        if (role === "assistant") {
          const content = msg.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "toolCall" && block.id && block.name) {
                toolCallNameMap[block.id] = block.name;
              }
            }
          }
        }
        const chatMsg = mapMessageWithProviderDiagnostics(
          msg,
          msg.id,
          toolCallNameMap,
          rawCustomEntries,
        );
        if (chatMsg) allMsgs.push(chatMsg);
      }
      normalizeToolBlocks(allMsgs, true, false);

      const hasMore = result.hasMore === true;

      log.info("LOAD MORE messages", {
        sessionId: sid,
        total: allMsgs.length,
        hasMore,
      });

      const loadedIds = new Set(allMsgs.map((msg) => msg.id));
      const current = get().messagesBySession[sid] || [];
      const mergedMsgs = [...allMsgs, ...current.filter((m) => !loadedIds.has(m.id))].sort(
        (a, b) => {
          if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
          return (a.entryId ?? a.id).localeCompare(b.entryId ?? b.id);
        },
      );
      const canTrimTail = !current.some((m) => (m._local ?? false) || (m.isStreaming ?? false));
      const windowed = canTrimTail
        ? limitLoadedHistoryWindow(mergedMsgs)
        : { messages: mergedMsgs, trimmedTail: false };
      const finalMsgs = windowed.messages;
      normalizeToolBlocks(finalMsgs, true, false);
      const preparedMsgs = prepareMessagesForStore(finalMsgs, {
        activeToolCallIds: get().activeToolCallIdsBySession[sid],
      });

      if (hasSameMessageSnapshots(current, preparedMsgs)) {
        set((s) => ({
          hasMoreMessagesBySession: {
            ...s.hasMoreMessagesBySession,
            [sid]: hasMore,
          },
          hasTrimmedTailMessagesBySession: {
            ...s.hasTrimmedTailMessagesBySession,
            [sid]: s.hasTrimmedTailMessagesBySession[sid] || windowed.trimmedTail,
          },
          nextCursorBySession: {
            ...s.nextCursorBySession,
            [sid]: result.nextCursor ?? null,
          },
        }));
        return;
      }

      set((s) => ({
        messagesBySession: setSessionMessagesWithCacheLimit(s.messagesBySession, sid, preparedMsgs),
        hasMoreMessagesBySession: {
          ...s.hasMoreMessagesBySession,
          [sid]: hasMore,
        },
        hasTrimmedTailMessagesBySession: {
          ...s.hasTrimmedTailMessagesBySession,
          [sid]: s.hasTrimmedTailMessagesBySession[sid] || windowed.trimmedTail,
        },
        nextCursorBySession: {
          ...s.nextCursorBySession,
          [sid]: result.nextCursor ?? null,
        },
      }));
    } catch (err) {
      log.error("Failed to load more messages", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      set((s) => ({
        isLoadingMoreBySession: { ...s.isLoadingMoreBySession, [sid]: false },
      }));
    }
  },

  clearTopWindowMessages: (sessionId: string) => {
    const sid = sessionId;
    const topIds = topWindowMessageIdsBySession.get(sid);
    if (!topIds || topIds.size === 0) return;

    const snapshot = bottomPaginationSnapshotBySession.get(sid);
    topWindowMessageIdsBySession.delete(sid);
    bottomPaginationSnapshotBySession.delete(sid);

    set((s) => {
      const current = s.messagesBySession[sid] || [];
      const nextMessages = current.filter((message) => !topIds.has(message.id));
      return {
        messagesBySession: setSessionMessagesWithCacheLimit(s.messagesBySession, sid, nextMessages),
        hasMoreMessagesBySession: {
          ...s.hasMoreMessagesBySession,
          [sid]: snapshot?.hasMore ?? s.hasMoreMessagesBySession[sid] ?? true,
        },
        nextCursorBySession: {
          ...s.nextCursorBySession,
          [sid]: snapshot?.nextCursor ?? s.nextCursorBySession[sid] ?? null,
        },
      };
    });
  },

  loadTopMessages: async (sessionId: string) => {
    const sid = sessionId;
    if (!sid) return;
    if (get().isLoadingMoreBySession[sid]) {
      log.warn("Already loading messages", { sessionId: sid });
      return;
    }

    set((s) => ({
      isLoadingMoreBySession: { ...s.isLoadingMoreBySession, [sid]: true },
    }));

    try {
      const LOAD_TOP_TIMEOUT_MS = 60_000;
      const ss = useSessionStore.getState();
      const sessionMeta = Object.values(ss.sessionsByProject)
        .flat()
        .find((s) => s.sessionId === sid);
      const sessionPath = sessionMeta?.sessionPath;
      perfLog.info("[loadTopMessages] begin", { sessionId: sid });
      const result = (await Promise.race([
        apiClient.call("agent.getFullMessages", {
          sessionId: sid,
          sessionPath,
          fromStart: true,
          limit: PAGE_SIZE,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("loadTopMessages timed out (60s)")),
            LOAD_TOP_TIMEOUT_MS,
          ),
        ),
      ])) as Awaited<ReturnType<typeof apiClient.call<"agent.getFullMessages">>>;
      const messages = result.messages;
      if (!Array.isArray(messages)) return;

      const toolCallNameMap: Record<string, string> = {};
      const topMsgs: ChatMessage[] = [];
      const rawCustomEntries = Array.isArray(result.customEntries) ? result.customEntries : [];

      for (const msg of messages) {
        const role = msg.role;
        if (role === "assistant") {
          const content = msg.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "toolCall" && block.id && block.name) {
                toolCallNameMap[block.id] = block.name;
              }
            }
          }
        }
        const chatMsg = mapMessageWithProviderDiagnostics(
          msg,
          msg.id,
          toolCallNameMap,
          rawCustomEntries,
        );
        if (chatMsg) topMsgs.push(chatMsg);
      }
      normalizeToolBlocks(topMsgs, true, false);

      const loadedIds = new Set(topMsgs.map((msg) => msg.id));
      const current = get().messagesBySession[sid] || [];
      const currentIds = new Set(current.map((message) => message.id));
      const transientTopIds = new Set(
        topMsgs.filter((msg) => !currentIds.has(msg.id)).map((msg) => msg.id),
      );
      if (transientTopIds.size > 0) {
        bottomPaginationSnapshotBySession.set(sid, {
          hasMore: get().hasMoreMessagesBySession[sid],
          nextCursor: get().nextCursorBySession[sid],
        });
        topWindowMessageIdsBySession.set(sid, transientTopIds);
      } else {
        bottomPaginationSnapshotBySession.delete(sid);
        topWindowMessageIdsBySession.delete(sid);
      }
      const mergedMsgs = [...topMsgs, ...current.filter((m) => !loadedIds.has(m.id))].sort(
        (a, b) => {
          if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
          return (a.entryId ?? a.id).localeCompare(b.entryId ?? b.id);
        },
      );
      normalizeToolBlocks(mergedMsgs, true, false);
      const preparedMsgs = prepareMessagesForStore(mergedMsgs, {
        activeToolCallIds: get().activeToolCallIdsBySession[sid],
      });

      set((s) => ({
        messagesBySession: setSessionMessagesWithCacheLimit(s.messagesBySession, sid, preparedMsgs),
        hasMoreMessagesBySession: {
          ...s.hasMoreMessagesBySession,
          [sid]: false,
        },
        nextCursorBySession: {
          ...s.nextCursorBySession,
          [sid]: null,
        },
      }));
    } catch (err) {
      log.error("Failed to load top messages", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      set((s) => ({
        isLoadingMoreBySession: { ...s.isLoadingMoreBySession, [sid]: false },
      }));
    }
  },

  saveInputDraft: (sessionId: string) => {
    const text = get().inputText;
    writeDraft(sessionId, text);
  },

  restoreInputDraft: (sessionId: string) => {
    const text = readDraft(sessionId);
    set({ inputText: text });
  },

  clearInputDraft: (sessionId: string) => {
    writeDraft(sessionId, "");
    if (useSessionStore.getState().activeSessionId === sessionId) {
      set({ inputText: "" });
    }
  },
}));

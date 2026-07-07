import { create } from "zustand";
import type {
  SubagentSessionInfo,
  ChatMessage,
  ContentBlock,
  SessionStatus,
  ContextUsage,
  TokenUsage,
} from "../types";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, Message, Usage } from "@dyyz1993/pi-ai";
import { apiClient } from "../lib/api-client";
import { messageToChatMessage } from "../lib/message-mapper";
import { batchMessageUpdate, flushNow } from "../lib/message-batcher";
import {
  closeRunningToolExecutions,
  findMatchingToolExecution,
  formatToolArgs,
  isDelayedTerminalMessageUpdate,
} from "../lib/agent-event-reconciler";
import { buildSubagentTerminalPatch } from "../lib/subagent-terminal-state";
import { useSessionStore } from "./use-session-store";
import { useUIDialogStore } from "./use-ui-dialog-store";
import { createLogger } from "../../shared/lib/logger";
import type { ExtensionUIRequestEvent, ExtensionUIResolvedEvent } from "../../shared/modules/agent";

const log = createLogger("subagent");

const subToolCallNameMapBySubId: Record<string, Record<string, string>> = {};
const INTERACTIVE_UI_METHODS = new Set(["askUserQuestion", "confirm", "input", "select", "editor"]);
const inFlightSubsessionLoads = new Map<string, Promise<SubagentSessionInfo[]>>();

type InteractiveSubagentMethod = "askUserQuestion" | "confirm" | "input" | "select" | "editor";

function isInteractiveUIRequest(
  request: ExtensionUIRequestEvent,
): request is ExtensionUIRequestEvent & { method: InteractiveSubagentMethod } {
  return typeof request.id === "string" && INTERACTIVE_UI_METHODS.has(request.method);
}

function registerSubagentUIRequest(
  subId: string,
  request: ExtensionUIRequestEvent & { method: InteractiveSubagentMethod },
  parentSessionId?: string,
): void {
  useUIDialogStore.getState().registerUIRequest({
    requestId: request.id,
    sessionId: subId,
    parentSessionId,
    method: request.method,
    title: request.title,
    message: request.message,
    options: request.options,
    questions: request.questions,
    multiple: request.multiple,
    placeholder: request.placeholder,
    prefill: request.prefill,
    timeout: request.timeout,
    toolCallId: request.toolCallId,
    confirmText: request.confirmText,
    cancelText: request.cancelText,
    hookMeta: request.hookMeta,
    permissionMeta: request.permissionMeta,
  });
  useSubagentStore.getState().updateSubagentStatus(subId, "permission");
}

function findParentSessionIdByPath(parentSessionPath: string): string | undefined {
  for (const sessions of Object.values(useSessionStore.getState().sessionsByProject ?? {})) {
    const match = sessions.find((session) => session.sessionPath === parentSessionPath);
    if (match) return match.sessionId;
  }
  return undefined;
}

function findSessionPathById(sessionId: string): string | undefined {
  for (const sessions of Object.values(useSessionStore.getState().sessionsByProject ?? {})) {
    const match = sessions.find((session) => session.sessionId === sessionId);
    if (match) return match.sessionPath;
  }
  return undefined;
}

function findKnownSubsession(
  subsessionsByParent: Record<string, SubagentSessionInfo[]>,
  subId: string,
): SubagentSessionInfo | undefined {
  for (const subs of Object.values(subsessionsByParent)) {
    const match = subs.find((sub) => sub.sessionId === subId);
    if (match) return match;
  }
  return undefined;
}

async function restoreSubagentRuntimeState(
  sub: SubagentSessionInfo,
  parentSessionId?: string,
): Promise<void> {
  try {
    const result = (await apiClient.call("agent.getState", {
      sessionId: sub.sessionId,
    })) as {
      isStreaming?: boolean;
      isCompacting?: boolean;
      pendingUIRequests?: ExtensionUIRequestEvent[];
    } | null;

    if (!result) return;

    const pendingUIRequests = Array.isArray(result.pendingUIRequests)
      ? result.pendingUIRequests.filter(isInteractiveUIRequest)
      : [];

    if (pendingUIRequests.length > 0) {
      for (const request of pendingUIRequests) {
        registerSubagentUIRequest(sub.sessionId, request, parentSessionId);
      }
      return;
    }

    if (result.isCompacting) {
      useSubagentStore.getState().updateSubagentStatus(sub.sessionId, "compacting");
      return;
    }

    if (result.isStreaming) {
      useSubagentStore.getState().updateSubagentStatus(sub.sessionId, "streaming");
      return;
    }

    if (!sub.completedAt) {
      useSubagentStore.getState().updateSubagentStatus(sub.sessionId, "idle");
    }
  } catch (error) {
    log.debug("restoreSubagentRuntimeState skipped", {
      subId: sub.sessionId,
      error: String(error),
    });
  }
}

interface SubagentState {
  subsessionsByParent: Record<string, SubagentSessionInfo[]>;
  activeSubsessionId: string | null;
  messagesBySubsession: Record<string, ChatMessage[]>;
  loadingByParent: Record<string, boolean>;
  subagentStatusMap: Record<string, SessionStatus>;
  subagentContextMap: Record<string, ContextUsage>;

  loadSubsessions: (parentSessionPath: string, force?: boolean) => Promise<SubagentSessionInfo[]>;
  setActiveSubsession: (parentSessionId: string, subId: string | null) => void;
  setSubMessages: (subId: string, msgs: ChatMessage[]) => void;
  loadSubHistory: (subSessionPath: string, subId: string) => Promise<void>;
  upsertLiveSubagent: (
    parentSessionPath: string,
    subId: string,
    partial: Partial<SubagentSessionInfo>,
  ) => void;
  updateSubagentStatus: (subId: string, status: SessionStatus) => void;
  updateSubagentContext: (subId: string, update: Partial<ContextUsage>) => void;
  renameSubagent: (parentSessionPath: string, subSessionId: string, newDescription: string) => void;
  deleteSubagent: (parentSessionPath: string, subSessionId: string) => void;
}

export const useSubagentStore = create<SubagentState>()((set, get) => ({
  subsessionsByParent: {},
  activeSubsessionId: null,
  messagesBySubsession: {},
  loadingByParent: {},
  subagentStatusMap: {},
  subagentContextMap: {},

  updateSubagentStatus: (subId, status) => {
    set((s) => ({
      subagentStatusMap: { ...s.subagentStatusMap, [subId]: status },
    }));
  },

  updateSubagentContext: (subId, update) => {
    set((s) => {
      const prev = s.subagentContextMap[subId] || { tokens: null, contextWindow: 0 };
      return {
        subagentContextMap: {
          ...s.subagentContextMap,
          [subId]: { ...prev, ...update },
        },
      };
    });
  },

  loadSubsessions: (parentSessionPath: string, force = false) => {
    const existingLoad = inFlightSubsessionLoads.get(parentSessionPath);
    if (existingLoad) return existingLoad;
    if (!force && get().subsessionsByParent[parentSessionPath])
      return Promise.resolve(get().subsessionsByParent[parentSessionPath]);

    if (get().loadingByParent[parentSessionPath]) return Promise.resolve([]);

    let loadPromise: Promise<SubagentSessionInfo[]> = Promise.resolve([]);
    loadPromise = (async () => {
      set((s) => ({ loadingByParent: { ...s.loadingByParent, [parentSessionPath]: true } }));
      try {
        const result = await apiClient.call("subagent.listBySession", {
          sessionPath: parentSessionPath,
        });
        const subs = result.subsessions as SubagentSessionInfo[];
        set((s) => ({
          subsessionsByParent: { ...s.subsessionsByParent, [parentSessionPath]: subs },
          loadingByParent: { ...s.loadingByParent, [parentSessionPath]: false },
        }));
        const parentSessionId = findParentSessionIdByPath(parentSessionPath);
        const activeSubId = get().activeSubsessionId;
        const activeSub = activeSubId ? subs.find((sub) => sub.sessionId === activeSubId) : null;
        void Promise.all([
          ...subs.map((sub) => restoreSubagentRuntimeState(sub, parentSessionId)),
          activeSub?.sessionPath
            ? get().loadSubHistory(activeSub.sessionPath, activeSub.sessionId)
            : Promise.resolve(),
        ]).catch((error) => {
          log.debug("restoreSubagentRuntimeState batch skipped", {
            parentSessionPath,
            error: String(error),
          });
        });
        return subs;
      } catch (e) {
        log.warn("Failed to list subagents by session", { parentSessionPath, error: String(e) });
        set((s) => ({ loadingByParent: { ...s.loadingByParent, [parentSessionPath]: false } }));
        return [];
      } finally {
        if (inFlightSubsessionLoads.get(parentSessionPath) === loadPromise) {
          inFlightSubsessionLoads.delete(parentSessionPath);
        }
      }
    })();

    inFlightSubsessionLoads.set(parentSessionPath, loadPromise);
    return loadPromise;
  },

  setActiveSubsession: (_parentSessionId: string, subId: string | null) => {
    set({ activeSubsessionId: subId });

    if (!subId) return;

    const match = findKnownSubsession(get().subsessionsByParent, subId);
    if (match?.sessionPath) {
      get().loadSubHistory(match.sessionPath, subId);
      return;
    }

    const subSessionPath = findSessionPathById(subId);
    if (subSessionPath) {
      get().loadSubHistory(subSessionPath, subId);
      return;
    }

    const parentSessionPath = findSessionPathById(_parentSessionId);
    if (parentSessionPath) {
      void get().loadSubsessions(parentSessionPath, true);
    }
  },

  setSubMessages: (subId, msgs) =>
    set((s) => ({ messagesBySubsession: { ...s.messagesBySubsession, [subId]: msgs } })),

  loadSubHistory: async (subSessionPath, subId) => {
    try {
      const { useChatStore } = await import("./use-chat-store");
      await useChatStore
        .getState()
        .loadSessionMessages(subId, { force: true, sessionPath: subSessionPath });
      const syncedMessages = useChatStore.getState().messagesBySession[subId] || [];
      get().setSubMessages(subId, syncedMessages);
    } catch (e) {
      log.warn("Failed to load subagent history", { subSessionPath, subId, error: String(e) });
    }
  },

  upsertLiveSubagent: (
    parentSessionPath: string,
    subId: string,
    partial: Partial<SubagentSessionInfo>,
  ) => {
    set((s) => {
      const existing = s.subsessionsByParent[parentSessionPath] || [];
      const idx = existing.findIndex((e) => e.sessionId === subId);
      const base =
        idx >= 0
          ? existing[idx]
          : {
              sessionId: subId,
              sessionPath: "",
              description: "",
              instruction: "",
              startedAt: Date.now(),
            };
      const merged: SubagentSessionInfo = { ...base, ...partial };
      let updated: SubagentSessionInfo[];
      if (idx >= 0) {
        updated = [...existing];
        updated[idx] = merged;
      } else {
        updated = [...existing, merged];
      }
      return {
        ...s,
        subsessionsByParent: { ...s.subsessionsByParent, [parentSessionPath]: updated },
      };
    });
  },

  renameSubagent: (parentSessionPath: string, subSessionId: string, newDescription: string) => {
    const trimmed = newDescription.trim();
    if (!trimmed) return;

    set((s) => {
      const existing = s.subsessionsByParent[parentSessionPath];
      if (!existing) return s;
      const idx = existing.findIndex((e) => e.sessionId === subSessionId);
      if (idx < 0) return s;
      const updated = [...existing];
      updated[idx] = { ...updated[idx], description: trimmed };
      return { subsessionsByParent: { ...s.subsessionsByParent, [parentSessionPath]: updated } };
    });

    apiClient
      .call("subagent.rename", { parentSessionPath, subSessionId, newDescription: trimmed })
      .catch((err) => {
        log.warn("subagent.rename failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      });
  },

  deleteSubagent: (parentSessionPath: string, subSessionId: string) => {
    set((s) => {
      const existing = s.subsessionsByParent[parentSessionPath];
      if (!existing) return s;
      const updated = existing.filter((e) => e.sessionId !== subSessionId);
      if (updated.length === existing.length) return s;
      const newMessages = { ...s.messagesBySubsession };
      delete newMessages[subSessionId];
      const newStatus = { ...s.subagentStatusMap };
      delete newStatus[subSessionId];
      const newContext = { ...s.subagentContextMap };
      delete newContext[subSessionId];
      const newActive = s.activeSubsessionId === subSessionId ? null : s.activeSubsessionId;
      return {
        subsessionsByParent: { ...s.subsessionsByParent, [parentSessionPath]: updated },
        messagesBySubsession: newMessages,
        subagentStatusMap: newStatus,
        subagentContextMap: newContext,
        activeSubsessionId: newActive,
      };
    });

    apiClient.call("subagent.delete", { parentSessionPath, subSessionId }).catch((err) => {
      log.warn("subagent.delete failed", { err: err instanceof Error ? err.message : String(err) });
    });

    delete subToolCallNameMapBySubId[subSessionId];
  },
}));

function extractTokenUsage(usage: unknown): TokenUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const input = Number(u.inputTokens ?? u.input ?? 0) || 0;
  const output = Number(u.outputTokens ?? u.output ?? 0) || 0;
  if (!input && !output) return null;
  return {
    input,
    output,
    reasoning: typeof u.reasoningTokens === "number" ? u.reasoningTokens : undefined,
    cacheRead: typeof u.cacheReadTokens === "number" ? u.cacheReadTokens : undefined,
    cacheWrite: typeof u.cacheWriteTokens === "number" ? u.cacheWriteTokens : undefined,
    cost: typeof u.cost === "number" ? u.cost : undefined,
  };
}

type SubagentCustomEvent =
  | { type: "subagent_start"; description: string; instruction: string }
  | { type: "compaction_start"; reason: string }
  | { type: "compaction_end"; reason: string; result: { tokensAfter?: number }; aborted: boolean }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: "auto_retry_end" };

type SubagentEvent =
  | AgentEvent
  | SubagentCustomEvent
  | ExtensionUIRequestEvent
  | ExtensionUIResolvedEvent;

function replaceMsgAt(msgs: ChatMessage[], idx: number, replacement: ChatMessage): ChatMessage[] {
  return [...msgs.slice(0, idx), replacement, ...msgs.slice(idx + 1)];
}

interface HandleSubagentEventOptions {
  skipUIRegistration?: boolean;
  skipMessageMirroring?: boolean;
}

function isSubagentMessageMirrorEvent(event: SubagentEvent): boolean {
  return (
    event.type === "message_start" ||
    event.type === "message_update" ||
    event.type === "message_end" ||
    event.type === "turn_end" ||
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  );
}

export function handleSubagentEvent(
  subId: string,
  event: SubagentEvent,
  parentSessionId?: string,
  options: HandleSubagentEventOptions = {},
) {
  const store = useSubagentStore.getState();

  if (
    event.type === "extension_ui_request" &&
    isInteractiveUIRequest(event as ExtensionUIRequestEvent)
  ) {
    if (options.skipUIRegistration) {
      store.updateSubagentStatus(subId, "permission");
      return;
    }
    registerSubagentUIRequest(
      subId,
      event as ExtensionUIRequestEvent & { method: InteractiveSubagentMethod },
      parentSessionId,
    );
    return;
  }

  if (event.type === "extension_ui_resolved") {
    if (options.skipUIRegistration) {
      const current = useSubagentStore.getState().subagentStatusMap[subId];
      if (current === "permission") {
        store.updateSubagentStatus(subId, "streaming");
      }
      return;
    }
    const requestId = typeof event.id === "string" ? event.id : undefined;
    const reason =
      event.reason === "timeout" || event.reason === "aborted" || event.reason === "responded"
        ? event.reason
        : "responded";
    if (requestId) {
      useUIDialogStore.getState().resolveFromRemote(requestId, reason);
    }
    const current = useSubagentStore.getState().subagentStatusMap[subId];
    if (current === "permission") {
      store.updateSubagentStatus(subId, "streaming");
    }
    return;
  }

  if (event.type === "agent_start" || event.type === "subagent_start") {
    store.updateSubagentStatus(subId, "streaming");
    if (parentSessionId) {
      const parentContext = useSessionStore.getState().sessionContextMap[parentSessionId];
      if (parentContext?.contextWindow && parentContext.contextWindow > 0) {
        store.updateSubagentContext(subId, { contextWindow: parentContext.contextWindow });
      }
    }
  }

  if (event.type === "compaction_start") {
    store.updateSubagentStatus(subId, "compacting");
  }

  if (event.type === "compaction_end") {
    if (event.result?.tokensAfter != null) {
      store.updateSubagentContext(subId, { tokens: event.result.tokensAfter });
    }
    store.updateSubagentStatus(subId, "streaming");
  }

  if (event.type === "auto_retry_start") {
    store.updateSubagentStatus(subId, "retrying");
  }

  if (event.type === "auto_retry_end") {
    const current = useSubagentStore.getState().subagentStatusMap[subId];
    if (current === "retrying") {
      store.updateSubagentStatus(subId, "streaming");
    }
  }

  if (options.skipMessageMirroring && isSubagentMessageMirrorEvent(event)) {
    return;
  }

  const existing = store.messagesBySubsession[subId] || [];

  if (event.type === "message_start") {
    if (event.message) {
      const msg = messageToChatMessage(
        event.message as Message,
        undefined,
        subToolCallNameMapBySubId[subId],
      );
      if (msg) {
        store.setSubMessages(subId, [...existing, msg]);
      }
    }
  } else if (event.type === "message_update") {
    const message = event.message as AssistantMessage;
    const incoming = message.content;
    const existingBeforeUpdate = useSubagentStore.getState().messagesBySubsession[subId] || [];
    if (isDelayedTerminalMessageUpdate(existingBeforeUpdate, incoming)) return;

    batchMessageUpdate(subId, () => {
      const freshStore = useSubagentStore.getState();
      const freshExisting = freshStore.messagesBySubsession[subId] || [];
      let lastAssistantIdx = -1;
      for (let i = freshExisting.length - 1; i >= 0; i--) {
        if (freshExisting[i].role === "assistant") {
          lastAssistantIdx = i;
          break;
        }
      }
      const lastMsg = lastAssistantIdx >= 0 ? freshExisting[lastAssistantIdx] : null;

      if (!lastMsg) return;
      if (!incoming || !Array.isArray(incoming)) return;

      const preservedToolExecs = (lastMsg.content ?? []).filter(
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
          const { args, timeout, description } = formatToolArgs(block.arguments);
          const semanticIdx = findMatchingToolExecution(preservedToolExecs, block.name, args, {
            includeTerminal: true,
          });
          const exec = execByCallId.get(block.id) ?? preservedToolExecs[semanticIdx];
          if (exec) {
            orderedBlocks.push({
              ...exec,
              toolName: exec.toolName === "unknown" ? block.name : exec.toolName,
              args: args || exec.args,
              timeout: timeout ?? exec.timeout,
              description: description ?? exec.description,
            });
            usedExecs.add(exec.toolCallId);
          } else {
            orderedBlocks.push({
              type: "toolExecution",
              toolCallId: block.id,
              toolName: block.name,
              args,
              status: "running",
              timeout,
              description,
            });
            usedExecs.add(block.id);
          }
        } else if (block.type === "text" || block.type === "thinking") {
          orderedBlocks.push(block);
        }
      }

      const preservedBlocks = preservedToolExecs.filter((exec) => !usedExecs.has(exec.toolCallId));

      freshStore.setSubMessages(
        subId,
        replaceMsgAt(freshExisting, lastAssistantIdx, {
          ...lastMsg,
          content: [...preservedBlocks, ...orderedBlocks],
          isStreaming: true,
          stopReason: (message.stopReason as string) ?? lastMsg.stopReason ?? null,
        }),
      );
    });
  } else if (event.type === "message_end") {
    flushNow();

    const refreshedStore = useSubagentStore.getState();
    const refreshedExisting = refreshedStore.messagesBySubsession[subId] || [];
    let lastMsgIdx = -1;
    for (let i = refreshedExisting.length - 1; i >= 0; i--) {
      if (refreshedExisting[i].role === "assistant") {
        lastMsgIdx = i;
        break;
      }
    }
    const lastMsg = lastMsgIdx >= 0 ? refreshedExisting[lastMsgIdx] : undefined;
    if (!lastMsg) return;

    const msg = event.message as AssistantMessage;
    let finalText = "";
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text" && typeof part.text === "string") finalText += part.text;
      }
    }

    const provider = (msg.provider as string) || lastMsg.provider;
    const model = (msg.model as string) || lastMsg.model;
    const tokenUsage = extractTokenUsage(msg.usage);

    const hasContent = lastMsg.content.some(
      (b) =>
        (b.type === "text" && b.text.trim().length > 0) ||
        b.type === "thinking" ||
        b.type === "toolCall" ||
        b.type === "toolResult" ||
        b.type === "toolExecution" ||
        b.type === "custom",
    );

    if (!hasContent) {
      store.setSubMessages(subId, [
        ...refreshedExisting.slice(0, lastMsgIdx),
        ...refreshedExisting.slice(lastMsgIdx + 1),
      ]);
      return;
    }

    const closedContent = closeRunningToolExecutions(
      lastMsg.content,
      msg.stopReason === "error" ? "error" : "done",
    );

    store.setSubMessages(
      subId,
      replaceMsgAt(refreshedExisting, lastMsgIdx, {
        ...lastMsg,
        content: closedContent,
        isStreaming: false,
        stopReason: (msg.stopReason as string) ?? null,
        provider,
        model,
        tokenUsage: tokenUsage ?? lastMsg.tokenUsage,
      }),
    );

    const usage = msg.usage as Usage;
    if (usage) {
      const totalTokens = Number(usage.input ?? 0) + Number(usage.output ?? 0);
      if (totalTokens > 0) {
        store.updateSubagentContext(subId, { tokens: totalTokens });
      }
    }

    if (finalText) {
      const { subsessionsByParent } = useSubagentStore.getState();
      for (const [path, subs] of Object.entries(subsessionsByParent)) {
        if (subs.some((s) => s.sessionId === subId)) {
          useSubagentStore.getState().upsertLiveSubagent(path, subId, {
            finalText: finalText.slice(0, 200),
            provider,
            model,
          });
          break;
        }
      }
    }
  } else if (event.type === "turn_end") {
    return;
  }

  if (event.type === "tool_execution_start") {
    if (!subToolCallNameMapBySubId[subId]) subToolCallNameMapBySubId[subId] = {};
    subToolCallNameMapBySubId[subId][event.toolCallId] = event.toolName;
  }

  if (
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  ) {
    if (event.type === "tool_execution_end") {
      flushNow();
    }

    type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;
    const toolCallId = event.toolCallId;
    const toolName = event.toolName;
    const args =
      event.type === "tool_execution_end" ? undefined : (event.args as Record<string, unknown>);
    const argsStr = args
      ? typeof (args as Record<string, unknown>).command === "string"
        ? ((args as Record<string, unknown>).command as string)
        : JSON.stringify(args, null, 2)
      : "";
    const description =
      args && typeof (args as Record<string, unknown>).description === "string"
        ? ((args as Record<string, unknown>).description as string)
        : undefined;

    batchMessageUpdate(subId, () => {
      const freshMessages = useSubagentStore.getState().messagesBySubsession[subId] || [];
      const lastMsg = freshMessages[freshMessages.length - 1];
      if (!lastMsg) return;

      const blocks = [...((lastMsg.content as ContentBlock[]) || [])];
      const targetIdx = blocks.findIndex(
        (b): b is ToolExecBlock => b.type === "toolExecution" && b.toolCallId === toolCallId,
      );

      if (event.type === "tool_execution_start") {
        const matchedByExactId = targetIdx >= 0;
        let resolvedTargetIdx = matchedByExactId
          ? targetIdx
          : findMatchingToolExecution(blocks, toolName, argsStr, { includeTerminal: true });

        if (!matchedByExactId && resolvedTargetIdx >= 0) {
          const matched = blocks[resolvedTargetIdx] as ToolExecBlock;
          if (
            matched.status === "running" &&
            matched.toolCallId !== toolCallId &&
            subToolCallNameMapBySubId[subId]?.[matched.toolCallId]
          ) {
            resolvedTargetIdx = -1;
          }
        }

        if (resolvedTargetIdx >= 0) {
          const prev = blocks[resolvedTargetIdx] as ToolExecBlock;
          blocks[resolvedTargetIdx] = {
            ...prev,
            toolCallId,
            toolName: prev.toolName === "unknown" ? toolName : prev.toolName,
            args: argsStr || prev.args,
            status: prev.status === "done" || prev.status === "error" ? prev.status : "running",
            description: description ?? prev.description,
            startedAt: prev.startedAt ?? event.timestamp ?? Date.now(),
          };
        } else {
          blocks.push({
            type: "toolExecution",
            toolCallId,
            toolName,
            args: argsStr,
            status: "running",
            description,
            startedAt: event.timestamp ?? Date.now(),
          });
        }
      } else if (event.type === "tool_execution_update") {
        let output = "";
        const partial = event.partialResult as Record<string, unknown> | undefined;
        if (partial) {
          const partialObj = partial as Record<string, unknown>;
          const partialContent = partialObj.content as
            | Array<{ type: string; text?: string }>
            | undefined;
          if (Array.isArray(partialContent)) {
            output = partialContent.map((c) => c.text ?? "").join("");
          } else if (typeof partial === "string") {
            output = partial;
          } else {
            output = JSON.stringify(partial, null, 2);
          }
        }
        if (targetIdx >= 0) {
          const prev = blocks[targetIdx] as ToolExecBlock;
          blocks[targetIdx] = { ...prev, output: (prev.output ?? "") + output };
        }
      } else if (event.type === "tool_execution_end") {
        const result = event.result as Record<string, unknown> | undefined;
        const isError = event.isError;
        let output = "";
        if (result) {
          const resultObj = result as Record<string, unknown>;
          const resultContent = resultObj.content as
            | Array<{ type: string; text?: string }>
            | undefined;
          if (Array.isArray(resultContent)) {
            output = resultContent.map((c) => c.text ?? "").join("");
          } else {
            output = JSON.stringify(result, null, 2);
          }
        }
        if (targetIdx >= 0) {
          const prev = blocks[targetIdx] as ToolExecBlock;
          const resultWithDetails = result as Record<string, unknown> | null;
          blocks[targetIdx] = {
            ...prev,
            status: isError ? "error" : "done",
            output: (prev.output ?? "") + output,
            details: resultWithDetails?.details,
          };
        }
      }

      const updated = [...freshMessages];
      updated[freshMessages.length - 1] = { ...updated[freshMessages.length - 1], content: blocks };
      useSubagentStore.getState().setSubMessages(subId, updated);
    });
  }

  if (event.type === "agent_end") {
    flushNow();

    const { subsessionsByParent } = useSubagentStore.getState();
    for (const [path, subs] of Object.entries(subsessionsByParent)) {
      if (subs.some((s) => s.sessionId === subId)) {
        const sub = subs.find((s) => s.sessionId === subId);
        if (sub && !sub.completedAt) {
          useSubagentStore.getState().upsertLiveSubagent(path, subId, {
            ...buildSubagentTerminalPatch(event as { reason?: unknown }, sub.finalText),
          });
        }
        break;
      }
    }
    store.updateSubagentStatus(subId, "idle");
  }
}

export function clearSubagentToolNames(subIds: string[]): void {
  for (const id of subIds) {
    delete subToolCallNameMapBySubId[id];
  }
}

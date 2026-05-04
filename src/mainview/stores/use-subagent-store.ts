import { create } from "zustand";
import type { SubagentSessionInfo, ChatMessage, ContentBlock, SessionStatus, ContextUsage, TokenUsage } from "../types";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, Message, Usage } from "@dyyz1993/pi-ai";
import { apiClient } from "../lib/api-client";
import { messageToChatMessage } from "../lib/message-mapper";
import { batchMessageUpdate } from "./message-batcher";
import { useSessionStore } from "./use-session-store";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("subagent");

const subToolCallNameMap: Record<string, string> = {};

interface SubagentState {
  subsessionsByParent: Record<string, SubagentSessionInfo[]>;
  activeSubsessionId: string | null;
  messagesBySubsession: Record<string, ChatMessage[]>;
  loadingByParent: Record<string, boolean>;
  subagentStatusMap: Record<string, SessionStatus>;
  subagentContextMap: Record<string, ContextUsage>;

  loadSubsessions: (parentSessionPath: string) => Promise<SubagentSessionInfo[]>;
  setActiveSubsession: (parentSessionId: string, subId: string | null) => void;
  setSubMessages: (subId: string, msgs: ChatMessage[]) => void;
  loadSubHistory: (subSessionPath: string, subId: string) => Promise<void>;
  upsertLiveSubagent: (parentSessionPath: string, subId: string, partial: Partial<SubagentSessionInfo>) => void;
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

  loadSubsessions: async (parentSessionPath: string) => {
    if (get().loadingByParent[parentSessionPath]) return [];
    if (get().subsessionsByParent[parentSessionPath]) return get().subsessionsByParent[parentSessionPath];
    set((s) => ({ loadingByParent: { ...s.loadingByParent, [parentSessionPath]: true } }));
    try {
      const result = await apiClient.call("subagent.listBySession", { sessionPath: parentSessionPath });
      const subs = result.subsessions as SubagentSessionInfo[];
      set((s) => ({
        subsessionsByParent: { ...s.subsessionsByParent, [parentSessionPath]: subs },
        loadingByParent: { ...s.loadingByParent, [parentSessionPath]: false },
      }));
      return subs;
    } catch {
      set((s) => ({ loadingByParent: { ...s.loadingByParent, [parentSessionPath]: false } }));
      return [];
    }
  },

  setActiveSubsession: (_parentSessionId: string, subId: string | null) => {
    set({ activeSubsessionId: subId });

    if (!subId) return;

    const { messagesBySubsession } = get();
    if (!messagesBySubsession[subId] || messagesBySubsession[subId].length === 0) {
      const { subsessionsByParent } = get();
      for (const subs of Object.values(subsessionsByParent)) {
        const match = subs.find((s) => s.sessionId === subId);
        if (match && match.sessionPath) {
          get().loadSubHistory(match.sessionPath, subId);
          break;
        }
      }
    }
  },

  setSubMessages: (subId, msgs) =>
    set((s) => ({ messagesBySubsession: { ...s.messagesBySubsession, [subId]: msgs } })),

  loadSubHistory: async (subSessionPath, subId) => {
    try {
      const result = await apiClient.call("session.getEntries", { sessionPath: subSessionPath });
      if (!result?.entries || !Array.isArray(result.entries) || result.entries.length === 0) {
        return;
      }
      const msgs: ChatMessage[] = [];
      for (const entry of result.entries) {
        const data = entry.data as Record<string, unknown>;
        const raw = data?.message;
        if (!raw) continue;
        const msg = messageToChatMessage(raw as Message, entry.id);
        if (msg) msgs.push(msg);
      }
      if (msgs.length > 0) {
        set((s) => ({ messagesBySubsession: { ...s.messagesBySubsession, [subId]: msgs } }));
      }
    } catch {
      // Subagent session file may not exist yet (still streaming via live events).
      // This is expected — live messages are accumulated in handleSubagentEvent.
    }
  },

  upsertLiveSubagent: (parentSessionPath: string, subId: string, partial: Partial<SubagentSessionInfo>) => {
    set((s) => {
      const existing = s.subsessionsByParent[parentSessionPath] || [];
      const idx = existing.findIndex((e) => e.sessionId === subId);
      const base = idx >= 0
        ? existing[idx]
        : { sessionId: subId, sessionPath: "", description: "", instruction: "", startedAt: Date.now() };
      const merged: SubagentSessionInfo = { ...base, ...partial };
      let updated: SubagentSessionInfo[];
      if (idx >= 0) {
        updated = [...existing];
        updated[idx] = merged;
      } else {
        updated = [...existing, merged];
      }
      return { ...s, subsessionsByParent: { ...s.subsessionsByParent, [parentSessionPath]: updated } };
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

    apiClient.call("subagent.rename", { parentSessionPath, subSessionId, newDescription: trimmed }).catch((err) => {
      log.warn("subagent.rename failed", { err: err instanceof Error ? err.message : String(err) });
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
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end" };

type SubagentEvent = AgentEvent | SubagentCustomEvent;

export function handleSubagentEvent(subId: string, event: SubagentEvent, parentSessionId?: string) {
  const store = useSubagentStore.getState();

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

  const existing = store.messagesBySubsession[subId] || [];

  if (event.type === "message_start") {
    if (event.message) {
      const msg = messageToChatMessage(event.message as Message, undefined, subToolCallNameMap);
      if (msg) {
        store.setSubMessages(subId, [...existing, msg]);
      }
    }
  } else if (event.type === "message_update") {
    batchMessageUpdate(subId, () => {
      const freshStore = useSubagentStore.getState();
      const freshExisting = freshStore.messagesBySubsession[subId] || [];
      const lastMsg = freshExisting[freshExisting.length - 1];
      if (!lastMsg) return;

      const blocks = (lastMsg.content as ContentBlock[]) || [];
      const msg = event.message as Message;
      const content = msg.content as Array<ContentBlock> | undefined;
      if (!content || !Array.isArray(content)) return;

      const updated: ContentBlock[] = [...blocks];
      for (const block of content) {
        if (block.type === "text") {
          const lastIdx = updated.length - 1;
          const lastBlock = updated[lastIdx];
          if (lastIdx >= 0 && lastBlock?.type === "text") {
            updated[lastIdx] = { type: "text" as const, text: lastBlock.text + block.text };
          } else {
            updated.push(block);
          }
        } else {
          updated.push(block);
        }
      }

      freshStore.setSubMessages(subId, [...freshExisting.slice(0, -1), { ...lastMsg, content: updated }]);
    });
  } else if (event.type === "message_end") {
    const lastMsg = existing[existing.length - 1];
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
      (b) => (b.type === "text" && b.text.trim().length > 0)
        || b.type === "thinking"
        || b.type === "toolCall"
        || b.type === "toolResult"
        || b.type === "toolExecution"
        || b.type === "custom",
    );

    if (!hasContent) {
      store.setSubMessages(subId, existing.slice(0, -1));
      return;
    }

    store.setSubMessages(subId, [
      ...existing.slice(0, -1),
      {
        ...lastMsg,
        isStreaming: false,
        stopReason: (msg.stopReason as string) ?? null,
        provider,
        model,
        tokenUsage: tokenUsage ?? lastMsg.tokenUsage,
      },
    ]);

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
            completedAt: Date.now(),
            exitCode: 0,
            finalText: finalText.slice(0, 200),
            provider,
            model,
          });
          break;
        }
      }
    }
  } else if (event.type === "turn_end") {
    if (event.message) {
      const msg = messageToChatMessage(event.message as Message, undefined, subToolCallNameMap);
      if (msg) {
        store.setSubMessages(subId, [...existing, msg]);
      }
    }
  }

  if (event.type === "tool_execution_start") {
    subToolCallNameMap[event.toolCallId] = event.toolName;
  }

  if (
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  ) {
    type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;
    const toolCallId = event.toolCallId;
    const toolName = event.toolName;
    const args = event.type === "tool_execution_end" ? undefined : event.args;
    const argsStr = args
      ? typeof args === "object" && typeof args.command === "string"
        ? args.command
        : JSON.stringify(args, null, 2)
      : "";

    batchMessageUpdate(subId, () => {
      const freshMessages = useSubagentStore.getState().messagesBySubsession[subId] || [];
      const lastMsg = freshMessages[freshMessages.length - 1];
      if (!lastMsg) return;

      const blocks = [...((lastMsg.content as ContentBlock[]) || [])];
      const targetIdx = blocks.findIndex(
        (b): b is ToolExecBlock => b.type === "toolExecution" && b.toolCallId === toolCallId,
      );

      if (event.type === "tool_execution_start") {
        blocks.push({ type: "toolExecution", toolCallId, toolName, args: argsStr, status: "running" });
      } else if (event.type === "tool_execution_update") {
        let output = "";
        const partial = event.partialResult;
        if (partial) {
          const partialContent = partial.content as Array<{ type: string; text?: string }> | undefined;
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
        const result = event.result;
        const isError = event.isError;
        let output = "";
        if (result) {
          const resultContent = result.content as Array<{ type: string; text?: string }> | undefined;
          if (Array.isArray(resultContent)) {
            output = resultContent.map((c) => c.text ?? "").join("");
          } else {
            output = JSON.stringify(result, null, 2);
          }
        }
        if (targetIdx >= 0) {
          const prev = blocks[targetIdx] as ToolExecBlock;
          blocks[targetIdx] = { ...prev, status: isError ? "error" : "done", output: (prev.output ?? "") + output, details: result?.details };
        }
      }

      const updated = [...freshMessages];
      updated[freshMessages.length - 1] = { ...updated[freshMessages.length - 1], content: blocks };
      useSubagentStore.getState().setSubMessages(subId, updated);
    });
  }

  if (event.type === "agent_end") {
    const { subsessionsByParent } = useSubagentStore.getState();
    for (const [path, subs] of Object.entries(subsessionsByParent)) {
      if (subs.some((s) => s.sessionId === subId)) {
        const sub = subs.find((s) => s.sessionId === subId);
        if (sub && !sub.completedAt) {
          useSubagentStore.getState().upsertLiveSubagent(path, subId, {
            completedAt: Date.now(),
            exitCode: 0,
            finalText: sub.finalText ?? "(completed)",
          });
        }
        break;
      }
    }
    store.updateSubagentStatus(subId, "idle");
  }
}

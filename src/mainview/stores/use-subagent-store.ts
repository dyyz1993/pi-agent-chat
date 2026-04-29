import { create } from "zustand";
import type { SubagentSessionInfo, ChatMessage, ContentBlock, SessionStatus, ContextUsage, TokenUsage } from "../types";
import { apiClient } from "../lib/api-client";
import { messageToChatMessage } from "../lib/message-mapper";
import { batchMessageUpdate } from "./message-batcher";
import { useSessionStore } from "./use-session-store";

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
        const raw = data?.message as Record<string, unknown> | undefined;
        if (!raw) continue;
        const msg = messageToChatMessage(raw, entry.id);
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

export function handleSubagentEvent(subId: string, event: Record<string, unknown>, parentSessionId?: string) {
  const eventType = event.type as string;
  const store = useSubagentStore.getState();

  if (eventType === "agent_start" || eventType === "subagent_start") {
    store.updateSubagentStatus(subId, "streaming");
    if (parentSessionId) {
      const parentContext = useSessionStore.getState().sessionContextMap[parentSessionId];
      if (parentContext?.contextWindow && parentContext.contextWindow > 0) {
        store.updateSubagentContext(subId, { contextWindow: parentContext.contextWindow });
      }
    }
  }

  if (eventType === "compaction_start") {
    store.updateSubagentStatus(subId, "compacting");
  }

  if (eventType === "compaction_end") {
    const result = event.result as { tokensAfter?: number } | undefined;
    if (result?.tokensAfter != null) {
      store.updateSubagentContext(subId, { tokens: result.tokensAfter });
    }
    store.updateSubagentStatus(subId, "streaming");
  }

  if (eventType === "auto_retry_start") {
    store.updateSubagentStatus(subId, "retrying");
  }

  if (eventType === "auto_retry_end") {
    const current = useSubagentStore.getState().subagentStatusMap[subId];
    if (current === "retrying") {
      store.updateSubagentStatus(subId, "streaming");
    }
  }

  const existing = store.messagesBySubsession[subId] || [];

  if (eventType === "message_start") {
    const raw = event.message as Record<string, unknown>;
    const msg = messageToChatMessage(raw, undefined, subToolCallNameMap);
    if (msg) {
      store.setSubMessages(subId, [...existing, msg]);
    }
  } else if (eventType === "message_update") {
    batchMessageUpdate(subId, () => {
      const freshStore = useSubagentStore.getState();
      const freshExisting = freshStore.messagesBySubsession[subId] || [];
      const lastMsg = freshExisting[freshExisting.length - 1];
      if (!lastMsg) return;

      const blocks = (lastMsg.content as ContentBlock[]) || [];
      const content = (event.message as Record<string, unknown>)?.content as ContentBlock[];
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
  } else if (eventType === "message_end") {
    const raw = event.message as Record<string, unknown>;
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    let finalText = "";
    const content = raw.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text" && typeof part.text === "string") finalText += part.text;
      }
    }

    const provider = (raw.provider as string) || lastMsg.provider;
    const model = (raw.model as string) || lastMsg.model;
    const tokenUsage = extractTokenUsage(raw.usage);

    store.setSubMessages(subId, [
      ...existing.slice(0, -1),
      {
        ...lastMsg,
        isStreaming: false,
        stopReason: (raw.stopReason as string) ?? null,
        provider,
        model,
        tokenUsage: tokenUsage ?? lastMsg.tokenUsage,
      },
    ]);

    if (raw.usage) {
      const totalTokens = Number((raw.usage as Record<string, unknown>).totalTokens ?? 0);
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
  } else if (event.message) {
    const raw = event.message as Record<string, unknown>;
    const msg = messageToChatMessage(raw, undefined, subToolCallNameMap);
    if (msg) {
      store.setSubMessages(subId, [...existing, msg]);
    }
  }

  if (eventType === "tool_execution_start") {
    const toolCallId = event.toolCallId as string;
    const toolName = (event.toolName as string) || "unknown";
    subToolCallNameMap[toolCallId] = toolName;
  }

  if (
    eventType === "tool_execution_start" ||
    eventType === "tool_execution_update" ||
    eventType === "tool_execution_end"
  ) {
    type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;
    const toolCallId = event.toolCallId as string;
    const toolName = (event.toolName as string) || "unknown";
    const args = event.args as Record<string, unknown> | undefined;
    const argsStr = args
      ? typeof args.command === "string"
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

      if (eventType === "tool_execution_start") {
        blocks.push({ type: "toolExecution", toolCallId, toolName, args: argsStr, status: "running" });
      } else if (eventType === "tool_execution_update") {
        const partial = event.partialResult as Record<string, unknown> | undefined;
        let output = "";
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
      } else if (eventType === "tool_execution_end") {
        const result = event.result as Record<string, unknown> | undefined;
        const isError = event.isError as boolean;
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

  if (eventType === "agent_end") {
    const { subsessionsByParent } = useSubagentStore.getState();
    for (const [path, subs] of Object.entries(subsessionsByParent)) {
      if (subs.some((s) => s.sessionId === subId)) {
        const sub = subs.find((s) => s.sessionId === subId);
        if (sub && !sub.completedAt) {
          useSubagentStore.getState().upsertLiveSubagent(path, subId, {
            completedAt: Date.now(),
            exitCode: 0,
            finalText: sub.finalText || "(completed)",
          });
        }
        break;
      }
    }
    store.updateSubagentStatus(subId, "idle");
  }
}

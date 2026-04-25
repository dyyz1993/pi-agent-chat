import { create } from "zustand";
import type { ChatMessage, ContentBlock } from "../types";
import { apiClient } from "../lib/api-client";
import { useAppStore } from "./use-app-store";
import { useSessionStore } from "./use-session-store";
import { messageToChatMessage } from "../lib/message-mapper";

function normalizeToolBlocks(msgs: ChatMessage[]): void {
  const toolCallById = new Map<string, { msgIndex: number; blockIndex: number; name: string; input: string }>();

  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    if (msg.role !== "assistant") continue;
    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      if (b.type === "toolCall") {
        toolCallById.set(b.id, { msgIndex: mi, blockIndex: bi, name: b.name, input: b.input });
      }
    }
  }

  const execByMsg = new Map<number, Map<number, ContentBlock>>();
  const toRemove = new Set<number>();

  for (let ti = 0; ti < msgs.length; ti++) {
    const trMsg = msgs[ti];
    if (trMsg.role !== "toolResult") continue;
    const resultBlock = trMsg.content.find((b): b is Extract<ContentBlock, { type: "toolResult" }> => b.type === "toolResult");
    if (!resultBlock) continue;

    toRemove.add(ti);

    const match = toolCallById.get(resultBlock.toolCallId);
    const rawInput = match?.input || resultBlock.args;
    const args = typeof rawInput === "string" ? rawInput : rawInput != null ? JSON.stringify(rawInput, null, 2) : "";

    const execBlock: Extract<ContentBlock, { type: "toolExecution" }> = {
      type: "toolExecution",
      toolCallId: resultBlock.toolCallId,
      toolName: resultBlock.toolName || match?.name || "unknown",
      args,
      status: resultBlock.isError ? "error" : "done",
      output: resultBlock.content || undefined,
      details: resultBlock.details,
    };

    let targetMi: number;
    let targetBi: number;
    if (match) {
      targetMi = match.msgIndex;
      targetBi = match.blockIndex;
    } else {
      targetMi = ti - 1;
      while (targetMi >= 0 && msgs[targetMi].role !== "assistant") targetMi--;
      targetBi = -1;
    }

    if (targetMi >= 0) {
      if (!execByMsg.has(targetMi)) execByMsg.set(targetMi, new Map());
      execByMsg.get(targetMi)!.set(targetBi, execBlock);
    }
  }

  for (const [mi, biToBlock] of execByMsg) {
    const msg = msgs[mi];
    const newContent: ContentBlock[] = [];
    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      if (b.type === "toolCall") {
        const exec = biToBlock.get(bi) || biToBlock.get(-1);
        if (exec) {
          newContent.push(exec);
        }
      } else {
        newContent.push(b);
      }
    }
    msgs[mi] = { ...msg, content: newContent };
  }

  if (toRemove.size > 0) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (toRemove.has(i)) msgs.splice(i, 1);
    }
  }
}

interface ChatState {
  messagesBySession: Record<string, ChatMessage[]>;
  inputText: string;
  isStreaming: boolean;
  streamContentVersion: number;
  hasMoreBySession: Record<string, boolean>;
  cursorBySession: Record<string, string | null>;
  loadingMoreBySession: Record<string, boolean>;

  setInputText: (text: string) => void;
  sendMessage: () => Promise<void>;
  addMessage: (msg: ChatMessage) => void;
  setMessagesForSession: (sessionId: string, msgs: ChatMessage[]) => void;
  clearSessionMessages: (sessionId: string) => void;
  loadSessionMessages: (sessionPath: string) => Promise<void>;
  loadMoreMessages: (sessionPath: string) => Promise<void>;
  setIsStreaming: (v: boolean) => void;
  incrementStreamVersion: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesBySession: {},
  inputText: "",
  isStreaming: false,
  streamContentVersion: 0,
  hasMoreBySession: {},
  cursorBySession: {},
  loadingMoreBySession: {},

  setInputText: (text) => set({ inputText: text }),

  sendMessage: async () => {
    const { inputText } = get();
    if (!inputText.trim()) return;
    const text = inputText.trim();

    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) {
      useAppStore.getState().addLog("No active session");
      return;
    }

    set({ inputText: "" });

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    };
    set((s) => {
      const existing = s.messagesBySession[sessionId] || [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...existing, userMsg],
        },
      };
    });

    try {
      set({ isStreaming: true });
      await apiClient.call("agent.send", { sessionId, content: text });
      set({ isStreaming: false });
    } catch (err) {
      set({ isStreaming: false });
      useAppStore.getState().addLog(`Send error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  addMessage: (msg) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const existing = s.messagesBySession[sessionId] || [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...existing, msg],
        },
      };
    });
  },

  setMessagesForSession: (sessionId, msgs) =>
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: msgs },
    })),

  clearSessionMessages: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.messagesBySession;
      const { [sessionId]: __, ...restHasMore } = s.hasMoreBySession;
      const { [sessionId]: ___, ...restCursor } = s.cursorBySession;
      const { [sessionId]: ____, ...restLoading } = s.loadingMoreBySession;
      return { messagesBySession: rest, hasMoreBySession: restHasMore, cursorBySession: restCursor, loadingMoreBySession: restLoading };
    }),

  setIsStreaming: (v) => set({ isStreaming: v }),

  incrementStreamVersion: () => set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),

  loadSessionMessages: async (sessionPath) => {
    try {
      const sessionId = useSessionStore.getState().activeSessionId;
      if (!sessionId) return;

      const preflight = get().messagesBySession[sessionId] || [];
      if (preflight.length > 0) return;

      const { apiClient } = await import("../lib/api-client");
      const result = await apiClient.call("session.getEntries", { sessionPath, limit: 50 });

      const current = get().messagesBySession[sessionId] || [];
      if (current.length > 0) return;

      const toolCallNameMap: Record<string, string> = {};
      const rawEntries: Array<{ raw: Record<string, unknown>; id: string }> = [];

      for (const entry of result.entries) {
        const data = entry.data as Record<string, unknown>;
        const raw = data?.message as Record<string, unknown> | undefined;
        if (!raw) continue;
        rawEntries.push({ raw, id: entry.id });

        const role = raw.role as string;
        if (role === "assistant") {
          const content = raw.content as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "toolCall" && block.id && block.name) {
                toolCallNameMap[block.id as string] = block.name as string;
              }
            }
          }
        }
        if (role === "toolResult" && raw.toolCallId && raw.name) {
          const tcId = raw.toolCallId as string;
          if (!toolCallNameMap[tcId]) {
            toolCallNameMap[tcId] = raw.name as string;
          }
        }
      }

      const msgs: ChatMessage[] = [];
      for (const { raw, id } of rawEntries) {
        const msg = messageToChatMessage(raw, id, toolCallNameMap);
        if (msg) msgs.push(msg);
      }

      normalizeToolBlocks(msgs);

      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sessionId]: msgs },
        hasMoreBySession: { ...s.hasMoreBySession, [sessionId]: result.hasMore ?? false },
        cursorBySession: { ...s.cursorBySession, [sessionId]: result.hasMore ? String(rawEntries.length) : null },
      }));
    } catch (err) {
      useAppStore.getState().addLog(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  loadMoreMessages: async (sessionPath) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const { hasMoreBySession, cursorBySession, loadingMoreBySession } = get();
    if (!hasMoreBySession[sessionId] || loadingMoreBySession[sessionId]) return;
    const cursor = cursorBySession[sessionId];
    if (!cursor) return;

    set((s) => ({
      loadingMoreBySession: { ...s.loadingMoreBySession, [sessionId]: true },
    }));

    try {
      const result = await apiClient.call("session.getEntries", { sessionPath, limit: 50, cursor });
      const existing = get().messagesBySession[sessionId] || [];

      const toolCallNameMap: Record<string, string> = {};
      const rawEntries: Array<{ raw: Record<string, unknown>; id: string }> = [];
      for (const entry of result.entries) {
        const data = entry.data as Record<string, unknown>;
        const raw = data?.message as Record<string, unknown> | undefined;
        if (!raw) continue;
        rawEntries.push({ raw, id: entry.id });
        const role = raw.role as string;
        if (role === "assistant") {
          const content = raw.content as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "toolCall" && block.id && block.name) {
                toolCallNameMap[block.id as string] = block.name as string;
              }
            }
          }
        }
        if (role === "toolResult" && raw.toolCallId && raw.name) {
          const tcId = raw.toolCallId as string;
          if (!toolCallNameMap[tcId]) toolCallNameMap[tcId] = raw.name as string;
        }
      }

      const olderMsgs: ChatMessage[] = [];
      for (const { raw, id } of rawEntries) {
        const msg = messageToChatMessage(raw, id, toolCallNameMap);
        if (msg) olderMsgs.push(msg);
      }
      normalizeToolBlocks(olderMsgs);

      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sessionId]: [...olderMsgs, ...existing] },
        hasMoreBySession: { ...s.hasMoreBySession, [sessionId]: result.hasMore ?? false },
        cursorBySession: { ...s.cursorBySession, [sessionId]: result.hasMore ? String(parseInt(cursor) + rawEntries.length) : null },
        loadingMoreBySession: { ...s.loadingMoreBySession, [sessionId]: false },
      }));
    } catch {
      set((s) => ({
        loadingMoreBySession: { ...s.loadingMoreBySession, [sessionId]: false },
      }));
    }
  },
}));

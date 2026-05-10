import { create } from "zustand";
import type { Message } from "@dyyz1993/pi-ai";
import type { ChatMessage, ContentBlock } from "../types";
import { apiClient } from "../lib/api-client";
import { useAppStore } from "./use-app-store";
import { useSessionStore } from "./use-session-store";
import { useMemoryStore } from "./use-memory-store";
import { ALL_MEMORY_TYPE_KEYS } from "../components/chat/memory-config";
import { messageToChatMessage } from "../lib/message-mapper";
import type { AgentMessageForUI } from "../../shared/modules/agent";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("chat-store");
const perfLog = createLogger("session-perf");

export function normalizeToolBlocks(msgs: ChatMessage[]): void {
  const toolCallById = new Map<
    string,
    { msgIndex: number; blockIndex: number; name: string; input: string }
  >();

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
    const resultBlock = trMsg.content.find(
      (b): b is Extract<ContentBlock, { type: "toolResult" }> => b.type === "toolResult",
    );
    if (!resultBlock) continue;

    toRemove.add(ti);

    const match = toolCallById.get(resultBlock.toolCallId);
    const rawInput = match?.input ?? resultBlock.args;
    let args: string;
    let description: string | undefined;
    if (typeof rawInput === "string") {
      args = rawInput;
    } else if (rawInput != null) {
      args = JSON.stringify(rawInput, null, 2);
      if (typeof (rawInput as Record<string, unknown>).description === "string") {
        description = (rawInput as Record<string, unknown>).description as string;
      }
    } else {
      args = "";
    }

    const execBlock: Extract<ContentBlock, { type: "toolExecution" }> = {
      type: "toolExecution",
      toolCallId: resultBlock.toolCallId,
      toolName: resultBlock.toolName ?? match?.name ?? "unknown",
      args,
      status: resultBlock.isError ? "error" : "done",
      output: resultBlock.content || undefined,
      details: resultBlock.details,
      description,
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
      execByMsg.get(targetMi)?.set(targetBi, execBlock);
    }
  }

  for (const [mi, biToBlock] of execByMsg) {
    const msg = msgs[mi];
    const newContent: ContentBlock[] = [];
    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      if (b.type === "toolCall") {
        const exec = biToBlock.get(bi) ?? biToBlock.get(-1);
        if (exec) {
          newContent.push(exec);
        } else {
          const rawInput = b.input;
          let args: string;
          let description: string | undefined;
          if (typeof rawInput === "string") {
            args = rawInput;
          } else if (rawInput != null) {
            args = JSON.stringify(rawInput, null, 2);
            if (typeof (rawInput as Record<string, unknown>).description === "string") {
              description = (rawInput as Record<string, unknown>).description as string;
            }
          } else {
            args = "";
          }
          newContent.push({
            type: "toolExecution",
            toolCallId: b.id,
            toolName: b.name,
            args,
            status: "running",
            description,
          });
        }
      } else {
        newContent.push(b);
      }
    }
    msgs[mi] = { ...msg, content: newContent };
  }

  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    if (msg.role !== "assistant") continue;

    let hasToolCall = false;
    for (const b of msg.content) {
      if (b.type === "toolCall") {
        hasToolCall = true;
        break;
      }
    }
    if (!hasToolCall) continue;

    if (execByMsg.has(mi)) continue;

    const newContent: ContentBlock[] = [];
    for (const b of msg.content) {
      if (b.type === "toolCall") {
        const args =
          typeof b.input === "string"
            ? b.input
            : b.input != null
              ? JSON.stringify(b.input, null, 2)
              : "";
        newContent.push({
          type: "toolExecution",
          toolCallId: b.id,
          toolName: b.name,
          args,
          status: "running",
        });
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

const PAGE_SIZE = 50;

interface ChatState {
  messagesBySession: Record<string, ChatMessage[]>;
  inputText: string;
  isStreaming: boolean;
  streamContentVersion: number;
  loadingSessions: Set<string>;
  historyLoadVersion: number;
  hasMoreMessagesBySession: Record<string, boolean>;
  isLoadingMoreBySession: Record<string, boolean>;

  setInputText: (text: string) => void;
  sendMessage: () => Promise<void>;
  sendSteer: () => Promise<void>;
  sendFollowUp: () => Promise<void>;
  clearQueue: () => Promise<void>;
  addMessage: (msg: ChatMessage) => void;
  setMessagesForSession: (sessionId: string, msgs: ChatMessage[]) => void;
  clearSessionMessages: (sessionId: string) => void;
  loadSessionMessages: (
    sessionId: string,
    options?: { force?: boolean; sessionPath?: string },
  ) => Promise<void>;
  loadMoreMessages: (sessionId: string) => Promise<void>;
  setIsStreaming: (v: boolean) => void;
  incrementStreamVersion: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesBySession: {},
  inputText: "",
  isStreaming: false,
  streamContentVersion: 0,
  loadingSessions: new Set<string>(),
  historyLoadVersion: 0,
  hasMoreMessagesBySession: {},
  isLoadingMoreBySession: {},

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

    const activeSubId = (await import("./use-subagent-store")).useSubagentStore.getState()
      .activeSubsessionId;
    if (activeSubId) {
      useAppStore.getState().addLog("Cannot send to subagent session");
      return;
    }

    set({ inputText: "" });

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
      _local: true,
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

      const sessionReady = useSessionStore.getState().sessionReady[sessionId];
      if (!sessionReady) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Session startup timed out")), 15000);
          const check = () => {
            if (useSessionStore.getState().sessionReady[sessionId]) {
              clearTimeout(timeout);
              resolve();
            } else {
              setTimeout(check, 100);
            }
          };
          setTimeout(check, 100);
        });
      }

      await apiClient.call("agent.send", { sessionId, content: text });
      set({ isStreaming: false });
    } catch (err) {
      set({ isStreaming: false });
      useAppStore
        .getState()
        .addLog(`Send error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  sendSteer: async () => {
    const { inputText } = get();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set({ inputText: "" });

    const userMsg: ChatMessage = {
      id: `user_steer_${Date.now()}`,
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
      await apiClient.call("agent.steer", { sessionId, content: text });
    } catch (err) {
      useAppStore
        .getState()
        .addLog(`Steer error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  sendFollowUp: async () => {
    const { inputText } = get();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set({ inputText: "" });

    const userMsg: ChatMessage = {
      id: `user_followup_${Date.now()}`,
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
      await apiClient.call("agent.followUp", { sessionId, content: text });
    } catch (err) {
      useAppStore
        .getState()
        .addLog(`FollowUp error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  clearQueue: async () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    try {
      await apiClient.call("agent.clearQueue", { sessionId });
    } catch (err) {
      console.warn("[chat] clearQueue failed:", err);
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
      return { messagesBySession: rest };
    }),

  setIsStreaming: (v) => set({ isStreaming: v }),

  incrementStreamVersion: () => set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),

  loadSessionMessages: async (
    sessionId: string,
    options?: { force?: boolean; sessionPath?: string },
  ) => {
    const t0 = performance.now();
    const sid = sessionId;
    if (!sid) return;

    perfLog.info("[loadMessages] begin", { sessionId: sid, force: !!options?.force });

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
        log.warn("GUARD-2: existing real messages, skip", {
          sessionId: sid,
          count: preflight.length,
        });
        return;
      }
    }
    if (options?.force) {
      set((s) => {
        const map = { ...s.messagesBySession };
        delete map[sid];
        return { messagesBySession: map };
      });
    }
    set((s) => ({ loadingSessions: new Set(s.loadingSessions).add(sid) }));

    try {
      const { apiClient } = await import("../lib/api-client");
      const result = await apiClient.call("agent.getFullMessages", {
        sessionId: sid,
        sessionPath: options?.sessionPath,
      });
      perfLog.info("[loadMessages] RPC returned", {
        sessionId: sid,
        force: !!options?.force,
        rpcMs: Math.round(performance.now() - t0),
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
          return;
        }
      }

      const toolCallNameMap: Record<string, string> = {};

      const messages = result.messages;
      if (!Array.isArray(messages)) {
        log.warn("GUARD-4: messages is not array", { sessionId: sid, type: typeof messages });
        return;
      }
      log.info("Raw messages count", { sessionId: sid, count: messages.length });

      const rawMessages: Array<{ raw: AgentMessageForUI; id?: string }> = [];
      for (const msg of messages) {
        rawMessages.push({ raw: msg, id: msg.id });
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
      }

      const msgs: ChatMessage[] = [];
      for (const { raw, id } of rawMessages) {
        const msg = messageToChatMessage(raw as unknown as Message, id, toolCallNameMap);
        if (msg) msgs.push(msg);
      }
      log.info("After messageToChatMessage", {
        sessionId: sid,
        mapped: msgs.length,
        raw: rawMessages.length,
      });

      normalizeToolBlocks(msgs);

      const customEntries = result.customEntries;
      if (Array.isArray(customEntries) && customEntries.length > 0) {
        const memoryStore = useMemoryStore.getState();

        for (const entry of customEntries) {
          if (!ALL_MEMORY_TYPE_KEYS.has(entry.customType)) continue;

          memoryStore.addEvent(sid, {
            id: entry.id,
            customType: entry.customType,
            data: entry.data,
            timestamp: entry.timestamp,
          });

          if (entry.customType === "memory_prefetch_result" && entry.data) {
            const payload = entry.data as Record<string, unknown>;
            memoryStore.addInjected(sid, {
              summary: (payload.summary as string) ?? "",
              snippet: (payload.snippet as string) ?? "",
            });
          }

          msgs.push({
            id: entry.id,
            role: "custom",
            content: [{ type: "custom", customType: entry.customType, data: entry.data }],
            timestamp: entry.timestamp,
          });
        }

        msgs.sort((a, b) => {
          if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
          return (a.id || "").localeCompare(b.id || "");
        });
      }

      const hasMore = msgs.length > PAGE_SIZE;
      const displayMsgs = hasMore ? msgs.slice(-PAGE_SIZE) : msgs;

      log.info("SET messages", {
        sessionId: sid,
        total: msgs.length,
        displayed: displayMsgs.length,
        hasMore,
      });

      perfLog.info("[loadMessages] done", {
        sessionId: sid,
        total: msgs.length,
        displayed: displayMsgs.length,
        totalMs: Math.round(performance.now() - t0),
      });

      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sid]: displayMsgs },
        historyLoadVersion: s.historyLoadVersion + 1,
        hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: hasMore },
      }));

      useSessionStore.getState().restoreContextFromHistory(sid);
    } catch (err) {
      log.error("Failed to load session", {
        error: err instanceof Error ? err.message : String(err),
      });
      useAppStore
        .getState()
        .addLog(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set((s) => {
        const next = new Set(s.loadingSessions);
        next.delete(sid);
        return { loadingSessions: next };
      });
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
      const result = await apiClient.call("agent.getFullMessages", { sessionId: sid });
      const messages = result.messages;
      if (!Array.isArray(messages)) return;

      const toolCallNameMap: Record<string, string> = {};
      const rawMessages: Array<{ raw: AgentMessageForUI; id?: string }> = [];

      for (const msg of messages) {
        rawMessages.push({ raw: msg, id: msg.id });
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
      }

      const allMsgs: ChatMessage[] = [];
      for (const { raw, id } of rawMessages) {
        const msg = messageToChatMessage(raw as unknown as Message, id, toolCallNameMap);
        if (msg) allMsgs.push(msg);
      }
      normalizeToolBlocks(allMsgs);

      const currentMsgs = get().messagesBySession[sid] || [];
      const currentFirstId = currentMsgs[0]?.id;
      if (!currentFirstId) {
        set((s) => ({
          hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: false },
        }));
        return;
      }

      const currentFirstIdx = allMsgs.findIndex((m) => m.id === currentFirstId);
      if (currentFirstIdx <= 0) {
        set((s) => ({
          hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: false },
        }));
        return;
      }

      const olderMsgs = allMsgs.slice(0, currentFirstIdx);
      const prepended = [...olderMsgs, ...currentMsgs];
      log.info("LOAD MORE messages", {
        sessionId: sid,
        older: olderMsgs.length,
        total: prepended.length,
      });

      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sid]: prepended },
        hasMoreMessagesBySession: {
          ...s.hasMoreMessagesBySession,
          [sid]: currentFirstIdx > PAGE_SIZE,
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
}));

import { create } from "zustand";
import type { Message, ImageContent } from "@dyyz1993/pi-ai";
import type { ChatMessage, ContentBlock } from "../types";
import { apiClient } from "../lib/api-client";
import { useAppStore } from "./use-app-store";
import { useNotificationStore } from "./use-notification-store";
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

    if (targetMi < 0) {
      const syntheticMsg: ChatMessage = {
        id: `synthetic-${trMsg.id}`,
        role: "assistant",
        content: [execBlock],
        timestamp: trMsg.timestamp,
      };
      msgs[ti] = syntheticMsg;
      toRemove.delete(ti);
      continue;
    }

    if (!execByMsg.has(targetMi)) execByMsg.set(targetMi, new Map());
    execByMsg.get(targetMi)?.set(targetBi, execBlock);
  }

  for (const [mi, biToBlock] of execByMsg) {
    const msg = msgs[mi];
    const newContent: ContentBlock[] = [];
    const orphanBlocks = biToBlock.get(-1);
    let orphanUsed = false;
    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      if (b.type === "toolCall") {
        const exec = biToBlock.get(bi);
        if (exec) {
          newContent.push(exec);
        } else if (orphanBlocks && !orphanUsed) {
          newContent.push(orphanBlocks);
          orphanUsed = true;
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
    if (orphanBlocks && !orphanUsed) {
      newContent.push(orphanBlocks);
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

  pendingImages: ImageContent[];
  setInputText: (text: string) => void;
  setPendingImages: (images: ImageContent[]) => void;
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
  pendingImages: [],
  isStreaming: false,
  streamContentVersion: 0,
  loadingSessions: new Set<string>(),
  historyLoadVersion: 0,
  hasMoreMessagesBySession: {},
  isLoadingMoreBySession: {},

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

    set({ inputText: "" });

    try {
      const sessionReady = useSessionStore.getState().sessionReady[sessionId];
      if (!sessionReady) {
        useAppStore.getState().addLog("Session not ready, cannot send");
        useNotificationStore
          .getState()
          .push({ message: "Session not ready, please wait", level: "warning" });
        set({ inputText: text });
        return;
      }

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

      set({ isStreaming: true });

      const SEND_TIMEOUT_MS = 60_000;
      const sendT0 = performance.now();
      perfLog.info("[send] begin", { sessionId });
      const pendingImages = get().pendingImages;
      if (pendingImages.length > 0) {
        set({ pendingImages: [] });
      }
      const sendPromise = apiClient.call("agent.send", {
        sessionId,
        content: text,
        images: pendingImages,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Send timed out (60s)")), SEND_TIMEOUT_MS),
      );
      await Promise.race([sendPromise, timeoutPromise]);
      perfLog.info("[send] done", { sessionId, sendMs: Math.round(performance.now() - sendT0) });
      set({ isStreaming: false });
    } catch (err) {
      set({ isStreaming: false });
      const msg = err instanceof Error ? err.message : String(err);
      useAppStore.getState().addLog(`Send error: ${msg}`);
      useNotificationStore.getState().push({ message: `Send failed: ${msg}`, level: "error" });
    }
  },

  sendSteer: async () => {
    const { inputText } = get();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set({ inputText: "" });

    try {
      const STEER_TIMEOUT_MS = 15_000;
      const steerT0 = performance.now();
      perfLog.info("[steer] begin", { sessionId });
      const pendingImages = get().pendingImages;
      if (pendingImages.length > 0) {
        set({ pendingImages: [] });
      }
      await Promise.race([
        apiClient.call("agent.steer", { sessionId, content: text, images: pendingImages }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Steer timed out (15s)")), STEER_TIMEOUT_MS),
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

    try {
      const FOLLOWUP_TIMEOUT_MS = 15_000;
      const followUpT0 = performance.now();
      perfLog.info("[followUp] begin", { sessionId });
      const pendingImages = get().pendingImages;
      if (pendingImages.length > 0) {
        set({ pendingImages: [] });
      }
      await Promise.race([
        apiClient.call("agent.followUp", { sessionId, content: text, images: pendingImages }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("FollowUp timed out (15s)")), FOLLOWUP_TIMEOUT_MS),
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
      const GET_MESSAGES_TIMEOUT_MS = 30_000;
      const result = (await Promise.race([
        apiClient.call("agent.getFullMessages", {
          sessionId: sid,
          sessionPath: options?.sessionPath,
          limit: PAGE_SIZE,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("getFullMessages timed out (30s)")),
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
      const nullCount = { byRole: {} as Record<string, number>, total: 0 };
      for (const { raw, id } of rawMessages) {
        const msg = messageToChatMessage(raw as unknown as unknown as Message, id, toolCallNameMap);
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

      normalizeToolBlocks(msgs);

      const customEntries = result.customEntries;
      if (Array.isArray(customEntries) && customEntries.length > 0) {
        const memoryStore = useMemoryStore.getState();

        const resultMap = new Map<string, (typeof customEntries)[0]>();
        const prefetchIds = new Set<string>();

        for (const entry of customEntries) {
          if (entry.customType === "memory_prefetch") {
            prefetchIds.add(entry.id);
          }
          if (entry.customType === "memory_prefetch_result") {
            resultMap.set(entry.id, entry);
          }
        }

        const mergedResultIds = new Set<string>();

        for (const entry of customEntries) {
          if (entry.customType !== "memory_prefetch") continue;

          let bestResult: (typeof customEntries)[0] | undefined;
          for (const [, rentry] of resultMap) {
            if (rentry.timestamp >= entry.timestamp && !mergedResultIds.has(rentry.id)) {
              if (!bestResult || rentry.timestamp < bestResult.timestamp) {
                bestResult = rentry;
              }
            }
          }

          if (bestResult) {
            mergedResultIds.add(bestResult.id);
            const prefData = entry.data as Record<string, unknown> | undefined;
            const resData = bestResult.data as Record<string, unknown> | undefined;
            bestResult.data = {
              ...(resData ?? {}),
              _prefetchQuery: typeof prefData?.query === "string" ? prefData.query : "",
              _prefetchAvailableFiles:
                typeof prefData?.availableFiles === "number" ? prefData.availableFiles : 0,
            } as unknown;
          }
        }

        for (const entry of customEntries) {
          if (entry.customType === "memory_prefetch") {
            const hasLaterMergedResult = Array.from(resultMap.values()).some(
              (r) =>
                r.customType === "memory_prefetch_result" &&
                mergedResultIds.has(r.id) &&
                r.timestamp >= entry.timestamp,
            );
            if (hasLaterMergedResult) continue;
          }

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

      const hasMore = result.hasMore === true || msgs.length > PAGE_SIZE;
      const displayMsgs = msgs;

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
      const LOAD_MORE_TIMEOUT_MS = 30_000;
      const result = (await Promise.race([
        apiClient.call("agent.getFullMessages", {
          sessionId: sid,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("loadMoreMessages timed out (30s)")),
            LOAD_MORE_TIMEOUT_MS,
          ),
        ),
      ])) as Awaited<ReturnType<typeof apiClient.call<"agent.getFullMessages">>>;
      const messages = result.messages;
      if (!Array.isArray(messages)) return;

      const toolCallNameMap: Record<string, string> = {};
      const allMsgs: ChatMessage[] = [];

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
        const chatMsg = messageToChatMessage(msg as unknown as Message, msg.id, toolCallNameMap);
        if (chatMsg) allMsgs.push(chatMsg);
      }
      normalizeToolBlocks(allMsgs);

      const hasMore = false;

      log.info("LOAD ALL messages", {
        sessionId: sid,
        total: allMsgs.length,
        hasMore,
      });

      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sid]: allMsgs },
        hasMoreMessagesBySession: {
          ...s.hasMoreMessagesBySession,
          [sid]: hasMore,
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

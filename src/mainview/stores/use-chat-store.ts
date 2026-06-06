import { create } from "zustand";
import type { Message, ImageContent } from "@dyyz1993/pi-ai";
import type { ChatMessage, ContentBlock } from "../types";
import {
  buildPreservedStreamingMessage,
  dedupeToolExecutions,
  normalizeToolBlocks,
} from "./chat-tool-normalizer";
import { hasSameMessageSnapshots } from "./chat-message-snapshot";
import { isAgentNotStartedError, sendAgentMessageWithTimeout } from "./chat-send-utils";
import { readDraft, writeDraft } from "./chat-input-draft";
import { apiClient } from "../lib/api-client";
import { useAppStore } from "./use-app-store";
import { useNotificationStore } from "./use-notification-store";
import { clearAgentStarted, useSessionStore } from "./use-session-store";
import { useMemoryStore } from "./use-memory-store";
import { ALL_MEMORY_TYPE_KEYS } from "../components/chat/memory-config";
import { messageToChatMessage } from "../lib/message-mapper";
import type { AgentMessageForUI } from "../../shared/modules/agent";
import { createLogger } from "../../shared/lib/logger";

export { normalizeToolBlocks } from "./chat-tool-normalizer";

const log = createLogger("chat-store");
const perfLog = createLogger("session-perf");

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
  nextCursorBySession: Record<string, string | null>;

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
    options?: { force?: boolean; sessionPath?: string; preserveStreaming?: boolean },
  ) => Promise<void>;
  /** Background refresh: fetch latest messages and silently update store if different */
  _backgroundRefreshMessages: (sessionId: string, sessionPath?: string) => void;
  loadMoreMessages: (sessionId: string) => Promise<void>;
  setIsStreaming: (v: boolean) => void;
  incrementStreamVersion: () => void;
  saveInputDraft: (sessionId: string) => void;
  restoreInputDraft: (sessionId: string) => void;
  clearInputDraft: (sessionId: string) => void;
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

    set({ inputText: "" });
    writeDraft(sessionId, "");

    let sentImages: ImageContent[] = [];
    let userMsgId: string | null = null;

    const scheduleEmptyTurnCheck = () => {
      if (!userMsgId) return;
      const EMPTY_TURN_CHECK_MS = 30_000;
      const checkSessionId = sessionId;
      const checkUserMsgId = userMsgId;
      setTimeout(() => {
        const chat = get();
        const msgs = chat.messagesBySession[checkSessionId] || [];
        const hasAssistant = msgs.some((m) => m.role === "assistant" && m.id !== checkUserMsgId);
        if (!hasAssistant) {
          const status = useSessionStore.getState().sessionStatusMap[checkSessionId];
          const isStillStreaming =
            status === "streaming" || status === "compacting" || status === "retrying";
          if (!isStillStreaming) {
            chat.setMessagesForSession(checkSessionId, [
              ...msgs,
              {
                id: `error_${Date.now()}`,
                role: "error" as const,
                content: [
                  {
                    type: "text" as const,
                    text: "Agent 未返回响应，可能是 LLM 服务异常或网络问题",
                  },
                ],
                timestamp: Date.now(),
              },
            ]);
            useNotificationStore.getState().push({
              message: "Agent 未返回任何响应，请检查模型配置或重试",
              level: "error",
              sessionId: checkSessionId,
            });
          }
        }
      }, EMPTY_TURN_CHECK_MS);
    };

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
      userMsgId = userMsg.id;
      set((s) => {
        const existing = s.messagesBySession[sessionId] || [];
        return {
          messagesBySession: {
            ...s.messagesBySession,
            [sessionId]: [...existing, userMsg],
          },
        };
      });

      set({ isStreaming: true, pendingImages: [] });
      useSessionStore.getState().updateSessionStatus(sessionId, "streaming");

      const sendT0 = performance.now();
      perfLog.info("[send] begin", { sessionId });
      await sendAgentMessageWithTimeout(sessionId, text, sentImages);
      perfLog.info("[send] done", { sessionId, sendMs: Math.round(performance.now() - sendT0) });
      set({ isStreaming: false });
      scheduleEmptyTurnCheck();
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
          messagesBySession: {
            ...s.messagesBySession,
            [sessionId]: msgs.filter((m) => !m._local),
          },
        };
      });
      useSessionStore.getState().updateSessionStatus(sessionId, "idle");
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
    writeDraft(sessionId, "");

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
      log.warn("clearQueue failed", { error: String(err) });
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
    set((s) => {
      const nextMsgs = [...msgs];
      dedupeToolExecutions(nextMsgs);
      return {
        messagesBySession: { ...s.messagesBySession, [sessionId]: nextMsgs },
      };
    }),

  clearSessionMessages: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.messagesBySession;
      return { messagesBySession: rest };
    }),

  setIsStreaming: (v) => set({ isStreaming: v }),

  incrementStreamVersion: () => set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),

  loadSessionMessages: async (
    sessionId: string,
    options?: { force?: boolean; sessionPath?: string; preserveStreaming?: boolean },
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

      normalizeToolBlocks(
        msgs,
        true,
        useSessionStore.getState().sessionStatusMap[sid] === "streaming",
      );

      const customEntries = result.customEntries;
      if (Array.isArray(customEntries) && customEntries.length > 0) {
        const memoryStore = useMemoryStore.getState();
        memoryStore.clearSession(sid);

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

      const localMsgs = (get().messagesBySession[sid] || []).filter((m) => m._local);
      const currentMsgs = get().messagesBySession[sid] || [];

      // When streaming, preserve the last streaming assistant message from replay/events.
      // loadSessionMessages reads JSONL which may be incomplete during streaming,
      // and overwriting would lose toolExecution state populated by replayHoldEvents.
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
      dedupeToolExecutions(finalMsgs);

      if (hasSameMessageSnapshots(currentMsgs, finalMsgs)) {
        perfLog.info("[loadMessages] content unchanged, skip update", {
          sessionId: sid,
          count: finalMsgs.length,
        });
        set((s) => ({
          historyLoadVersion: options?.force ? s.historyLoadVersion + 1 : s.historyLoadVersion,
          hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: hasMore },
          nextCursorBySession: {
            ...s.nextCursorBySession,
            [sid]: result.nextCursor ?? null,
          },
        }));
      } else {
        set((s) => ({
          messagesBySession: { ...s.messagesBySession, [sid]: finalMsgs },
          historyLoadVersion: s.historyLoadVersion + 1,
          hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: hasMore },
          nextCursorBySession: {
            ...s.nextCursorBySession,
            [sid]: result.nextCursor ?? null,
          },
        }));
      }

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

  /** Background refresh: fetch latest messages from server and silently update store if different.
   *  Used after optimistic render from cache to guarantee data completeness. */
  _backgroundRefreshMessages: (sessionId: string, sessionPath?: string) => {
    const sid = sessionId;
    // Don't run if already loading (avoid competing with foreground load)
    if (get().loadingSessions.has(sid)) return;

    const t0 = performance.now();
    perfLog.info("[bgRefresh] begin", { sessionId: sid });

    set((s) => ({ loadingSessions: new Set(s.loadingSessions).add(sid) }));

    (async () => {
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
        if (!Array.isArray(messages)) return;

        // Process messages the same way as loadSessionMessages
        const toolCallNameMap: Record<string, string> = {};
        const msgs: ChatMessage[] = [];
        for (const msg of messages) {
          const mapped = messageToChatMessage(
            msg as unknown as unknown as Message,
            msg.id,
            toolCallNameMap,
          );
          if (mapped) msgs.push(mapped);
        }
        normalizeToolBlocks(msgs);

        // Process custom entries (memory events)
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

        // Compare with current store: only update if different
        const current = get().messagesBySession[sid] || [];

        const streamingMsgs = current.filter(
          (m) => m.role === "assistant" && m.isStreaming === true,
        );
        if (streamingMsgs.length > 0) {
          perfLog.info("[bgRefresh] session is streaming, skip update", {
            sessionId: sid,
            streamingCount: streamingMsgs.length,
          });
        } else {
          if (hasSameMessageSnapshots(current, msgs)) {
            perfLog.info("[bgRefresh] data unchanged, skip update", {
              sessionId: sid,
              count: msgs.length,
            });
          } else {
            perfLog.info("[bgRefresh] data changed, updating store", {
              sessionId: sid,
              oldCount: current.length,
              newCount: msgs.length,
            });
            const serverIds = new Set(msgs.map((m) => m.id));
            const localOnly = current.filter((m) => m._local && !serverIds.has(m.id));
            const hasMore = result.hasMore === true || msgs.length > PAGE_SIZE;
            const merged =
              localOnly.length > 0
                ? [...msgs, ...localOnly].sort((a, b) => a.timestamp - b.timestamp)
                : msgs;
            dedupeToolExecutions(merged);
            set((s) => ({
              messagesBySession: { ...s.messagesBySession, [sid]: merged },
              historyLoadVersion: s.historyLoadVersion + 1,
              hasMoreMessagesBySession: { ...s.hasMoreMessagesBySession, [sid]: hasMore },
              nextCursorBySession: {
                ...s.nextCursorBySession,
                [sid]: result.nextCursor ?? null,
              },
            }));
            useSessionStore.getState().restoreContextFromHistory(sid);
          }
        }
      } catch (err) {
        perfLog.info("[bgRefresh] failed (non-critical)", {
          sessionId: sid,
          error: err instanceof Error ? err.message : String(err),
        });
        // Background refresh failure is non-critical: cached messages are still visible
      } finally {
        set((s) => {
          const next = new Set(s.loadingSessions);
          next.delete(sid);
          return { loadingSessions: next };
        });
      }
    })();
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
      const current = get().messagesBySession[sid] || [];
      const cursor = get().nextCursorBySession[sid] ?? current[0]?.entryId;
      const result = (await Promise.race([
        apiClient.call("agent.getFullMessages", {
          sessionId: sid,
          limit: PAGE_SIZE,
          afterEntryId: cursor,
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

          allMsgs.push({
            id: entry.id,
            role: "custom",
            content: [{ type: "custom", customType: entry.customType, data: entry.data }],
            timestamp: entry.timestamp,
          });
        }

        allMsgs.sort((a, b) => {
          if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
          return (a.id || "").localeCompare(b.id || "");
        });
      }

      const hasMore = result.hasMore === true;

      log.info("LOAD ALL messages", {
        sessionId: sid,
        total: allMsgs.length,
        hasMore,
      });

      const currentById = new Map(current.map((msg) => [msg.id, msg]));
      const loadedIds = new Set(allMsgs.map((msg) => msg.id));
      const mergedMsgs = [
        ...allMsgs,
        ...current.filter((msg) => !loadedIds.has(msg.id)),
      ].sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return (a.entryId ?? a.id).localeCompare(b.entryId ?? b.id);
      });
      const finalMsgs = mergedMsgs.map((msg) => currentById.get(msg.id) ?? msg);
      dedupeToolExecutions(finalMsgs);

      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sid]: finalMsgs },
        historyLoadVersion: s.historyLoadVersion + 1,
        hasMoreMessagesBySession: {
          ...s.hasMoreMessagesBySession,
          [sid]: hasMore,
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

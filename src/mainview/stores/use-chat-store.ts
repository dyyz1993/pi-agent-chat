import { create } from "zustand";
import type { ChatMessage } from "../types";
import { apiClient } from "../lib/api-client";
import { useAppStore } from "./use-app-store";
import { useSessionStore } from "./use-session-store";
import { messageToChatMessage } from "../lib/message-mapper";

interface ChatState {
  messagesBySession: Record<string, ChatMessage[]>;
  inputText: string;

  setInputText: (text: string) => void;
  sendMessage: () => Promise<void>;
  addMessage: (msg: ChatMessage) => void;
  setMessagesForSession: (sessionId: string, msgs: ChatMessage[]) => void;
  loadSessionMessages: (sessionPath: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesBySession: {},
  inputText: "",

  setInputText: (text) => set({ inputText: text }),

  sendMessage: async () => {
    const { inputText } = get();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    set({ inputText: "" });

    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) {
      useAppStore.getState().addLog("No active session");
      return;
    }

    try {
      await apiClient.call("agent.send", { sessionId, content: text });
    } catch (err) {
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

  loadSessionMessages: async (sessionPath) => {
    try {
      const { apiClient } = await import("../lib/api-client");
      const result = await apiClient.call("session.getEntries", { sessionPath, limit: 200 });

      const sessionId = useSessionStore.getState().activeSessionId;
      if (!sessionId) return;

      const msgs: ChatMessage[] = [];
      for (const entry of result.entries) {
        const data = entry.data as Record<string, unknown>;
        const raw = data?.message as Record<string, unknown> | undefined;
        if (!raw) continue;
        const msg = messageToChatMessage(raw, entry.id);
        if (msg) msgs.push(msg);
      }

      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sessionId]: msgs },
      }));
    } catch (err) {
      useAppStore.getState().addLog(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
}));

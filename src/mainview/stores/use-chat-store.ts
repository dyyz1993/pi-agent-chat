import { create } from "zustand";
import type { ChatMessage } from "../types";
import { apiClient } from "../lib/api-client";
import { useAppStore } from "./use-app-store";

interface ChatState {
  messages: ChatMessage[];
  inputText: string;

  setInputText: (text: string) => void;
  sendMessage: () => Promise<void>;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  inputText: "",

  setInputText: (text) => set({ inputText: text }),

  sendMessage: async () => {
    const { inputText } = get();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    set({ inputText: "" });
    try {
      await apiClient.call("chat.send", { content: text });
    } catch (err) {
      useAppStore.getState().addLog(`Chat error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  setMessages: (msgs) => set({ messages: msgs }),
}));

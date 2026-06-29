import { create } from "zustand";

interface QueueEntry {
  steering: string[];
  followUp: string[];
}

export type QueueItemType = "steering" | "followUp";

export interface QueueItemRef {
  type: QueueItemType;
  index: number;
  text: string;
}

interface SessionQueueState {
  queueBySession: Record<string, QueueEntry>;
  setSessionQueue: (sessionId: string, queue: QueueEntry) => void;
  removeQueuedMessage: (sessionId: string, item: QueueItemRef) => void;
  clearSessionQueue: (sessionId: string) => void;
}

export const useSessionQueueStore = create<SessionQueueState>((set) => ({
  queueBySession: {},
  setSessionQueue: (sessionId, queue) =>
    set((s) => ({
      queueBySession: { ...s.queueBySession, [sessionId]: queue },
    })),
  removeQueuedMessage: (sessionId, item) =>
    set((s) => {
      const current = s.queueBySession[sessionId];
      if (!current) return s;
      const list = current[item.type];
      if (list[item.index] !== item.text) return s;
      const nextQueue = {
        ...current,
        [item.type]: list.filter((_, index) => index !== item.index),
      };
      return {
        queueBySession: { ...s.queueBySession, [sessionId]: nextQueue },
      };
    }),
  clearSessionQueue: (sessionId) =>
    set((s) => {
      const next = { ...s.queueBySession };
      delete next[sessionId];
      return { queueBySession: next };
    }),
}));

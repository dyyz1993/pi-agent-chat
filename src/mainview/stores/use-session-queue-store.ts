import { create } from "zustand";

interface QueueEntry {
  steering: string[];
  followUp: string[];
}

interface SessionQueueState {
  queueBySession: Record<string, QueueEntry>;
  setSessionQueue: (sessionId: string, queue: QueueEntry) => void;
  clearSessionQueue: (sessionId: string) => void;
}

export const useSessionQueueStore = create<SessionQueueState>((set) => ({
  queueBySession: {},
  setSessionQueue: (sessionId, queue) =>
    set((s) => ({
      queueBySession: { ...s.queueBySession, [sessionId]: queue },
    })),
  clearSessionQueue: (sessionId) =>
    set((s) => {
      const next = { ...s.queueBySession };
      delete next[sessionId];
      return { queueBySession: next };
    }),
}));

import { create } from "zustand";

const STALE_TIMEOUT_MS = 120_000;

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
  startedAt: number;
}

interface RetryState {
  retryBySession: Record<string, RetryInfo>;

  startRetry: (sessionId: string, info: Omit<RetryInfo, "startedAt">) => void;
  endRetry: (sessionId: string) => void;
}

const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleStaleCleanup(sessionId: string, delayMs: number) {
  if (cleanupTimers.has(sessionId)) {
    clearTimeout(cleanupTimers.get(sessionId)!);
  }
  const timer = setTimeout(() => {
    const info = useRetryStore.getState().retryBySession[sessionId];
    if (info) {
      useRetryStore.getState().endRetry(sessionId);
    }
    cleanupTimers.delete(sessionId);
  }, Math.max(delayMs + 30_000, STALE_TIMEOUT_MS));
  cleanupTimers.set(sessionId, timer);
}

export const useRetryStore = create<RetryState>((set) => ({
  retryBySession: {},

  startRetry(sessionId, info) {
    set((s) => ({
      retryBySession: {
        ...s.retryBySession,
        [sessionId]: { ...info, startedAt: Date.now() },
      },
    }));
    scheduleStaleCleanup(sessionId, info.delayMs);
  },

  endRetry(sessionId) {
    const timer = cleanupTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      cleanupTimers.delete(sessionId);
    }
    set((s) => {
      const { [sessionId]: _, ...rest } = s.retryBySession;
      return { retryBySession: rest };
    });
  },
}));

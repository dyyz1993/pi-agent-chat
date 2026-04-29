import { create } from "zustand";

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

export const useRetryStore = create<RetryState>((set) => ({
  retryBySession: {},

  startRetry(sessionId, info) {
    set((s) => ({
      retryBySession: {
        ...s.retryBySession,
        [sessionId]: { ...info, startedAt: Date.now() },
      },
    }));
  },

  endRetry(sessionId) {
    set((s) => {
      const { [sessionId]: _, ...rest } = s.retryBySession;
      return { retryBySession: rest };
    });
  },
}));

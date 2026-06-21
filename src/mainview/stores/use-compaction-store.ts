import { create } from "zustand";

export type CompactionActivityStatus = "running" | "completed" | "failed" | "aborted";

export interface CompactionActivity {
  status: CompactionActivityStatus;
  reason?: string;
  startedAt: number;
  endedAt?: number;
}

interface CompactionStoreState {
  activitiesBySession: Record<string, CompactionActivity>;
  markRunning: (sessionId: string, reason?: string, startedAt?: number) => void;
  markFinished: (
    sessionId: string,
    status: Exclude<CompactionActivityStatus, "running">,
    reason?: string,
  ) => void;
  clear: (sessionId: string) => void;
}

export const useCompactionStore = create<CompactionStoreState>((set, get) => ({
  activitiesBySession: {},
  markRunning: (sessionId, reason, startedAt) =>
    set((state) => ({
      activitiesBySession: {
        ...state.activitiesBySession,
        [sessionId]: {
          status: "running",
          reason,
          startedAt: startedAt ?? Date.now(),
        },
      },
    })),
  markFinished: (sessionId, status, reason) =>
    set((state) => {
      const previous = state.activitiesBySession[sessionId];
      return {
        activitiesBySession: {
          ...state.activitiesBySession,
          [sessionId]: {
            status,
            reason,
            startedAt: previous?.startedAt ?? Date.now(),
            endedAt: Date.now(),
          },
        },
      };
    }),
  clear: (sessionId) => {
    const current = get().activitiesBySession;
    if (!current[sessionId]) return;
    const { [sessionId]: _removed, ...rest } = current;
    set({ activitiesBySession: rest });
  },
}));

import { create } from "zustand";

export interface RpcLogEntry {
  id: string;
  direction: "call" | "event" | "response";
  method?: string;
  eventType?: string;
  payload: unknown;
  timestamp: number;
}

interface RpcDebugState {
  entries: RpcLogEntry[];
  maxEntries: number;
  addEntry: (entry: Omit<RpcLogEntry, "id" | "timestamp">) => void;
  clear: () => void;
}

export const useRpcDebugStore = create<RpcDebugState>((set) => ({
  entries: [],
  maxEntries: 500,

  addEntry: (entry) =>
    set((s) => {
      const newEntry: RpcLogEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: Date.now(),
      };
      const entries = [newEntry, ...s.entries].slice(0, s.maxEntries);
      return { entries };
    }),

  clear: () => set({ entries: [] }),
}));

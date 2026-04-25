import { create } from "zustand";
import type { BashProcess, BashChannelEvent } from "../../shared/modules/bash";
import { apiClient } from "../lib/api-client";

interface BashState {
  processesBySession: Record<string, BashProcess[]>;

  upsertProcess: (sessionId: string, proc: BashProcess) => void;
  removeProcess: (sessionId: string, toolCallId: string) => void;
  clearSession: (sessionId: string) => void;
  loadHistory: (sessionPath: string, sessionId: string) => Promise<void>;
}

export const useBashStore = create<BashState>()((set) => ({
  processesBySession: {},

  upsertProcess: (sessionId: string, proc: BashProcess) => {
    set((s) => {
      const existing = s.processesBySession[sessionId] || [];
      const idx = existing.findIndex((p) => p.toolCallId === proc.toolCallId);
      let updated: BashProcess[];
      if (idx >= 0) {
        updated = [...existing];
        updated[idx] = proc;
      } else {
        updated = [...existing, proc];
      }
      return { ...s, processesBySession: { ...s.processesBySession, [sessionId]: updated } };
    });
  },

  removeProcess: (sessionId: string, toolCallId: string) => {
    set((s) => ({
      processesBySession: {
        ...s.processesBySession,
        [sessionId]: (s.processesBySession[sessionId] || []).filter((p) => p.toolCallId !== toolCallId),
      },
    }));
  },

  clearSession: (sessionId: string) => {
    set((s) => {
      const updated = { ...s.processesBySession };
      delete updated[sessionId];
      return { ...s, processesBySession: updated };
    });
  },

  loadHistory: async (sessionPath: string, sessionId: string) => {
    try {
      const result = await apiClient.call("bash.list", { sessionPath });
      const processes = result.processes as BashProcess[] || [];
      set((s) => ({ ...s, processesBySession: { ...s.processesBySession, [sessionId]: processes } }));
    } catch {}
  },
}));

export function handleBashEvent(sessionId: string, event: BashChannelEvent): void {
	const store = useBashStore.getState();

  if (event.type === "list") {
    if (event.processes) {
      for (const proc of event.processes) {
        store.upsertProcess(sessionId, proc);
      }
    }
    return;
  }

  if (event.type === "start" && event.processes) {
    const startedProc = event.processes.find((p) => p.toolCallId === event.toolCallId);
    if (startedProc) {
      store.upsertProcess(sessionId, startedProc);
    }
    return;
  }

  if ((event.type === "output" || event.type === "end" || event.type === "error" || event.type === "terminated" || event.type === "background") && event.processes) {
    const updatedProc = event.processes.find((p) => p.toolCallId === event.toolCallId);
    if (updatedProc) {
      store.upsertProcess(sessionId, updatedProc);
    }
    return;
  }
}

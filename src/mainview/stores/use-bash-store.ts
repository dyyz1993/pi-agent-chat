import { create } from "zustand";
import type { BashProcess, BashChannelEvent, BashBackgroundExitEvent } from "../../shared/modules/bash";
import { apiClient } from "../lib/api-client";

interface BashState {
  processesBySession: Record<string, BashProcess[]>;
  subscribedOutputs: Set<string>;

  upsertProcess: (sessionId: string, proc: BashProcess) => void;
  removeProcess: (sessionId: string, toolCallId: string) => void;
  clearSession: (sessionId: string) => void;
  loadHistory: (sessionId: string) => Promise<void>;
  subscribeOutput: (sessionId: string, toolCallId: string) => Promise<void>;
  unsubscribeOutput: (sessionId: string, toolCallId: string) => Promise<void>;
}

export const useBashStore = create<BashState>()((set) => ({
  processesBySession: {},
  subscribedOutputs: new Set<string>(),

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

  loadHistory: async (sessionId: string) => {
    try {
      await apiClient.call("bash.list", { sessionId });
    } catch {}
  },

  subscribeOutput: async (sessionId: string, toolCallId: string) => {
    await apiClient.call("bash.command", { sessionId, action: "subscribe_output", toolCallId });
    set((s) => {
      const next = new Set(s.subscribedOutputs);
      next.add(toolCallId);
      return { ...s, subscribedOutputs: next };
    });
  },

  unsubscribeOutput: async (sessionId: string, toolCallId: string) => {
    await apiClient.call("bash.command", { sessionId, action: "unsubscribe_output", toolCallId });
    set((s) => {
      const next = new Set(s.subscribedOutputs);
      next.delete(toolCallId);
      return { ...s, subscribedOutputs: next };
    });
  },
}));

export function handleBashEvent(sessionId: string, event: BashChannelEvent): void {
	const store = useBashStore.getState();

  if (event.type === "list") {
    if (event.processes) {
      useBashStore.setState((s) => ({
        ...s,
        processesBySession: { ...s.processesBySession, [sessionId]: event.processes! },
      }));
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

export function handleBackgroundExit(sessionId: string, data: BashBackgroundExitEvent): void {
  const store = useBashStore.getState();
  const procs = store.processesBySession[sessionId] || [];
  const match = procs.find((p) =>
    p.status === "background" && data.details.command === p.command
    && Math.abs(p.startedAt - data.details.startedAt) < 5000,
  );
  if (!match) return;

  store.upsertProcess(sessionId, {
    ...match,
    status: data.details.exitCode === 0 ? "done" : "error",
    endedAt: data.details.endedAt,
    exitCode: data.details.exitCode,
    logPath: data.details.logPath,
    error: data.details.exitCode !== 0 ? data.content : undefined,
  });
}

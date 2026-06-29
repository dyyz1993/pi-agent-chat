import { create } from "zustand";

interface SessionReturnState {
  returnSourceBySession: Record<string, string>;
  activeReturnTargetId: string | null;
  setReturnSource: (targetSessionId: string, sourceSessionId: string) => void;
  clearReturnSource: (targetSessionId: string) => void;
  clearInactiveReturnSource: (activeSessionId: string | null) => void;
}

export const useSessionReturnStore = create<SessionReturnState>()((set) => ({
  returnSourceBySession: {},
  activeReturnTargetId: null,

  setReturnSource: (targetSessionId, sourceSessionId) => {
    if (!targetSessionId || !sourceSessionId || targetSessionId === sourceSessionId) return;
    set((s) => ({
      activeReturnTargetId: targetSessionId,
      returnSourceBySession: {
        ...s.returnSourceBySession,
        [targetSessionId]: sourceSessionId,
      },
    }));
  },

  clearReturnSource: (targetSessionId) => {
    if (!targetSessionId) return;
    set((s) => {
      if (!s.returnSourceBySession[targetSessionId]) return s;
      const { [targetSessionId]: _, ...rest } = s.returnSourceBySession;
      return {
        returnSourceBySession: rest,
        activeReturnTargetId:
          s.activeReturnTargetId === targetSessionId ? null : s.activeReturnTargetId,
      };
    });
  },

  clearInactiveReturnSource: (activeSessionId) => {
    set((s) => {
      const targetId = s.activeReturnTargetId;
      if (!targetId || targetId === activeSessionId) return s;
      const { [targetId]: _, ...rest } = s.returnSourceBySession;
      return {
        returnSourceBySession: rest,
        activeReturnTargetId: null,
      };
    });
  },
}));

import { create } from "zustand";
import { useSessionStore } from "./use-session-store";

export const EMPTY_SET: ReadonlySet<string> = new Set<string>();

interface MessageState {
  selectedMessageIdsBySession: Record<string, Set<string>>;
  collapsedMessageIdsBySession: Record<string, Set<string>>;
  isMultiSelectModeBySession: Record<string, boolean>;
  selectedNavIdBySession: Record<string, string | null>;
  navAnchorBySession: Record<string, "top" | "bottom">;

  toggleMessageSelection: (messageId: string) => void;
  selectMessageRange: (fromIndex: number, toIndex: number, messageIds: string[]) => void;
  clearSelection: () => void;
  selectAll: (messageIds: string[]) => void;
  toggleMultiSelectMode: () => void;
  toggleCollapse: (messageId: string) => void;
  setNavId: (navId: string | null, anchor?: "top" | "bottom") => void;
  clearSessionUI: (sessionId: string) => void;
}

export const useTurnStore = create<MessageState>((set) => ({
  selectedMessageIdsBySession: {},
  collapsedMessageIdsBySession: {},
  isMultiSelectModeBySession: {},
  selectedNavIdBySession: {},
  navAnchorBySession: {},

  toggleMessageSelection: (messageId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prev = s.selectedMessageIdsBySession[sessionId] ?? EMPTY_SET;
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return {
        selectedMessageIdsBySession: { ...s.selectedMessageIdsBySession, [sessionId]: next },
      };
    });
  },

  selectMessageRange: (fromIndex, toIndex, messageIds) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const start = Math.max(0, Math.min(fromIndex, toIndex));
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = new Set<string>();
    for (let i = start; i <= end && i < messageIds.length; i++) {
      rangeIds.add(messageIds[i]);
    }
    set((s) => {
      const prev = s.selectedMessageIdsBySession[sessionId] ?? EMPTY_SET;
      const merged = new Set(prev);
      rangeIds.forEach((id) => merged.add(id));
      return {
        selectedMessageIdsBySession: { ...s.selectedMessageIdsBySession, [sessionId]: merged },
      };
    });
  },

  clearSelection: () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const { [sessionId]: _, ...rest } = s.selectedMessageIdsBySession;
      return {
        selectedMessageIdsBySession: rest,
        isMultiSelectModeBySession: { ...s.isMultiSelectModeBySession, [sessionId]: false },
      };
    });
  },

  selectAll: (messageIds) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      selectedMessageIdsBySession: {
        ...s.selectedMessageIdsBySession,
        [sessionId]: new Set(messageIds),
      },
    }));
  },

  toggleMultiSelectMode: () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prev = s.isMultiSelectModeBySession[sessionId] ?? false;
      return {
        isMultiSelectModeBySession: { ...s.isMultiSelectModeBySession, [sessionId]: !prev },
        selectedMessageIdsBySession: prev
          ? (() => {
              const { [sessionId]: _, ...rest } = s.selectedMessageIdsBySession;
              return rest;
            })()
          : s.selectedMessageIdsBySession,
      };
    });
  },

  toggleCollapse: (messageId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prev = s.collapsedMessageIdsBySession[sessionId] ?? EMPTY_SET;
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return {
        collapsedMessageIdsBySession: { ...s.collapsedMessageIdsBySession, [sessionId]: next },
      };
    });
  },

  setNavId: (navId, anchor) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      selectedNavIdBySession: { ...s.selectedNavIdBySession, [sessionId]: navId },
      ...(anchor != null
        ? { navAnchorBySession: { ...s.navAnchorBySession, [sessionId]: anchor } }
        : {}),
    }));
  },

  clearSessionUI: (sessionId) =>
    set((s) => {
      const { [sessionId]: _s, ...restSel } = s.selectedMessageIdsBySession;
      const { [sessionId]: _c, ...restCol } = s.collapsedMessageIdsBySession;
      const { [sessionId]: _m, ...restMulti } = s.isMultiSelectModeBySession;
      const { [sessionId]: _n, ...restNav } = s.selectedNavIdBySession;
      const { [sessionId]: _a, ...restAnchor } = s.navAnchorBySession;
      return {
        selectedMessageIdsBySession: restSel,
        collapsedMessageIdsBySession: restCol,
        isMultiSelectModeBySession: restMulti,
        selectedNavIdBySession: restNav,
        navAnchorBySession: restAnchor,
      };
    }),
}));

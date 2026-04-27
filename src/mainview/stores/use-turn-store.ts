import { create } from "zustand";

interface MessageState {
  selectedMessageIds: Set<string>;
  collapsedMessageIds: Set<string>;
  isMultiSelectMode: boolean;
  selectedNavId: string | null;

  toggleMessageSelection: (messageId: string) => void;
  selectMessageRange: (fromIndex: number, toIndex: number, messageIds: string[]) => void;
  clearSelection: () => void;
  selectAll: (messageIds: string[]) => void;
  toggleMultiSelectMode: () => void;
  toggleCollapse: (messageId: string) => void;
  setNavId: (navId: string | null) => void;
}

export const useTurnStore = create<MessageState>((set) => ({
  selectedMessageIds: new Set(),
  collapsedMessageIds: new Set(),
  isMultiSelectMode: false,
  selectedNavId: null,

  toggleMessageSelection: (messageId) =>
    set((s) => {
      const next = new Set(s.selectedMessageIds);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return { selectedMessageIds: next };
    }),

  selectMessageRange: (fromIndex, toIndex, messageIds) => {
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = new Set<string>();
    for (let i = start; i <= end && i < messageIds.length; i++) {
      rangeIds.add(messageIds[i]);
    }
    set((s) => {
      const merged = new Set(s.selectedMessageIds);
      rangeIds.forEach((id) => merged.add(id));
      return { selectedMessageIds: merged };
    });
  },

  clearSelection: () => set({ selectedMessageIds: new Set(), isMultiSelectMode: false }),

  selectAll: (messageIds) =>
    set({ selectedMessageIds: new Set(messageIds) }),

  toggleMultiSelectMode: () =>
    set((s) => ({ isMultiSelectMode: !s.isMultiSelectMode, selectedMessageIds: s.isMultiSelectMode ? new Set() : s.selectedMessageIds })),

  toggleCollapse: (messageId) =>
    set((s) => {
      const next = new Set(s.collapsedMessageIds);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return { collapsedMessageIds: next };
    }),

  setNavId: (navId) => set({ selectedNavId: navId }),
}));

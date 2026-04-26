import { create } from "zustand";

interface ChatNavState {
  activeId: string | null;
  selectedIds: Set<string>;

  setActive: (id: string | null) => void;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
}

export const useChatNavStore = create<ChatNavState>((set) => ({
  activeId: null,
  selectedIds: new Set(),

  setActive: (id) => set({ activeId: id }),

  toggleSelected: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),

  clearSelected: () => set({ selectedIds: new Set() }),
}));

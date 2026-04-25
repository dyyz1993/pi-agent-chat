import { create } from "zustand";

export type NavFilterType = "all" | "user" | "assistant" | "tool";

interface ChatNavState {
  activeId: string | null;
  selectedIds: Set<string>;
  filterType: NavFilterType;

  setActive: (id: string | null) => void;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
  setFilterType: (t: NavFilterType) => void;
}

export const useChatNavStore = create<ChatNavState>((set) => ({
  activeId: null,
  selectedIds: new Set(),
  filterType: "all",

  setActive: (id) => set({ activeId: id }),

  toggleSelected: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),

  clearSelected: () => set({ selectedIds: new Set() }),

  setFilterType: (t) => set({ filterType: t }),
}));

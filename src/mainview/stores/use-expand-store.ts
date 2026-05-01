import { create } from "zustand";

interface ExpandState {
  expandedContent: string | null;
  expandedTitle: string;
  openExpand: (content: string, title?: string) => void;
  closeExpand: () => void;
}

export const useExpandStore = create<ExpandState>((set) => ({
  expandedContent: null,
  expandedTitle: "",
  openExpand: (content, title = "展开内容") =>
    set({ expandedContent: content, expandedTitle: title }),
  closeExpand: () =>
    set({ expandedContent: null, expandedTitle: "" }),
}));

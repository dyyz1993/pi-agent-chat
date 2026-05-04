import { create } from "zustand";

interface MermaidState {
  code: string | null;
  openFullscreen: (code: string) => void;
  closeFullscreen: () => void;
}

export const useMermaidStore = create<MermaidState>((set) => ({
  code: null,
  openFullscreen: (code) => set({ code }),
  closeFullscreen: () => set({ code: null }),
}));

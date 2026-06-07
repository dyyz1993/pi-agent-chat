import { create } from "zustand";
import { useLayoutStore } from "../layouts/use-layout-store";
import type { PanelVisibility } from "../layouts/types";

export type ChatOverlayType = "diff" | "file" | "expand" | "markdown" | null;

interface ChatOverlayState {
  overlay: ChatOverlayType;
  expandTitle: string;
  expandContent: React.ReactNode | null;
  markdownTitle: string;
  markdownContent: string | null;
  _prevStatusPanel: PanelVisibility | null;

  openDiff: () => void;
  openFile: () => void;
  openExpand: (title: string, content: React.ReactNode) => void;
  openMarkdown: (title: string, content: string) => void;
  close: () => void;
}

export const useChatOverlayStore = create<ChatOverlayState>((set, get) => ({
  overlay: null,
  expandTitle: "",
  expandContent: null,
  markdownTitle: "",
  markdownContent: null,
  _prevStatusPanel: null,

  openDiff: () => {
    const layout = useLayoutStore.getState();
    const prev = get()._prevStatusPanel;
    if (layout.statusPanel === "visible" && !prev) {
      set({
        overlay: "diff",
        _prevStatusPanel: layout.statusPanel,
        expandContent: null,
        markdownContent: null,
      });
      useLayoutStore.setState({ statusPanel: "hidden" });
    } else {
      set({ overlay: "diff", expandContent: null, markdownContent: null });
    }
  },

  openFile: () => {
    const layout = useLayoutStore.getState();
    const prev = get()._prevStatusPanel;
    if (layout.statusPanel === "visible" && !prev) {
      set({
        overlay: "file",
        _prevStatusPanel: layout.statusPanel,
        expandContent: null,
        markdownContent: null,
      });
      useLayoutStore.setState({ statusPanel: "hidden" });
    } else {
      set({ overlay: "file", expandContent: null, markdownContent: null });
    }
  },

  openExpand: (title, content) => {
    set({ overlay: "expand", expandTitle: title, expandContent: content, markdownContent: null });
  },

  openMarkdown: (title, content) => {
    set({
      overlay: "markdown",
      markdownTitle: title,
      markdownContent: content,
      expandContent: null,
    });
  },

  close: () => {
    const prev = get()._prevStatusPanel;
    if (prev) {
      useLayoutStore.setState({ statusPanel: prev });
    }
    set({
      overlay: null,
      expandTitle: "",
      expandContent: null,
      _prevStatusPanel: null,
      markdownTitle: "",
      markdownContent: null,
    });
  },
}));

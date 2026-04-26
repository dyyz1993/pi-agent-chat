import { create } from "zustand";

export type StatusSection = "yolo" | "plan" | "shell" | "mcp" | "lsp" | "plugins";

interface StatusState {
  yoloEnabled: boolean;
  planMode: boolean;
  shellActive: boolean;
  mcpTools: Array<{ name: string; status: "ready" | "error" | "loading" }>;
  lspStatus: "connected" | "disconnected" | "connecting";
  plugins: Array<{ name: string; enabled: boolean }>;
  collapsedSections: Set<StatusSection>;

  toggleYolo: () => void;
  togglePlan: () => void;
  toggleSection: (section: StatusSection) => void;
  setMcpTools: (tools: StatusState["mcpTools"]) => void;
  setLspStatus: (status: StatusState["lspStatus"]) => void;
  setPlugins: (plugins: StatusState["plugins"]) => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  yoloEnabled: false,
  planMode: true,
  shellActive: false,
  mcpTools: [],
  lspStatus: "disconnected",
  plugins: [],
  collapsedSections: new Set(),

  toggleYolo: () => set((s) => ({ yoloEnabled: !s.yoloEnabled })),
  togglePlan: () => set((s) => ({ planMode: !s.planMode })),
  toggleSection: (section) =>
    set((s) => {
      const next = new Set(s.collapsedSections);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return { collapsedSections: next };
    }),
  setMcpTools: (tools) => set({ mcpTools: tools }),
  setLspStatus: (status) => set({ lspStatus: status }),
  setPlugins: (plugins) => set({ plugins }),
}));

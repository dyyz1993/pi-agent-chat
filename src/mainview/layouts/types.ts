export type Breakpoint = "mobile" | "tablet" | "desktop" | "wide";

export type PanelVisibility = "pinned" | "visible" | "hidden";

export type PanelTabId = "git" | "files" | "status" | "shell" | "rpc" | "memory";

export interface PanelTab {
  id: PanelTabId;
  label: string;
}

export const PANEL_TABS: PanelTab[] = [
  { id: "git", label: "Git" },
  { id: "files", label: "文件" },
  { id: "status", label: "状态" },
  { id: "shell", label: "SHELL" },
  { id: "rpc", label: "RPC" },
  { id: "memory", label: "记忆" },
];

export interface ActivityItem {
  id: string;
  icon: string;
  label: string;
}

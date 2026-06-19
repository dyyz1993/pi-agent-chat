export type Breakpoint = "mobile" | "tablet" | "desktop" | "wide";

export type PanelVisibility = "pinned" | "visible" | "hidden";

export type PanelTabId =
  | "changeReview"
  | "git"
  | "files"
  | "status"
  | "supervisor"
  | "agent"
  | "rpc"
  | "memory"
  | "rules"
  | "hooks"
  | "snapshot";

export interface PanelTab {
  id: PanelTabId;
  label: string;
}

export const PANEL_TABS: PanelTab[] = [
  { id: "changeReview", label: "审核" },
  { id: "git", label: "Git" },
  { id: "files", label: "文件" },
  { id: "status", label: "状态" },
  { id: "supervisor", label: "守护" },
  { id: "agent", label: "Agent" },
  { id: "rpc", label: "RPC" },
  { id: "memory", label: "记忆" },
  { id: "rules", label: "Rules" },
  { id: "hooks", label: "Hooks" },
  { id: "snapshot", label: "快照" },
];

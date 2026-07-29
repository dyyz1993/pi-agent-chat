export type Breakpoint = "mobile" | "tablet" | "desktop" | "wide";

export type PanelVisibility = "pinned" | "visible" | "hidden";

export type PanelTabId =
  | "changeReview"
  | "git"
  | "files"
  | "status"
  | "goal"
  | "agent"
  | "rpc"
  | "learning"
  | "rules"
  | "permissions"
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
  { id: "goal", label: "Goal" },
  { id: "agent", label: "Agent" },
  { id: "rpc", label: "RPC" },
  { id: "learning", label: "Learning" },
  { id: "rules", label: "Rules" },
  { id: "permissions", label: "Permissions" },
  { id: "hooks", label: "Hooks" },
  { id: "snapshot", label: "快照" },
];

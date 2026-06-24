import type { ProjectTab } from "../types";

export function getProjectWorkspacePath(tab: ProjectTab | null | undefined): string {
  return tab?.remote?.remotePath ?? tab?.path ?? "";
}

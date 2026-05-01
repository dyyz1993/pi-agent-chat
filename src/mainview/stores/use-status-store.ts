import { create } from "zustand";

export type StatusSection = "yolo" | "plan" | "shell" | "mcp" | "lsp" | "plugins" | "skills";

export interface PluginInfo {
  name: string;
  path: string;
  enabled: boolean;
  toolNames: string[];
  commandNames: string[];
}

export type SkillScope = "global" | "project";

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  enabled: boolean;
  scope: SkillScope;
}

export function deriveSkillScope(filePath: string): SkillScope {
  const home = process.env.HOME ?? "";
  const globalPatterns = [
    `${home}/.agents/skills`,
    `${home}/.claude/skills`,
    `${home}/.config/opencode/skills`,
    `${home}/.pi/agent/skills`,
  ];
  return globalPatterns.some((p) => filePath.startsWith(p)) ? "global" : "project";
}

interface StatusState {
  yoloEnabled: boolean;
  planMode: boolean;
  shellActive: boolean;
  mcpTools: Array<{ name: string; status: "ready" | "error" | "loading" }>;
  lspStatus: "connected" | "disconnected" | "connecting";
  plugins: PluginInfo[];
  skills: SkillInfo[];
  expandedSkill: string | null;
  collapsedSections: Set<StatusSection>;

  toggleYolo: () => void;
  togglePlan: () => void;
  toggleSection: (section: StatusSection) => void;
  setMcpTools: (tools: StatusState["mcpTools"]) => void;
  setLspStatus: (status: StatusState["lspStatus"]) => void;
  setPlugins: (plugins: StatusState["plugins"]) => void;
  setSkills: (skills: StatusState["skills"]) => void;
  toggleSkillExpanded: (name: string) => void;
  toggleSkillEnabled: (name: string) => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  yoloEnabled: false,
  planMode: true,
  shellActive: false,
  mcpTools: [],
  lspStatus: "disconnected",
  plugins: [],
  skills: [],
  expandedSkill: null,
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
  setSkills: (skills) => set({ skills }),
  toggleSkillExpanded: (name) =>
    set((s) => ({ expandedSkill: s.expandedSkill === name ? null : name })),
  toggleSkillEnabled: (name) =>
    set((s) => ({
      skills: s.skills.map((sk) => sk.name === name ? { ...sk, enabled: !sk.enabled } : sk),
    })),
}));

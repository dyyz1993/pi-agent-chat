import { create } from "zustand";
import { apiClient } from "../lib/api-client";

export type StatusSection =
  | "yolo"
  | "plan"
  | "shell"
  | "mcp"
  | "lsp"
  | "plugins"
  | "skills"
  | "supervisor";

export type PluginScope = "global" | "project";

export interface PluginInfo {
  name: string;
  path: string;
  enabled: boolean;
  toolNames: string[];
  commandNames: string[];
  scope: PluginScope;
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

export interface MCPToolInfo {
  name: string;
  description: string;
}

export interface MCPServerInfo {
  name: string;
  status: "connecting" | "connected" | "error" | "disconnected";
  error?: string;
  toolCount: number;
  tools: MCPToolInfo[];
  scope: "global" | "project";
  disabled?: boolean;
}

export function derivePluginScope(filePath: string): PluginScope {
  const home = typeof process !== "undefined" && process.env?.HOME ? process.env.HOME : "";
  if (!home) return "project";
  const globalPatterns = [
    `${home}/.agents`,
    `${home}/.claude`,
    `${home}/.config/opencode`,
    `${home}/.pi`,
    `${home}/.nvm`,
  ];
  return globalPatterns.some((p) => filePath.startsWith(p)) ? "global" : "project";
}

export function deriveSkillScope(filePath: string): SkillScope {
  const home = typeof process !== "undefined" && process.env?.HOME ? process.env.HOME : "";
  if (!home) return "project";
  const globalPatterns = [
    `${home}/.agents/skills`,
    `${home}/.claude/skills`,
    `${home}/.config/opencode/skills`,
    `${home}/.pi/agent/skills`,
    `${home}/.nvm`,
  ];
  return globalPatterns.some((p) => filePath.startsWith(p)) ? "global" : "project";
}

interface StatusState {
  yoloEnabled: boolean;
  planMode: boolean;
  shellActive: boolean;
  mcpServers: MCPServerInfo[];
  lspStatus: "connected" | "disconnected" | "connecting";
  plugins: PluginInfo[];
  skills: SkillInfo[];
  expandedSkill: string | null;
  expandedPlugin: string | null;
  expandedMcpServer: string | null;
  collapsedSections: Set<StatusSection>;

  toggleYolo: () => void;
  togglePlan: () => void;
  toggleSection: (section: StatusSection) => void;
  setMcpServers: (servers: StatusState["mcpServers"]) => void;
  setLspStatus: (status: StatusState["lspStatus"]) => void;
  setPlugins: (plugins: StatusState["plugins"]) => void;
  setSkills: (skills: StatusState["skills"]) => void;
  toggleSkillExpanded: (name: string) => void;
  toggleSkillEnabled: (name: string) => void;
  togglePluginExpanded: (path: string) => void;
  toggleMcpExpanded: (name: string) => void;
  toggleMcpServer: (sessionId: string, name: string, enabled: boolean) => void;
  restartMcpServer: (sessionId: string, name: string) => void;
  clearSessionData: () => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  yoloEnabled: false,
  planMode: true,
  shellActive: false,
  mcpServers: [],
  lspStatus: "disconnected",
  plugins: [],
  skills: [],
  expandedSkill: null,
  expandedPlugin: null,
  expandedMcpServer: null,
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
  setMcpServers: (servers) => set({ mcpServers: servers }),
  setLspStatus: (status) => set({ lspStatus: status }),
  setPlugins: (plugins) => set({ plugins }),
  setSkills: (skills) => set({ skills }),
  toggleSkillExpanded: (name) =>
    set((s) => ({ expandedSkill: s.expandedSkill === name ? null : name })),
  toggleSkillEnabled: (name) =>
    set((s) => {
      const skill = s.skills.find((sk) => sk.name === name);
      if (!skill) return s;
      const newEnabled = !skill.enabled;
      apiClient
        .call("agent.setDisabledSkill", { skillName: name, disabled: !newEnabled })
        .catch((err) => {
          console.warn("[status] setDisabledSkill failed:", err);
        });
      return {
        skills: s.skills.map((sk) => (sk.name === name ? { ...sk, enabled: newEnabled } : sk)),
      };
    }),
  togglePluginExpanded: (path) =>
    set((s) => ({ expandedPlugin: s.expandedPlugin === path ? null : path })),
  toggleMcpExpanded: (name) =>
    set((s) => ({ expandedMcpServer: s.expandedMcpServer === name ? null : name })),
  toggleMcpServer: (sessionId, name, enabled) => {
    apiClient
      .call("agent.toggleMcpServer", { sessionId, name, enabled })
      .then((res) => {
        if (res.success) {
          set((s) => ({
            mcpServers: s.mcpServers.map((srv) =>
              srv.name === name ? { ...srv, disabled: !enabled } : srv,
            ),
          }));
        }
      })
      .catch((err) => {
        console.warn("[status] toggleMcpServer failed:", err);
      });
  },
  restartMcpServer: (sessionId, name) => {
    apiClient.call("agent.restartMcpServer", { sessionId, name }).catch((err) => {
      console.warn("[status] restartMcpServer failed:", err);
    });
  },
  clearSessionData: () =>
    set({
      yoloEnabled: false,
      planMode: true,
      shellActive: false,
      mcpServers: [],
      lspStatus: "disconnected",
      plugins: [],
      skills: [],
      expandedSkill: null,
      expandedPlugin: null,
      expandedMcpServer: null,
    }),
}));

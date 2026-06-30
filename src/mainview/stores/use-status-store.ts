import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { createLogger } from "../../shared/lib/logger";
import { useSessionStore } from "./use-session-store";
import { getEffectiveSessionId } from "../lib/effective-session";

const log = createLogger("settings");

export type StatusSection =
  | "permission"
  | "remote"
  | "yolo"
  | "plan"
  | "shell"
  | "mcp"
  | "lsp"
  | "plugins"
  | "skills";

export type PermissionProfileName = "normal" | "autopilot" | "readonly" | "yolo";
export type ExecutionSandboxMode = "off" | "filesystem";
const PERMISSION_PROFILE_BY_SESSION_KEY = "pi-permission-profile-by-session";

export type PluginScope = "global" | "project";

export interface ProjectTrustState {
  projectPath: string;
  trusted: boolean;
  decision: boolean | null;
  decisionPath?: string;
  trustStorePath: string;
}

export interface ExecutionSandboxState {
  projectPath: string;
  mode: ExecutionSandboxMode;
  configPath: string;
}

export interface RemoteRuntimeState {
  enabled: boolean;
  configured: boolean;
  status?: "connecting" | "connected" | "disconnected" | "error";
  host?: string;
  remoteCwd?: string;
  localCwd?: string;
  sshArgs?: string[];
  shell?: string;
  error?: string;
}

export interface PluginInfo {
  name: string;
  path: string;
  enabled: boolean;
  toolNames: string[];
  commandNames: string[];
  scope: PluginScope;
  usageNotice?: {
    level: "info" | "warning";
    label: string;
    message: string;
  };
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

export function derivePluginUsageNotice(name: string): PluginInfo["usageNotice"] | undefined {
  if (name !== "hooks-engine") return undefined;
  return {
    level: "info",
    label: "Pi Native Hooks",
    message: "当前主路径不使用 Pi Native Hooks。Claude Code hooks 请使用 claude-hooks-compat。",
  };
}

interface StatusState {
  permissionProfile: PermissionProfileName;
  permissionProfileLoading: boolean;
  projectTrust: ProjectTrustState | null;
  projectTrustLoading: boolean;
  executionSandbox: ExecutionSandboxState | null;
  executionSandboxLoading: boolean;
  remoteRuntimeBySession: Record<string, RemoteRuntimeState>;
  /** @deprecated Use permissionProfile === "yolo". */
  yoloEnabled: boolean;
  /** @deprecated Use permissionProfileLoading. */
  yoloLoading: boolean;
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

  setPermissionProfile: (profile: PermissionProfileName, sessionId?: string | null) => void;
  applyPermissionProfileSnapshot: (profile: string | undefined, sessionId?: string) => void;
  getRememberedPermissionProfile: (sessionId: string) => PermissionProfileName | undefined;
  setProjectTrustState: (trust: ProjectTrustState | null) => void;
  refreshProjectTrust: (projectPath: string) => Promise<void>;
  trustCurrentProject: (sessionId: string, projectPath: string, sessionPath?: string) => void;
  refreshExecutionSandbox: (projectPath: string) => Promise<void>;
  setRemoteRuntimeStatus: (sessionId: string, status: RemoteRuntimeState | null) => void;
  setExecutionSandboxMode: (
    mode: ExecutionSandboxMode,
    options: { sessionId?: string; projectPath?: string; sessionPath?: string },
  ) => void;
  togglePermissionProfile: () => void;
  /** @deprecated Use togglePermissionProfile. */
  toggleYolo: () => void;
  togglePlan: () => void;
  toggleSection: (section: StatusSection) => void;
  expandSection: (section: StatusSection) => void;
  setMcpServers: (servers: StatusState["mcpServers"]) => void;
  setLspStatus: (status: StatusState["lspStatus"]) => void;
  setPlugins: (plugins: StatusState["plugins"]) => void;
  setSkills: (skills: StatusState["skills"]) => void;
  toggleSkillExpanded: (name: string) => void;
  toggleSkillEnabled: (name: string) => void;
  togglePluginExpanded: (path: string) => void;
  togglePluginEnabled: (sessionId: string, projectPath: string, pluginPath: string) => void;
  toggleMcpExpanded: (name: string) => void;
  toggleMcpServer: (sessionId: string, name: string, enabled: boolean) => void;
  restartMcpServer: (sessionId: string, name: string) => void;
  clearSessionData: () => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  permissionProfile: "normal",
  permissionProfileLoading: false,
  projectTrust: null,
  projectTrustLoading: false,
  executionSandbox: null,
  executionSandboxLoading: false,
  remoteRuntimeBySession: {},
  yoloEnabled: false,
  yoloLoading: false,
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

  setPermissionProfile: (profile, targetSessionId) => {
    const s = useStatusStore.getState();
    if (s.permissionProfileLoading || s.permissionProfile === profile) return;
    const sessionId = targetSessionId ?? getEffectiveSessionId();
    if (!sessionId) return;
    set({ permissionProfileLoading: true, yoloLoading: true });
    apiClient
      .call("agent.setPermissionMode", {
        sessionId,
        mode: profile,
      })
      .then(() => {
        rememberPermissionProfileForSession(sessionId, profile);
        if (getEffectiveSessionId() !== sessionId) {
          set({ permissionProfileLoading: false, yoloLoading: false });
          return;
        }
        set({
          permissionProfile: profile,
          permissionProfileLoading: false,
          yoloEnabled: profile === "yolo",
          yoloLoading: false,
        });
      })
      .catch((err) => {
        log.warn("setPermissionMode failed:", { error: String(err) });
        set({ permissionProfileLoading: false, yoloLoading: false });
      });
  },
  applyPermissionProfileSnapshot: (profile, sessionId) => {
    const normalized = normalizePermissionProfileName(profile);
    if (!normalized) return;
    if (sessionId) rememberPermissionProfileForSession(sessionId, normalized);
    if (sessionId && getEffectiveSessionId() !== sessionId) {
      return;
    }
    set({
      permissionProfile: normalized,
      permissionProfileLoading: false,
      yoloEnabled: normalized === "yolo",
      yoloLoading: false,
    });
  },
  getRememberedPermissionProfile: (sessionId) => getRememberedPermissionProfile(sessionId),
  setProjectTrustState: (trust) => set({ projectTrust: trust }),
  refreshProjectTrust: async (projectPath) => {
    try {
      const trust = await apiClient.call("agent.getProjectTrust", { projectPath });
      set({ projectTrust: trust as ProjectTrustState });
    } catch (err) {
      log.warn("getProjectTrust failed", { error: String(err) });
    }
  },
  refreshExecutionSandbox: async (projectPath) => {
    try {
      const sandbox = await apiClient.call("agent.getExecutionSandbox", { projectPath });
      set({ executionSandbox: sandbox as ExecutionSandboxState });
    } catch (err) {
      log.warn("getExecutionSandbox failed", { error: String(err) });
    }
  },
  setRemoteRuntimeStatus: (sessionId, status) =>
    set((s) => {
      const remoteRuntimeBySession = { ...s.remoteRuntimeBySession };
      if (status) {
        remoteRuntimeBySession[sessionId] = {
          ...status,
          status:
            status.status ?? (status.enabled && status.configured ? "connected" : "disconnected"),
        };
      } else {
        delete remoteRuntimeBySession[sessionId];
      }
      return { remoteRuntimeBySession };
    }),
  setExecutionSandboxMode: (mode, options) => {
    const { sessionId, projectPath, sessionPath } = options;
    const state = useStatusStore.getState();
    if (!projectPath || state.executionSandboxLoading || state.executionSandbox?.mode === mode)
      return;

    set({ executionSandboxLoading: true });
    (async () => {
      try {
        const sandbox = (await apiClient.call("agent.setExecutionSandbox", {
          projectPath,
          mode,
        })) as ExecutionSandboxState;
        set({ executionSandbox: sandbox });

        if (sessionId && sessionPath) {
          await apiClient.call("agent.stop", { sessionId }).catch(() => ({ ok: false }));
          await apiClient.call("agent.start", {
            sessionId,
            projectPath,
            sessionPath,
            forceNewProcess: true,
          });
          useSessionStore.getState().fetchInitialState(sessionId);
        }
      } catch (err) {
        log.warn("setExecutionSandbox failed", { error: String(err) });
      } finally {
        set({ executionSandboxLoading: false });
      }
    })();
  },
  trustCurrentProject: (sessionId, projectPath, sessionPath) => {
    const state = useStatusStore.getState();
    if (state.projectTrustLoading) return;
    set({ projectTrustLoading: true });
    (async () => {
      try {
        const trust = (await apiClient.call("agent.setProjectTrust", {
          projectPath,
          trusted: true,
        })) as ProjectTrustState;
        set({ projectTrust: trust });

        await apiClient.call("agent.stop", { sessionId }).catch(() => ({ ok: false }));
        if (sessionPath) {
          await apiClient.call("agent.start", {
            sessionId,
            projectPath,
            sessionPath,
            forceNewProcess: true,
          });
          useSessionStore.getState().fetchInitialState(sessionId);
        }
      } catch (err) {
        log.warn("setProjectTrust failed", { error: String(err) });
      } finally {
        set({ projectTrustLoading: false });
      }
    })();
  },
  togglePermissionProfile: () => {
    const current = useStatusStore.getState().permissionProfile;
    useStatusStore.getState().setPermissionProfile(current === "yolo" ? "normal" : "yolo");
  },
  toggleYolo: () => {
    useStatusStore.getState().togglePermissionProfile();
  },
  togglePlan: () => set((s) => ({ planMode: !s.planMode })),
  toggleSection: (section) =>
    set((s) => {
      const next = new Set(s.collapsedSections);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return { collapsedSections: next };
    }),
  expandSection: (section) =>
    set((s) => {
      if (!s.collapsedSections.has(section)) return s;
      const next = new Set(s.collapsedSections);
      next.delete(section);
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
          log.warn("setDisabledSkill failed", { error: String(err) });
        });
      return {
        skills: s.skills.map((sk) => (sk.name === name ? { ...sk, enabled: newEnabled } : sk)),
      };
    }),
  togglePluginExpanded: (path) =>
    set((s) => ({ expandedPlugin: s.expandedPlugin === path ? null : path })),
  togglePluginEnabled: (sessionId, projectPath, pluginPath) => {
    const plugin = useStatusStore.getState().plugins.find((p) => p.path === pluginPath);
    if (!plugin) return;
    const newEnabled = !plugin.enabled;

    // 乐观更新 UI
    set((s) => ({
      plugins: s.plugins.map((p) => (p.path === pluginPath ? { ...p, enabled: newEnabled } : p)),
    }));

    // 异步执行：写 config → set_settings → reload → fetchInitialState
    (async () => {
      try {
        // 1. 写入 config.json
        await apiClient.call("agent.setDisabledPlugin", {
          projectPath,
          pluginPath,
          disabled: !newEnabled,
        });

        // 2. 获取当前 project settings
        const settingsRes = (await apiClient.call("agent.getSettings", {
          sessionId,
          scope: "project",
        })) as Record<string, unknown>;
        const currentExtensions = (settingsRes.extensions as string[]) ?? [];
        const excludePattern = `-${pluginPath}`;

        let newExtensions: string[];
        if (!newEnabled) {
          // 禁用：添加排除模式
          newExtensions = currentExtensions.includes(excludePattern)
            ? currentExtensions
            : [...currentExtensions, excludePattern];
        } else {
          // 启用：移除排除模式
          newExtensions = currentExtensions.filter((e) => e !== excludePattern);
        }

        // 3. 写入 settings
        await apiClient.call("agent.setSettings", {
          sessionId,
          settings: { extensions: newExtensions },
          scope: "project",
        });

        // 4. reload 让 settings 生效
        await apiClient.call("agent.reload", { sessionId });

        // 5. reload 完成后刷新 UI
        useSessionStore.getState().fetchInitialState(sessionId);
      } catch (err) {
        log.warn("togglePluginEnabled failed, rolling back", { error: String(err) });
        // 回滚乐观更新
        set((s) => ({
          plugins: s.plugins.map((p) =>
            p.path === pluginPath ? { ...p, enabled: !newEnabled } : p,
          ),
        }));
      }
    })();
  },
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
        log.warn("toggleMcpServer failed", { error: String(err) });
      });
  },
  restartMcpServer: (sessionId, name) => {
    apiClient.call("agent.restartMcpServer", { sessionId, name }).catch((err) => {
      log.warn("restartMcpServer failed", { error: String(err) });
    });
  },
  clearSessionData: () =>
    set({
      permissionProfile: "normal",
      permissionProfileLoading: false,
      projectTrust: null,
      projectTrustLoading: false,
      remoteRuntimeBySession: {},
      yoloEnabled: false,
      yoloLoading: false,
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

function normalizePermissionProfileName(
  value: string | undefined,
): PermissionProfileName | undefined {
  if (value === "normal" || value === "autopilot" || value === "readonly" || value === "yolo") {
    return value;
  }
  return undefined;
}

function readPermissionProfileMap(): Record<string, PermissionProfileName> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(PERMISSION_PROFILE_BY_SESSION_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, PermissionProfileName> = {};
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const normalized = normalizePermissionProfileName(
        typeof value === "string" ? value : undefined,
      );
      if (normalized) result[sessionId] = normalized;
    }
    return result;
  } catch {
    return {};
  }
}

function writePermissionProfileMap(map: Record<string, PermissionProfileName>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PERMISSION_PROFILE_BY_SESSION_KEY, JSON.stringify(map));
}

function rememberPermissionProfileForSession(
  sessionId: string,
  profile: PermissionProfileName,
): void {
  const map = readPermissionProfileMap();
  map[sessionId] = profile;
  writePermissionProfileMap(map);
}

function getRememberedPermissionProfile(sessionId: string): PermissionProfileName | undefined {
  return readPermissionProfileMap()[sessionId];
}

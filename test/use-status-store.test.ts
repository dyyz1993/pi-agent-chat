import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn().mockResolvedValue({}), onReconnect: vi.fn() },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: vi.fn(() => ({ activeSessionId: "sess-1" })),
  },
}));

import { useStatusStore, derivePluginScope } from "../src/mainview/stores/use-status-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCall.mockReset();
  mockCall.mockResolvedValue({});
  useStatusStore.setState({
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
  });
});

describe("useStatusStore", () => {
  it("initial state: yoloEnabled=false, planMode=true, mcpServers=[], plugins=[], skills=[]", () => {
    const s = useStatusStore.getState();
    expect(s.yoloEnabled).toBe(false);
    expect(s.planMode).toBe(true);
    expect(s.mcpServers).toEqual([]);
    expect(s.plugins).toEqual([]);
    expect(s.skills).toEqual([]);
  });

  it("toggleYolo sets yoloEnabled=true", async () => {
    useStatusStore.getState().toggleYolo();
    await Promise.resolve();
    expect(useStatusStore.getState().yoloEnabled).toBe(true);
  });

  it("togglePlan sets planMode=false", () => {
    useStatusStore.getState().togglePlan();
    expect(useStatusStore.getState().planMode).toBe(false);
  });

  it("toggleSection('mcp') adds to collapsedSections", () => {
    useStatusStore.getState().toggleSection("mcp");
    expect(useStatusStore.getState().collapsedSections.has("mcp")).toBe(true);
  });

  it("toggleSection('mcp') twice removes from collapsedSections", () => {
    useStatusStore.getState().toggleSection("mcp");
    useStatusStore.getState().toggleSection("mcp");
    expect(useStatusStore.getState().collapsedSections.has("mcp")).toBe(false);
  });

  it("setMcpServers sets mcpServers", () => {
    const servers = [
      {
        name: "srv",
        status: "connected" as const,
        toolCount: 1,
        tools: [],
        scope: "project" as const,
      },
    ];
    useStatusStore.getState().setMcpServers(servers);
    expect(useStatusStore.getState().mcpServers).toEqual(servers);
  });

  it("setLspStatus sets lspStatus", () => {
    useStatusStore.getState().setLspStatus("connected");
    expect(useStatusStore.getState().lspStatus).toBe("connected");
  });

  it("setPlugins sets plugins", () => {
    const plugins = [
      {
        name: "p",
        path: "/p",
        enabled: true,
        toolNames: [],
        commandNames: [],
        scope: "project" as const,
      },
    ];
    useStatusStore.getState().setPlugins(plugins);
    expect(useStatusStore.getState().plugins).toEqual(plugins);
  });

  it("setSkills sets skills", () => {
    const skills = [
      {
        name: "s",
        description: "d",
        filePath: "/s",
        baseDir: "/s",
        disableModelInvocation: false,
        enabled: true,
        scope: "project" as const,
      },
    ];
    useStatusStore.getState().setSkills(skills);
    expect(useStatusStore.getState().skills).toEqual(skills);
  });

  it("toggleSkillExpanded expands a skill", () => {
    useStatusStore.getState().toggleSkillExpanded("skill-a");
    expect(useStatusStore.getState().expandedSkill).toBe("skill-a");
  });

  it("toggleSkillExpanded twice collapses", () => {
    useStatusStore.getState().toggleSkillExpanded("skill-a");
    useStatusStore.getState().toggleSkillExpanded("skill-a");
    expect(useStatusStore.getState().expandedSkill).toBeNull();
  });

  it("togglePluginExpanded expands a plugin", () => {
    useStatusStore.getState().togglePluginExpanded("path-a");
    expect(useStatusStore.getState().expandedPlugin).toBe("path-a");
  });

  it("derivePluginScope returns 'global' for home dir paths", () => {
    const home = process.env.HOME ?? "";
    expect(derivePluginScope(`${home}/.agents/xxx`)).toBe("global");
  });

  it("derivePluginScope returns 'project' for non-home paths", () => {
    expect(derivePluginScope("/project/skill")).toBe("project");
  });
});

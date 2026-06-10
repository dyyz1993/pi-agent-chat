import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: vi.fn(() => ({ activeSessionId: "test-session" })),
  },
}));

import {
  useStatusStore,
  derivePluginScope,
  deriveSkillScope,
} from "../../../src/mainview/stores/use-status-store";
import { apiClient } from "../../../src/mainview/lib/api-client";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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
    collapsedSections: new Set(),
  });
});

describe("toggleYolo", () => {
  it("toggles yolo mode on and off", async () => {
    expect(useStatusStore.getState().yoloEnabled).toBe(false);
    useStatusStore.getState().toggleYolo();
    await vi.waitFor(() => {
      expect(useStatusStore.getState().yoloEnabled).toBe(true);
    });
    useStatusStore.getState().toggleYolo();
    await vi.waitFor(() => {
      expect(useStatusStore.getState().yoloEnabled).toBe(false);
    });
  });
});

describe("togglePlan", () => {
  it("toggles plan mode", () => {
    expect(useStatusStore.getState().planMode).toBe(true);
    useStatusStore.getState().togglePlan();
    expect(useStatusStore.getState().planMode).toBe(false);
    useStatusStore.getState().togglePlan();
    expect(useStatusStore.getState().planMode).toBe(true);
  });
});

describe("toggleSection", () => {
  it("toggles a section collapsed state", () => {
    expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(false);
    useStatusStore.getState().toggleSection("plugins");
    expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(true);
    useStatusStore.getState().toggleSection("plugins");
    expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(false);
  });

  it("manages multiple sections independently", () => {
    useStatusStore.getState().toggleSection("plugins");
    useStatusStore.getState().toggleSection("skills");
    expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(true);
    expect(useStatusStore.getState().collapsedSections.has("skills")).toBe(true);
    useStatusStore.getState().toggleSection("plugins");
    expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(false);
    expect(useStatusStore.getState().collapsedSections.has("skills")).toBe(true);
  });
});

describe("setMcpServers", () => {
  it("sets MCP servers", () => {
    const servers = [
      {
        name: "server-a",
        status: "connected" as const,
        error: undefined,
        toolCount: 2,
        tools: [{ name: "tool-a", description: "desc" }],
        scope: "project" as const,
      },
      {
        name: "server-b",
        status: "connecting" as const,
        error: undefined,
        toolCount: 0,
        tools: [],
        scope: "global" as const,
      },
    ];
    useStatusStore.getState().setMcpServers(servers);
    expect(useStatusStore.getState().mcpServers).toEqual(servers);
  });
});

describe("setLspStatus", () => {
  it("sets LSP status", () => {
    useStatusStore.getState().setLspStatus("connecting");
    expect(useStatusStore.getState().lspStatus).toBe("connecting");
    useStatusStore.getState().setLspStatus("connected");
    expect(useStatusStore.getState().lspStatus).toBe("connected");
  });
});

describe("setPlugins", () => {
  it("sets plugins list", () => {
    const plugins = [
      {
        name: "test-plugin",
        path: "/plugins/test",
        enabled: true,
        toolNames: ["tool1"],
        commandNames: [],
        scope: "project" as const,
      },
    ];
    useStatusStore.getState().setPlugins(plugins);
    expect(useStatusStore.getState().plugins).toEqual(plugins);
  });
});

describe("setSkills", () => {
  it("sets skills list", () => {
    const skills = [
      {
        name: "my-skill",
        description: "desc",
        filePath: "/skills/my",
        baseDir: "/skills",
        disableModelInvocation: false,
        enabled: true,
        scope: "project" as const,
      },
    ];
    useStatusStore.getState().setSkills(skills);
    expect(useStatusStore.getState().skills).toEqual(skills);
  });
});

describe("toggleSkillExpanded", () => {
  it("expands a skill and collapses on second toggle", () => {
    expect(useStatusStore.getState().expandedSkill).toBeNull();
    useStatusStore.getState().toggleSkillExpanded("my-skill");
    expect(useStatusStore.getState().expandedSkill).toBe("my-skill");
    useStatusStore.getState().toggleSkillExpanded("my-skill");
    expect(useStatusStore.getState().expandedSkill).toBeNull();
  });

  it("switches expanded skill", () => {
    useStatusStore.getState().toggleSkillExpanded("skill-a");
    useStatusStore.getState().toggleSkillExpanded("skill-b");
    expect(useStatusStore.getState().expandedSkill).toBe("skill-b");
  });
});

describe("toggleSkillEnabled", () => {
  it("enables a disabled skill and calls API", () => {
    useStatusStore.setState({
      skills: [
        {
          name: "skill-1",
          description: "d",
          filePath: "/s",
          baseDir: "/s",
          disableModelInvocation: false,
          enabled: false,
          scope: "project" as const,
        },
      ],
    });

    useStatusStore.getState().toggleSkillEnabled("skill-1");

    expect(useStatusStore.getState().skills[0].enabled).toBe(true);
    expect(mockedCall).toHaveBeenCalledWith("agent.setDisabledSkill", {
      skillName: "skill-1",
      disabled: false,
    });
  });

  it("disables an enabled skill", () => {
    useStatusStore.setState({
      skills: [
        {
          name: "skill-1",
          description: "d",
          filePath: "/s",
          baseDir: "/s",
          disableModelInvocation: false,
          enabled: true,
          scope: "project" as const,
        },
      ],
    });

    useStatusStore.getState().toggleSkillEnabled("skill-1");

    expect(useStatusStore.getState().skills[0].enabled).toBe(false);
    expect(mockedCall).toHaveBeenCalledWith("agent.setDisabledSkill", {
      skillName: "skill-1",
      disabled: true,
    });
  });

  it("does nothing for unknown skill", () => {
    useStatusStore.setState({ skills: [] });
    useStatusStore.getState().toggleSkillEnabled("nonexistent");
    expect(mockedCall).not.toHaveBeenCalled();
  });
});

describe("togglePluginExpanded", () => {
  it("expands a plugin and collapses on second toggle", () => {
    useStatusStore.getState().togglePluginExpanded("/plugins/a");
    expect(useStatusStore.getState().expandedPlugin).toBe("/plugins/a");
    useStatusStore.getState().togglePluginExpanded("/plugins/a");
    expect(useStatusStore.getState().expandedPlugin).toBeNull();
  });
});

describe("togglePluginEnabled", () => {
  const testPlugin = {
    name: "test-plugin",
    path: "/plugins/test/index.ts",
    enabled: true,
    toolNames: ["tool1"],
    commandNames: [],
    scope: "project" as const,
  };

  it("optimistically disables a plugin and calls setDisabledPlugin + setSettings + reload", async () => {
    useStatusStore.setState({ plugins: [{ ...testPlugin, enabled: true }] });

    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.getSettings") return Promise.resolve({ extensions: [] });
      if (method === "agent.setSettings") return Promise.resolve({ ok: true });
      if (method === "agent.reload") return Promise.resolve();
      if (method === "agent.setDisabledPlugin") return Promise.resolve({ disabledPlugins: [testPlugin.path] });
      return Promise.resolve({});
    });

    useStatusStore.getState().togglePluginEnabled("session-1", "/project/a", testPlugin.path);

    // 乐观更新
    expect(useStatusStore.getState().plugins[0].enabled).toBe(false);

    await vi.waitFor(() => {
      expect(mockedCall).toHaveBeenCalledWith("agent.setDisabledPlugin", {
        projectPath: "/project/a",
        pluginPath: testPlugin.path,
        disabled: true,
      });
      expect(mockedCall).toHaveBeenCalledWith("agent.getSettings", {
        sessionId: "session-1",
        scope: "project",
      });
      expect(mockedCall).toHaveBeenCalledWith("agent.setSettings", {
        sessionId: "session-1",
        settings: { extensions: [`-${testPlugin.path}`] },
        scope: "project",
      });
      expect(mockedCall).toHaveBeenCalledWith("agent.reload", { sessionId: "session-1" });
    });
  });

  it("optimistically enables a disabled plugin and removes exclude pattern", async () => {
    useStatusStore.setState({ plugins: [{ ...testPlugin, enabled: false }] });

    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.getSettings")
        return Promise.resolve({ extensions: [`-${testPlugin.path}`] });
      if (method === "agent.setSettings") return Promise.resolve({ ok: true });
      if (method === "agent.reload") return Promise.resolve();
      if (method === "agent.setDisabledPlugin") return Promise.resolve({ disabledPlugins: [] });
      return Promise.resolve({});
    });

    useStatusStore.getState().togglePluginEnabled("session-1", "/project/a", testPlugin.path);

    // 乐观更新
    expect(useStatusStore.getState().plugins[0].enabled).toBe(true);

    await vi.waitFor(() => {
      expect(mockedCall).toHaveBeenCalledWith("agent.setSettings", {
        sessionId: "session-1",
        settings: { extensions: [] },
        scope: "project",
      });
    });
  });

  it("rolls back on failure", async () => {
    useStatusStore.setState({ plugins: [{ ...testPlugin, enabled: true }] });

    mockedCall.mockRejectedValue(new Error("RPC failed"));

    useStatusStore.getState().togglePluginEnabled("session-1", "/project/a", testPlugin.path);

    // 乐观更新
    expect(useStatusStore.getState().plugins[0].enabled).toBe(false);

    // 等待回滚
    await vi.waitFor(() => {
      expect(useStatusStore.getState().plugins[0].enabled).toBe(true);
    });
  });

  it("does nothing for unknown plugin", () => {
    useStatusStore.setState({ plugins: [] });
    useStatusStore.getState().togglePluginEnabled("session-1", "/project/a", "/nonexistent");
    expect(mockedCall).not.toHaveBeenCalled();
  });
});

describe("derivePluginScope", () => {
  it("returns 'global' for paths under ~/.claude", () => {
    const home = process.env.HOME ?? "";
    const result = derivePluginScope(`${home}/.claude/plugins/test.ts`);
    expect(result).toBe("global");
  });

  it("returns 'project' for project-local paths", () => {
    const result = derivePluginScope("/workspace/project/.pi/plugins/test.ts");
    expect(result).toBe("project");
  });
});

describe("deriveSkillScope", () => {
  it("returns 'global' for paths under ~/.agents/skills", () => {
    const home = process.env.HOME ?? "";
    const result = deriveSkillScope(`${home}/.agents/skills/my-skill/SKILL.md`);
    expect(result).toBe("global");
  });

  it("returns 'project' for project-local paths", () => {
    const result = deriveSkillScope("/workspace/project/.opencode/skills/test/SKILL.md");
    expect(result).toBe("project");
  });
});

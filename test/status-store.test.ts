import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../src/mainview/lib/api-client", () => ({
	apiClient: {
		call: vi.fn().mockResolvedValue({}),
		onReconnect: vi.fn(),
	},
}))

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
	useRpcDebugStore: {
		getState: vi.fn(() => ({ addEntry: vi.fn() })),
	},
}))

import { useStatusStore, derivePluginScope, deriveSkillScope } from "../src/mainview/stores/use-status-store"
import { apiClient } from "../src/mainview/lib/api-client"

const mockedCall = vi.mocked(apiClient.call)

beforeEach(() => {
	vi.clearAllMocks()
	useStatusStore.setState({
		yoloEnabled: false,
		planMode: true,
		shellActive: false,
		mcpTools: [],
		lspStatus: "disconnected",
		plugins: [],
		skills: [],
		expandedSkill: null,
		expandedPlugin: null,
		collapsedSections: new Set(),
	})
})

describe("toggleYolo", () => {
	it("toggles yolo mode on and off", () => {
		expect(useStatusStore.getState().yoloEnabled).toBe(false)
		useStatusStore.getState().toggleYolo()
		expect(useStatusStore.getState().yoloEnabled).toBe(true)
		useStatusStore.getState().toggleYolo()
		expect(useStatusStore.getState().yoloEnabled).toBe(false)
	})
})

describe("togglePlan", () => {
	it("toggles plan mode", () => {
		expect(useStatusStore.getState().planMode).toBe(true)
		useStatusStore.getState().togglePlan()
		expect(useStatusStore.getState().planMode).toBe(false)
		useStatusStore.getState().togglePlan()
		expect(useStatusStore.getState().planMode).toBe(true)
	})
})

describe("toggleSection", () => {
	it("toggles a section collapsed state", () => {
		expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(false)
		useStatusStore.getState().toggleSection("plugins")
		expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(true)
		useStatusStore.getState().toggleSection("plugins")
		expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(false)
	})

	it("manages multiple sections independently", () => {
		useStatusStore.getState().toggleSection("plugins")
		useStatusStore.getState().toggleSection("skills")
		expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(true)
		expect(useStatusStore.getState().collapsedSections.has("skills")).toBe(true)
		useStatusStore.getState().toggleSection("plugins")
		expect(useStatusStore.getState().collapsedSections.has("plugins")).toBe(false)
		expect(useStatusStore.getState().collapsedSections.has("skills")).toBe(true)
	})
})

describe("setMcpTools", () => {
	it("sets MCP tools", () => {
		const tools = [
			{ name: "tool-a", status: "ready" as const },
			{ name: "tool-b", status: "loading" as const },
		]
		useStatusStore.getState().setMcpTools(tools)
		expect(useStatusStore.getState().mcpTools).toEqual(tools)
	})
})

describe("setLspStatus", () => {
	it("sets LSP status", () => {
		useStatusStore.getState().setLspStatus("connecting")
		expect(useStatusStore.getState().lspStatus).toBe("connecting")
		useStatusStore.getState().setLspStatus("connected")
		expect(useStatusStore.getState().lspStatus).toBe("connected")
	})
})

describe("setPlugins", () => {
	it("sets plugins list", () => {
		const plugins = [
			{ name: "test-plugin", path: "/plugins/test", enabled: true, toolNames: ["tool1"], commandNames: [], scope: "project" as const },
		]
		useStatusStore.getState().setPlugins(plugins)
		expect(useStatusStore.getState().plugins).toEqual(plugins)
	})
})

describe("setSkills", () => {
	it("sets skills list", () => {
		const skills = [
			{ name: "my-skill", description: "desc", filePath: "/skills/my", baseDir: "/skills", disableModelInvocation: false, enabled: true, scope: "project" as const },
		]
		useStatusStore.getState().setSkills(skills)
		expect(useStatusStore.getState().skills).toEqual(skills)
	})
})

describe("toggleSkillExpanded", () => {
	it("expands a skill and collapses on second toggle", () => {
		expect(useStatusStore.getState().expandedSkill).toBeNull()
		useStatusStore.getState().toggleSkillExpanded("my-skill")
		expect(useStatusStore.getState().expandedSkill).toBe("my-skill")
		useStatusStore.getState().toggleSkillExpanded("my-skill")
		expect(useStatusStore.getState().expandedSkill).toBeNull()
	})

	it("switches expanded skill", () => {
		useStatusStore.getState().toggleSkillExpanded("skill-a")
		useStatusStore.getState().toggleSkillExpanded("skill-b")
		expect(useStatusStore.getState().expandedSkill).toBe("skill-b")
	})
})

describe("toggleSkillEnabled", () => {
	it("enables a disabled skill and calls API", () => {
		useStatusStore.setState({
			skills: [
				{ name: "skill-1", description: "d", filePath: "/s", baseDir: "/s", disableModelInvocation: false, enabled: false, scope: "project" as const },
			],
		})

		useStatusStore.getState().toggleSkillEnabled("skill-1")

		expect(useStatusStore.getState().skills[0].enabled).toBe(true)
		expect(mockedCall).toHaveBeenCalledWith("agent.setDisabledSkill", { skillName: "skill-1", disabled: false })
	})

	it("disables an enabled skill", () => {
		useStatusStore.setState({
			skills: [
				{ name: "skill-1", description: "d", filePath: "/s", baseDir: "/s", disableModelInvocation: false, enabled: true, scope: "project" as const },
			],
		})

		useStatusStore.getState().toggleSkillEnabled("skill-1")

		expect(useStatusStore.getState().skills[0].enabled).toBe(false)
		expect(mockedCall).toHaveBeenCalledWith("agent.setDisabledSkill", { skillName: "skill-1", disabled: true })
	})

	it("does nothing for unknown skill", () => {
		useStatusStore.setState({ skills: [] })
		useStatusStore.getState().toggleSkillEnabled("nonexistent")
		expect(mockedCall).not.toHaveBeenCalled()
	})
})

describe("togglePluginExpanded", () => {
	it("expands a plugin and collapses on second toggle", () => {
		useStatusStore.getState().togglePluginExpanded("/plugins/a")
		expect(useStatusStore.getState().expandedPlugin).toBe("/plugins/a")
		useStatusStore.getState().togglePluginExpanded("/plugins/a")
		expect(useStatusStore.getState().expandedPlugin).toBeNull()
	})
})

describe("derivePluginScope", () => {
	it("returns 'global' for paths under ~/.claude", () => {
		const home = process.env.HOME ?? ""
		const result = derivePluginScope(`${home}/.claude/plugins/test.ts`)
		expect(result).toBe("global")
	})

	it("returns 'project' for project-local paths", () => {
		const result = derivePluginScope("/workspace/project/.pi/plugins/test.ts")
		expect(result).toBe("project")
	})
})

describe("deriveSkillScope", () => {
	it("returns 'global' for paths under ~/.agents/skills", () => {
		const home = process.env.HOME ?? ""
		const result = deriveSkillScope(`${home}/.agents/skills/my-skill/SKILL.md`)
		expect(result).toBe("global")
	})

	it("returns 'project' for project-local paths", () => {
		const result = deriveSkillScope("/workspace/project/.opencode/skills/test/SKILL.md")
		expect(result).toBe("project")
	})
})

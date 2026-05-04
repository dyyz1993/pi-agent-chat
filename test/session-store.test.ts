import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("zustand/middleware", async (importOriginal) => {
	const actual = await importOriginal<typeof import("zustand/middleware")>()
	return {
		...actual,
		persist: (fn: unknown) => fn,
	}
})

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

vi.mock("../src/mainview/stores/use-chat-store", () => ({
	useChatStore: {
		getState: vi.fn(() => ({
			loadSessionMessages: vi.fn().mockResolvedValue(undefined),
			clearSessionMessages: vi.fn(),
			messagesBySession: {},
		})),
		setState: vi.fn(),
	},
}))

vi.mock("../src/mainview/stores/use-app-store", () => ({
	useAppStore: {
		getState: vi.fn(() => ({ addLog: vi.fn() })),
	},
}))

vi.mock("../src/mainview/stores/use-explorer-store", () => ({
	useExplorerStore: {
		getState: vi.fn(() => ({ setCurrentPath: vi.fn(), listRootDir: vi.fn() })),
	},
}))

vi.mock("../src/mainview/stores/use-status-store", () => ({
	useStatusStore: {
		getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn() })),
	},
	deriveSkillScope: vi.fn(() => "project"),
	derivePluginScope: vi.fn(() => "project"),
}))

vi.mock("../src/mainview/stores/use-turn-store", () => ({
	useTurnStore: {
		getState: vi.fn(() => ({ clearSessionUI: vi.fn() })),
	},
}))

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
	useChatNavStore: {
		getState: vi.fn(() => ({ clearSessionUI: vi.fn() })),
	},
}))

vi.mock("../src/mainview/stores/session-subscriptions", () => ({
	setupSubscriptions: vi.fn(),
	cleanupSession: vi.fn(),
	cleanupSessionData: vi.fn(),
	clearSubscriptionState: (s: Record<string, unknown>) => {
		delete (s as Record<string, unknown>).agentSubscriptions
		return {}
	},
	syncTabsToBackend: vi.fn(),
}))

import { useSessionStore } from "../src/mainview/stores/use-session-store"
import { apiClient } from "../src/mainview/lib/api-client"
import type { SessionMeta, ProjectTab } from "../src/mainview/types"
import type { SessionMeta, ProjectTab } from "../src/mainview/types"

const mockedCall = vi.mocked(apiClient.call)

const TAB_A: ProjectTab = { id: "tab-a", name: "Project A", path: "/project-a" }
const TAB_B: ProjectTab = { id: "tab-b", name: "Project B", path: "/project-b" }

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
	return {
		sessionId: "sess-1",
		name: "",
		sessionPath: "/sessions/sess-1",
		projectPath: "/project-a",
		parentSessionPath: null,
		messageCount: 0,
		firstMessage: "",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		status: "idle",
		...overrides,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	useSessionStore.setState({
		sessionsByProject: {},
		activeSessionId: null,
		projectTabs: [],
		activeProjectId: null,
		loading: false,
		agentSubscriptions: {},
		subagentSubscriptions: {},
		todoSubscriptions: {},
		bashSubscriptions: {},
		lspSubscriptions: {},
		rulesSubscriptions: {},
		notifySubscriptions: {},
		memorySubscriptions: {},
		sessionReady: {},
		todosBySession: {},
		sessionContextMap: {},
		sessionStatusMap: {},
		queueBySession: {},
		currentModel: null,
		currentThinkingLevel: "medium",
		availableModels: [],
		projectStartFailed: {},
		projectStartError: {},
		_projectVersion: 0,
	})
})

describe("addProjectTab", () => {
	it("adds a new tab and sets it as active", () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		const state = useSessionStore.getState()
		expect(state.projectTabs).toHaveLength(1)
		expect(state.activeProjectId).toBe("tab-a")
	})

	it("does not duplicate tab with same path", () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		useSessionStore.getState().addProjectTab({ ...TAB_A, id: "tab-a-dup" })
		const state = useSessionStore.getState()
		expect(state.projectTabs).toHaveLength(1)
		expect(state.activeProjectId).toBe("tab-a")
	})

	it("adds multiple tabs with different paths", () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		useSessionStore.getState().addProjectTab(TAB_B)
		expect(useSessionStore.getState().projectTabs).toHaveLength(2)
	})
})

describe("removeProjectTab", () => {
	it("removes a tab and switches active to last remaining", () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		useSessionStore.getState().addProjectTab(TAB_B)
		useSessionStore.getState().removeProjectTab("tab-b")
		const state = useSessionStore.getState()
		expect(state.projectTabs).toHaveLength(1)
		expect(state.activeProjectId).toBe("tab-a")
	})

	it("sets activeProjectId to null when removing the last tab", () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		useSessionStore.getState().removeProjectTab("tab-a")
		expect(useSessionStore.getState().activeProjectId).toBeNull()
	})

	it("does not affect other tabs when removing non-active tab", () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		useSessionStore.getState().addProjectTab(TAB_B)
		useSessionStore.getState().removeProjectTab("tab-a")
		expect(useSessionStore.getState().projectTabs[0].id).toBe("tab-b")
	})
})

describe("reorderProjectTabs", () => {
	it("moves tab from one index to another", () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		useSessionStore.getState().addProjectTab(TAB_B)
		useSessionStore.getState().addProjectTab({ id: "tab-c", name: "C", path: "/c" })

		useSessionStore.getState().reorderProjectTabs(0, 2)

		const tabs = useSessionStore.getState().projectTabs
		expect(tabs[0].id).toBe("tab-b")
		expect(tabs[1].id).toBe("tab-c")
		expect(tabs[2].id).toBe("tab-a")
	})

	it("handles same index reorder as no-op", () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		useSessionStore.getState().addProjectTab(TAB_B)

		useSessionStore.getState().reorderProjectTabs(0, 0)

		const tabs = useSessionStore.getState().projectTabs
		expect(tabs[0].id).toBe("tab-a")
	})
})

describe("loadSessionsForProject", () => {
	it("loads sessions from API and stores them", async () => {
		const sessions = [makeSession()]
		mockedCall.mockResolvedValueOnce({ sessions })

		const result = await useSessionStore.getState().loadSessionsForProject("/project-a")

		expect(result).toEqual(sessions)
		expect(useSessionStore.getState().sessionsByProject["/project-a"]).toEqual(sessions)
		expect(useSessionStore.getState().loading).toBe(false)
	})

	it("returns empty array on error", async () => {
		mockedCall.mockRejectedValueOnce(new Error("fail"))

		const result = await useSessionStore.getState().loadSessionsForProject("/project-a")

		expect(result).toEqual([])
		expect(useSessionStore.getState().loading).toBe(false)
	})
})

describe("createNewSession", () => {
	it("creates a session via API and adds to store", async () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		useSessionStore.setState({ activeProjectId: "tab-a" })

		mockedCall.mockResolvedValueOnce({
			sessionId: "new-sess",
			sessionPath: "/sessions/new-sess",
		})

		await useSessionStore.getState().createNewSession()

		const state = useSessionStore.getState()
		const sessions = state.sessionsByProject["/project-a"]
		expect(sessions).toHaveLength(1)
		expect(sessions[0].sessionId).toBe("new-sess")
	})

	it("handles API error gracefully", async () => {
		useSessionStore.getState().addProjectTab(TAB_A)
		useSessionStore.setState({ activeProjectId: "tab-a" })
		mockedCall.mockRejectedValueOnce(new Error("create fail"))

		await useSessionStore.getState().createNewSession()

		expect(useSessionStore.getState().sessionsByProject["/project-a"]).toBeUndefined()
	})
})

describe("deleteSession", () => {
	it("removes session from store and clears activeSessionId if active", () => {
		const session = makeSession({ sessionId: "to-delete" })
		useSessionStore.setState({
			sessionsByProject: { "/project-a": [session] },
			activeSessionId: "to-delete",
			activeProjectId: "tab-a",
			projectTabs: [TAB_A],
		})

		useSessionStore.getState().deleteSession("to-delete")

		const state = useSessionStore.getState()
		expect(state.sessionsByProject["/project-a"]).toHaveLength(0)
		expect(state.activeSessionId).toBeNull()
	})

	it("does not change activeSessionId when deleting a different session", () => {
		useSessionStore.setState({
			sessionsByProject: {
				"/project-a": [
					makeSession({ sessionId: "sess-1" }),
					makeSession({ sessionId: "sess-2" }),
				],
			},
			activeSessionId: "sess-1",
			activeProjectId: "tab-a",
			projectTabs: [TAB_A],
		})

		useSessionStore.getState().deleteSession("sess-2")

		expect(useSessionStore.getState().activeSessionId).toBe("sess-1")
	})
})

describe("setSessionTodos", () => {
	it("sets todos for a session", () => {
		useSessionStore.getState().setSessionTodos("sess-1", [
			{ id: 1, text: "Task 1", done: false },
		])
		expect(useSessionStore.getState().todosBySession["sess-1"]).toHaveLength(1)
	})

	it("overwrites existing todos", () => {
		useSessionStore.getState().setSessionTodos("sess-1", [
			{ id: 1, text: "Task 1", done: false },
		])
		useSessionStore.getState().setSessionTodos("sess-1", [
			{ id: 2, text: "Task 2", done: true },
			{ id: 3, text: "Task 3", done: false },
		])
		expect(useSessionStore.getState().todosBySession["sess-1"]).toHaveLength(2)
	})
})

describe("updateSessionContext", () => {
	it("sets context for a session", () => {
		useSessionStore.getState().updateSessionContext("sess-1", { tokens: 1000, contextWindow: 200000 })
		const ctx = useSessionStore.getState().sessionContextMap["sess-1"]
		expect(ctx.tokens).toBe(1000)
		expect(ctx.contextWindow).toBe(200000)
	})

	it("merges partial updates", () => {
		useSessionStore.getState().updateSessionContext("sess-1", { tokens: 1000, contextWindow: 200000 })
		useSessionStore.getState().updateSessionContext("sess-1", { tokens: 2000 })
		const ctx = useSessionStore.getState().sessionContextMap["sess-1"]
		expect(ctx.tokens).toBe(2000)
		expect(ctx.contextWindow).toBe(200000)
	})
})

describe("updateSessionStatus", () => {
	it("sets session status", () => {
		useSessionStore.getState().updateSessionStatus("sess-1", "streaming")
		expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("streaming")
	})

	it("updates status independently per session", () => {
		useSessionStore.getState().updateSessionStatus("sess-1", "idle")
		useSessionStore.getState().updateSessionStatus("sess-2", "compacting")
		expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("idle")
		expect(useSessionStore.getState().sessionStatusMap["sess-2"]).toBe("compacting")
	})
})

describe("setCurrentModel / setThinkingLevel", () => {
	it("sets current model", () => {
		useSessionStore.getState().setCurrentModel("anthropic", "claude-4")
		expect(useSessionStore.getState().currentModel).toEqual({ provider: "anthropic", id: "claude-4" })
	})

	it("sets thinking level", () => {
		useSessionStore.getState().setThinkingLevel("high")
		expect(useSessionStore.getState().currentThinkingLevel).toBe("high")
	})
})

describe("renameSession", () => {
	it("updates session name in store and calls API", () => {
		const session = makeSession({ sessionId: "sess-1", sessionPath: "/s/1" })
		useSessionStore.setState({
			sessionsByProject: { "/project-a": [session] },
		})

		useSessionStore.getState().renameSession("sess-1", "My Session")

		const updated = useSessionStore.getState().sessionsByProject["/project-a"]
		expect(updated[0].name).toBe("My Session")
		expect(mockedCall).toHaveBeenCalledWith("session.rename", expect.objectContaining({ newName: "My Session" }))
	})
})

describe("togglePinSession", () => {
	it("toggles pinned state and calls correct API", () => {
		const session = makeSession({ sessionId: "sess-1", pinned: false })
		useSessionStore.setState({
			sessionsByProject: { "/project-a": [session] },
		})

		useSessionStore.getState().togglePinSession("sess-1")
		expect(useSessionStore.getState().sessionsByProject["/project-a"][0].pinned).toBe(true)
		expect(mockedCall).toHaveBeenCalledWith("session.pin", { sessionId: "sess-1" })

		useSessionStore.getState().togglePinSession("sess-1")
		expect(useSessionStore.getState().sessionsByProject["/project-a"][0].pinned).toBe(false)
		expect(mockedCall).toHaveBeenCalledWith("session.unpin", { sessionId: "sess-1" })
	})
})

describe("updateSessionProjectPath", () => {
	it("updates projectPath for a session", () => {
		const session = makeSession({ sessionId: "sess-1", sessionPath: "/s/1", projectPath: "/old" })
		useSessionStore.setState({
			sessionsByProject: { "/old": [session] },
		})

		useSessionStore.getState().updateSessionProjectPath("sess-1", "/new")

		let found = false
		for (const sessions of Object.values(useSessionStore.getState().sessionsByProject)) {
			const s = sessions.find((x) => x.sessionId === "sess-1")
			if (s) { found = true; expect(s.projectPath).toBe("/new") }
		}
		expect(found).toBe(true)
	})
})

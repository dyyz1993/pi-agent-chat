import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"

const { getSessionState, setSessionState } = vi.hoisted(() => {
	const state = {
		activeSessionId: null as string | null,
		sessionsByProject: {} as Record<string, unknown[]>,
		projectTabs: [] as Array<{ id: string; name: string; path: string; active?: boolean; connected?: boolean }>,
		activeProjectId: null as string | null,
	}
	return {
		getSessionState: () => state,
		setSessionState: (p: Partial<typeof state>) => Object.assign(state, p),
	}
})

vi.mock("../src/mainview/lib/api-client", () => ({
	apiClient: { call: vi.fn() },
}))

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
	useRpcDebugStore: { getState: vi.fn(() => ({ addEntry: vi.fn() })) },
}))

vi.mock("../src/mainview/stores/use-session-store", () => {
	function useSessionStore(selector: (s: ReturnType<typeof getSessionState>) => unknown) {
		return selector(getSessionState())
	}
	useSessionStore.getState = () => getSessionState()
	useSessionStore.setState = (p: Partial<ReturnType<typeof getSessionState>>) => setSessionState(p)
	return { useSessionStore }
})

import { useMemoryStore } from "../src/mainview/stores/use-memory-store"
import { apiClient } from "../src/mainview/lib/api-client"
import { MemoryPanel } from "../src/mainview/components/memory-panel/MemoryPanel"

const mockApiCall = vi.mocked(apiClient.call)

beforeEach(() => {
	vi.clearAllMocks()

	useMemoryStore.setState({
		eventsBySession: {},
		filesBySession: {},
		entrypointBySession: {},
		injectedBySession: {},
		expandedFile: null,
		collapsedSections: new Set(["operations"]),
	})

	setSessionState({
		activeSessionId: null,
		sessionsByProject: {},
		projectTabs: [],
		activeProjectId: null,
	})
})

afterEach(() => {
	cleanup()
})

describe("MemoryPanel", () => {
	it("renders empty state when no session", () => {
		render(<MemoryPanel />)
		expect(screen.getByText("无活动会话")).toBeInTheDocument()
	})

	it("renders empty state when session has no data", () => {
		setSessionState({ activeSessionId: "sess-1" })
		useMemoryStore.setState({
			eventsBySession: {},
			filesBySession: {},
			entrypointBySession: {},
			injectedBySession: {},
		})
		render(<MemoryPanel />)
		expect(screen.getByText("暂无记忆")).toBeInTheDocument()
	})

	it("renders injected memories section", () => {
		setSessionState({ activeSessionId: "sess-1" })
		useMemoryStore.setState({
			injectedBySession: {
				"sess-1": [
					{ summary: "prefers dark mode", snippet: "user likes dark" },
					{ summary: "uses TypeScript", snippet: "TS preferred" },
				],
			},
			eventsBySession: {},
			filesBySession: {},
			entrypointBySession: {},
		})
		render(<MemoryPanel />)
		expect(screen.getByText("本次注入")).toBeInTheDocument()
		expect(screen.getByText("prefers dark mode")).toBeInTheDocument()
		expect(screen.getByText("uses TypeScript")).toBeInTheDocument()
	})

	it("renders memory files section with type badges", () => {
		setSessionState({ activeSessionId: "sess-1" })
		useMemoryStore.setState({
			filesBySession: {
				"sess-1": [
					{ filename: "user.md", filePath: "/user.md", description: "user pref", type: "user", mtimeMs: Date.now(), size: 100 },
					{ filename: "fb.md", filePath: "/fb.md", description: "feedback", type: "feedback", mtimeMs: Date.now(), size: 100 },
					{ filename: "proj.md", filePath: "/proj.md", description: "project info", type: "project", mtimeMs: Date.now(), size: 100 },
					{ filename: "ref.md", filePath: "/ref.md", description: "reference doc", type: "reference", mtimeMs: Date.now(), size: 100 },
				],
			},
			eventsBySession: {},
			entrypointBySession: {},
			injectedBySession: {},
		})
		render(<MemoryPanel />)
		expect(screen.getByText("记忆文件")).toBeInTheDocument()
		expect(screen.getByText("用户")).toBeInTheDocument()
		expect(screen.getByText("反馈")).toBeInTheDocument()
		expect(screen.getByText("项目")).toBeInTheDocument()
		expect(screen.getByText("参考")).toBeInTheDocument()
	})

	it("renders entrypoint section", () => {
		setSessionState({ activeSessionId: "sess-1" })
		useMemoryStore.setState({
			entrypointBySession: { "sess-1": "# Memory Index\n\nProject memory" },
			eventsBySession: {},
			filesBySession: {},
			injectedBySession: {},
		})
		render(<MemoryPanel />)
		expect(screen.getByText("MEMORY.md 索引")).toBeInTheDocument()
	})

	it("renders events section", () => {
		setSessionState({ activeSessionId: "sess-1" })
		useMemoryStore.setState({
			eventsBySession: {
				"sess-1": [
					{ id: "e1", customType: "memory_prefetch", data: null, timestamp: Date.now() },
					{ id: "e2", customType: "memory_extract", data: null, timestamp: Date.now() },
				],
			},
			filesBySession: {},
			entrypointBySession: {},
			injectedBySession: {},
			collapsedSections: new Set(["files", "injected", "entrypoint"]),
		})
		render(<MemoryPanel />)
		expect(screen.getByText("最近操作")).toBeInTheDocument()
		expect(screen.getByText("搜索记忆")).toBeInTheDocument()
		expect(screen.getByText("保存记忆")).toBeInTheDocument()
	})

	it("section collapse/expand toggles content visibility", () => {
		setSessionState({ activeSessionId: "sess-1" })
		useMemoryStore.setState({
			injectedBySession: {
				"sess-1": [{ summary: "test injection", snippet: "snip" }],
			},
			eventsBySession: {},
			filesBySession: {},
			entrypointBySession: {},
			collapsedSections: new Set(["operations"]),
		})
		render(<MemoryPanel />)

		expect(screen.getByText("test injection")).toBeInTheDocument()

		fireEvent.click(screen.getByText("本次注入"))
		expect(screen.queryByText("test injection")).not.toBeInTheDocument()

		fireEvent.click(screen.getByText("本次注入"))
		expect(screen.getByText("test injection")).toBeInTheDocument()
	})

	it("file expand shows content preview", async () => {
		setSessionState({ activeSessionId: "sess-1" })
		useMemoryStore.setState({
			filesBySession: {
				"sess-1": [
					{ filename: "user.md", filePath: "/mem/user.md", description: "user pref", type: "user", mtimeMs: Date.now(), size: 100 },
				],
			},
			eventsBySession: {},
			entrypointBySession: {},
			injectedBySession: {},
			collapsedSections: new Set(["operations"]),
		})

		mockApiCall.mockResolvedValueOnce({ content: "file content here" })

		render(<MemoryPanel />)

		fireEvent.click(screen.getByText("user pref"))

		await waitFor(() => {
			expect(screen.getByText("file content here")).toBeInTheDocument()
		})
	})
})

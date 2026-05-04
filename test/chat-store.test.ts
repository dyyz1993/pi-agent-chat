import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../src/mainview/lib/api-client", () => ({
	apiClient: {
		call: vi.fn(),
		onReconnect: vi.fn(),
	},
}))

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
	useRpcDebugStore: {
		getState: vi.fn(() => ({ addEntry: vi.fn() })),
	},
}))

vi.mock("../src/mainview/stores/use-app-store", () => ({
	useAppStore: {
		getState: vi.fn(() => ({ addLog: vi.fn() })),
	},
}))

vi.mock("../src/mainview/stores/use-session-store", () => ({
	useSessionStore: {
		getState: vi.fn(() => ({
			activeSessionId: "sess-1",
			sessionReady: { "sess-1": true },
			sessionContextMap: {},
			restoreContextFromHistory: vi.fn(),
		})),
		setState: vi.fn(),
	},
}))

vi.mock("../src/mainview/stores/use-memory-store", () => ({
	useMemoryStore: {
		getState: vi.fn(() => ({
			addEvent: vi.fn(),
			addInjected: vi.fn(),
		})),
	},
}))

vi.mock("../src/mainview/components/chat/memory-config", () => ({
	ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch_result"]),
}))

vi.mock("../src/mainview/lib/message-mapper", () => ({
	messageToChatMessage: (raw: Record<string, unknown>) => ({
		id: raw.id ?? `msg-${Date.now()}`,
		role: raw.role ?? "user",
		content: raw.content ?? [{ type: "text", text: raw.content ?? "" }],
		timestamp: raw.timestamp ?? Date.now(),
	}),
}))

import { useChatStore, normalizeToolBlocks } from "../src/mainview/stores/use-chat-store"
import type { ChatMessage, ContentBlock } from "../src/mainview/types"

beforeEach(() => {
	vi.clearAllMocks()
	useChatStore.setState({
		messagesBySession: {},
		inputText: "",
		isStreaming: false,
		streamContentVersion: 0,
		loadingSessions: new Set(),
		historyLoadVersion: 0,
	})
})

describe("setInputText", () => {
	it("sets input text", () => {
		useChatStore.getState().setInputText("hello")
		expect(useChatStore.getState().inputText).toBe("hello")
	})

	it("clears input text", () => {
		useChatStore.getState().setInputText("hello")
		useChatStore.getState().setInputText("")
		expect(useChatStore.getState().inputText).toBe("")
	})
})

describe("addMessage", () => {
	it("adds message to active session", () => {
		const msg: ChatMessage = {
			id: "msg-1",
			role: "user",
			content: [{ type: "text", text: "hello" }],
			timestamp: Date.now(),
		}
		useChatStore.getState().addMessage(msg)

		const state = useChatStore.getState()
		expect(state.messagesBySession["sess-1"]).toHaveLength(1)
		expect(state.messagesBySession["sess-1"][0].id).toBe("msg-1")
	})

	it("appends messages", () => {
		const msg1: ChatMessage = { id: "m1", role: "user", content: [{ type: "text", text: "a" }], timestamp: 1 }
		const msg2: ChatMessage = { id: "m2", role: "user", content: [{ type: "text", text: "b" }], timestamp: 2 }

		useChatStore.getState().addMessage(msg1)
		useChatStore.getState().addMessage(msg2)

		expect(useChatStore.getState().messagesBySession["sess-1"]).toHaveLength(2)
	})
})

describe("setMessagesForSession", () => {
	it("sets messages for a specific session", () => {
		const msgs: ChatMessage[] = [
			{ id: "m1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
		]
		useChatStore.getState().setMessagesForSession("sess-1", msgs)

		expect(useChatStore.getState().messagesBySession["sess-1"]).toEqual(msgs)
	})

	it("replaces existing messages", () => {
		useChatStore.getState().setMessagesForSession("sess-1", [
			{ id: "old", role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 },
		])
		useChatStore.getState().setMessagesForSession("sess-1", [
			{ id: "new", role: "user", content: [{ type: "text", text: "new" }], timestamp: 2 },
		])

		expect(useChatStore.getState().messagesBySession["sess-1"]).toHaveLength(1)
		expect(useChatStore.getState().messagesBySession["sess-1"][0].id).toBe("new")
	})
})

describe("clearSessionMessages", () => {
	it("removes messages for a session", () => {
		useChatStore.getState().setMessagesForSession("sess-1", [
			{ id: "m1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
		])
		useChatStore.getState().setMessagesForSession("sess-2", [
			{ id: "m2", role: "user", content: [{ type: "text", text: "there" }], timestamp: 2 },
		])

		useChatStore.getState().clearSessionMessages("sess-1")

		expect(useChatStore.getState().messagesBySession["sess-1"]).toBeUndefined()
		expect(useChatStore.getState().messagesBySession["sess-2"]).toHaveLength(1)
	})
})

describe("setIsStreaming / incrementStreamVersion", () => {
	it("toggles streaming state", () => {
		useChatStore.getState().setIsStreaming(true)
		expect(useChatStore.getState().isStreaming).toBe(true)
		useChatStore.getState().setIsStreaming(false)
		expect(useChatStore.getState().isStreaming).toBe(false)
	})

	it("increments stream version", () => {
		const v0 = useChatStore.getState().streamContentVersion
		useChatStore.getState().incrementStreamVersion()
		expect(useChatStore.getState().streamContentVersion).toBe(v0 + 1)
	})
})

describe("normalizeToolBlocks", () => {
	it("merges toolCall and toolResult into toolExecution (done)", () => {
		const msgs: ChatMessage[] = [
			{
				id: "m1",
				role: "assistant",
				content: [{ type: "toolCall", id: "tc-1", name: "bash", input: "echo hi" }],
				timestamp: 1,
			},
			{
				id: "m2",
				role: "toolResult",
				content: [{ type: "toolResult", toolCallId: "tc-1", toolName: "bash", content: "hi" }],
				timestamp: 2,
			},
		]

		normalizeToolBlocks(msgs)

		expect(msgs).toHaveLength(1)
		expect(msgs[0].role).toBe("assistant")
		const block = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>
		expect(block.type).toBe("toolExecution")
		expect(block.toolCallId).toBe("tc-1")
		expect(block.toolName).toBe("bash")
		expect(block.status).toBe("done")
		expect(block.output).toBe("hi")
	})

	it("marks toolExecution as error when toolResult has isError", () => {
		const msgs: ChatMessage[] = [
			{
				id: "m1",
				role: "assistant",
				content: [{ type: "toolCall", id: "tc-1", name: "bash", input: "fail" }],
				timestamp: 1,
			},
			{
				id: "m2",
				role: "toolResult",
				content: [{ type: "toolResult", toolCallId: "tc-1", toolName: "bash", content: "error!", isError: true }],
				timestamp: 2,
			},
		]

		normalizeToolBlocks(msgs)

		const block = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>
		expect(block.status).toBe("error")
	})

	it("converts unmatched toolCall to toolExecution with running status", () => {
		const msgs: ChatMessage[] = [
			{
				id: "m1",
				role: "assistant",
				content: [{ type: "toolCall", id: "tc-orphan", name: "read", input: "file.ts" }],
				timestamp: 1,
			},
		]

		normalizeToolBlocks(msgs)

		const block = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>
		expect(block.type).toBe("toolExecution")
		expect(block.status).toBe("running")
	})

	it("handles multiple toolCalls with corresponding toolResults", () => {
		const msgs: ChatMessage[] = [
			{
				id: "m1",
				role: "assistant",
				content: [
					{ type: "toolCall", id: "tc-1", name: "bash", input: "echo a" },
					{ type: "toolCall", id: "tc-2", name: "bash", input: "echo b" },
				],
				timestamp: 1,
			},
			{
				id: "m2",
				role: "toolResult",
				content: [{ type: "toolResult", toolCallId: "tc-1", toolName: "bash", content: "a" }],
				timestamp: 2,
			},
			{
				id: "m3",
				role: "toolResult",
				content: [{ type: "toolResult", toolCallId: "tc-2", toolName: "bash", content: "b" }],
				timestamp: 3,
			},
		]

		normalizeToolBlocks(msgs)

		expect(msgs).toHaveLength(1)
		expect(msgs[0].content).toHaveLength(2)
		const b1 = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>
		const b2 = msgs[0].content[1] as Extract<ContentBlock, { type: "toolExecution" }>
		expect(b1.status).toBe("done")
		expect(b1.output).toBe("a")
		expect(b2.status).toBe("done")
		expect(b2.output).toBe("b")
	})

	it("preserves non-tool content blocks", () => {
		const msgs: ChatMessage[] = [
			{
				id: "m1",
				role: "assistant",
				content: [
					{ type: "text", text: "Hello" },
					{ type: "toolCall", id: "tc-1", name: "bash", input: "echo hi" },
				],
				timestamp: 1,
			},
			{
				id: "m2",
				role: "toolResult",
				content: [{ type: "toolResult", toolCallId: "tc-1", toolName: "bash", content: "hi" }],
				timestamp: 2,
			},
		]

		normalizeToolBlocks(msgs)

		expect(msgs[0].content[0]).toEqual({ type: "text", text: "Hello" })
	})
})

describe("session isolation", () => {
	it("messages for different sessions do not interfere", () => {
		useChatStore.getState().setMessagesForSession("sess-1", [
			{ id: "m1", role: "user", content: [{ type: "text", text: "a" }], timestamp: 1 },
		])
		useChatStore.getState().setMessagesForSession("sess-2", [
			{ id: "m2", role: "user", content: [{ type: "text", text: "b" }], timestamp: 2 },
		])

		useChatStore.getState().clearSessionMessages("sess-1")

		expect(useChatStore.getState().messagesBySession["sess-1"]).toBeUndefined()
		expect(useChatStore.getState().messagesBySession["sess-2"]).toHaveLength(1)
	})
})

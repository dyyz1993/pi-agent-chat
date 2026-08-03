import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("../../../src/mainview/lib/api-client", () => ({
	apiClient: {
		call: vi.fn(),
		onReconnect: vi.fn(),
	},
}))

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
	useRpcDebugStore: {
		getState: vi.fn(() => ({ addEntry: vi.fn() })),
	},
}))

import { useNotificationStore } from "../../../src/mainview/stores/use-notification-store"

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	useNotificationStore.setState({
		notifications: [],
		panelOpen: false,
	})
})

afterEach(() => {
	vi.useRealTimers()
})

describe("push", () => {
	it("adds a notification to the list", () => {
		useNotificationStore.getState().push({
			message: "test notification",
			level: "info",
		})

		const state = useNotificationStore.getState()
		expect(state.notifications).toHaveLength(1)
		expect(state.notifications[0].message).toBe("test notification")
		expect(state.notifications[0].level).toBe("info")
		expect(state.notifications[0].read).toBe(false)
	})

	it("auto-dismisses info notifications after 5s", () => {
		useNotificationStore.getState().push({
			message: "info msg",
			level: "info",
		})

		expect(useNotificationStore.getState().notifications).toHaveLength(1)

		vi.advanceTimersByTime(5000)

		expect(useNotificationStore.getState().notifications).toHaveLength(0)
	})

	it("does not auto-dismiss warning notifications", () => {
		useNotificationStore.getState().push({
			message: "warning msg",
			level: "warning",
		})

		vi.advanceTimersByTime(10000)

		expect(useNotificationStore.getState().notifications).toHaveLength(1)
	})

	it("does not auto-dismiss error notifications", () => {
		useNotificationStore.getState().push({
			message: "error msg",
			level: "error",
		})

		vi.advanceTimersByTime(10000)

		expect(useNotificationStore.getState().notifications).toHaveLength(1)
	})

	it("prepends new notifications", () => {
		useNotificationStore.getState().push({ message: "first", level: "warning" })
		useNotificationStore.getState().push({ message: "second", level: "warning" })

		const state = useNotificationStore.getState()
		expect(state.notifications[0].message).toBe("second")
		expect(state.notifications[1].message).toBe("first")
	})

	it("generates unique id and timestamp", () => {
		useNotificationStore.getState().push({ message: "a", level: "info" })
		useNotificationStore.getState().push({ message: "b", level: "info" })

		const [n1, n2] = useNotificationStore.getState().notifications
		expect(n1.id).not.toBe(n2.id)
		expect(typeof n1.timestamp).toBe("number")
	})

	it("preserves optional sessionId and requestId", () => {
		useNotificationStore.getState().push({
			message: "test",
			level: "info",
			sessionId: "sess-1",
			requestId: "req-1",
		})

		const n = useNotificationStore.getState().notifications[0]
		expect(n.sessionId).toBe("sess-1")
		expect(n.requestId).toBe("req-1")
	})
})

describe("markRead", () => {
	it("marks a notification as read", () => {
		useNotificationStore.getState().push({ message: "test", level: "warning" })
		const id = useNotificationStore.getState().notifications[0].id

		useNotificationStore.getState().markRead(id)

		expect(useNotificationStore.getState().notifications[0].read).toBe(true)
	})

	it("does not affect other notifications", () => {
		useNotificationStore.getState().push({ message: "a", level: "warning" })
		useNotificationStore.getState().push({ message: "b", level: "warning" })

		const id = useNotificationStore.getState().notifications[1].id
		useNotificationStore.getState().markRead(id)

		expect(useNotificationStore.getState().notifications[0].read).toBe(false)
	})
})

describe("markAllRead", () => {
	it("marks all notifications as read", () => {
		useNotificationStore.getState().push({ message: "a", level: "warning" })
		useNotificationStore.getState().push({ message: "b", level: "warning" })

		useNotificationStore.getState().markAllRead()

		for (const n of useNotificationStore.getState().notifications) {
			expect(n.read).toBe(true)
		}
	})
})

describe("dismiss", () => {
	it("removes a specific notification", () => {
		useNotificationStore.getState().push({ message: "a", level: "warning" })
		useNotificationStore.getState().push({ message: "b", level: "warning" })

		const id = useNotificationStore.getState().notifications[0].id
		useNotificationStore.getState().dismiss(id)

		expect(useNotificationStore.getState().notifications).toHaveLength(1)
		expect(useNotificationStore.getState().notifications[0].message).toBe("a")
	})

	it("is a no-op for non-existent id", () => {
		useNotificationStore.getState().push({ message: "a", level: "warning" })
		useNotificationStore.getState().dismiss("nonexistent")
		expect(useNotificationStore.getState().notifications).toHaveLength(1)
	})
})

describe("clearAll", () => {
	it("removes all notifications", () => {
		useNotificationStore.getState().push({ message: "a", level: "warning" })
		useNotificationStore.getState().push({ message: "b", level: "error" })

		useNotificationStore.getState().clearAll()

		expect(useNotificationStore.getState().notifications).toHaveLength(0)
	})
})

describe("togglePanel / setPanelOpen", () => {
	it("toggles panel state", () => {
		expect(useNotificationStore.getState().panelOpen).toBe(false)
		useNotificationStore.getState().togglePanel()
		expect(useNotificationStore.getState().panelOpen).toBe(true)
		useNotificationStore.getState().togglePanel()
		expect(useNotificationStore.getState().panelOpen).toBe(false)
	})

	it("sets panel open state directly", () => {
		useNotificationStore.getState().setPanelOpen(true)
		expect(useNotificationStore.getState().panelOpen).toBe(true)
		useNotificationStore.getState().setPanelOpen(false)
		expect(useNotificationStore.getState().panelOpen).toBe(false)
	})
})

describe("actions", () => {
	it("stores action buttons alongside the notification", () => {
		const cancel = vi.fn()
		useNotificationStore.getState().push({
			message: "running",
			level: "warning",
			actions: [{ id: "cancel", label: "Cancel", onClick: cancel }],
		})

		const state = useNotificationStore.getState()
		expect(state.notifications).toHaveLength(1)
		expect(state.notifications[0].actions).toEqual([
			expect.objectContaining({ id: "cancel", label: "Cancel" }),
		])

		state.notifications[0].actions?.[0].onClick?.()
		expect(cancel).toHaveBeenCalledTimes(1)
	})

	it("dismiss removes the notification and its actions", () => {
		useNotificationStore.getState().push({
			message: "running",
			level: "warning",
			actions: [{ id: "cancel", label: "Cancel", onClick: () => {} }],
		})

		const id = useNotificationStore.getState().notifications[0].id
		useNotificationStore.getState().dismiss(id)

		expect(useNotificationStore.getState().notifications).toHaveLength(0)
	})
})

describe("unread / notifications consistency (UI test race condition)", () => {
	it("info notification auto-dismisses after 5s and both unread and length go to 0", () => {
		useNotificationStore.getState().push({ message: "info msg", level: "info" })

		const state1 = useNotificationStore.getState()
		expect(state1.notifications).toHaveLength(1)
		const unread1 = state1.notifications.filter((n) => !n.read).length
		expect(unread1).toBe(1)

		vi.advanceTimersByTime(5000)

		const state2 = useNotificationStore.getState()
		expect(state2.notifications).toHaveLength(0)
		const unread2 = state2.notifications.filter((n) => !n.read).length
		expect(unread2).toBe(0)
	})

	it("warning notification does not auto-dismiss", () => {
		useNotificationStore.getState().push({ message: "warning msg", level: "warning" })

		vi.advanceTimersByTime(10000)

		const state = useNotificationStore.getState()
		expect(state.notifications).toHaveLength(1)
		expect(state.notifications.filter((n) => !n.read).length).toBe(1)
	})

	it("markRead reduces unread but keeps length", () => {
		useNotificationStore.getState().push({ message: "warning msg", level: "warning" })
		const id = useNotificationStore.getState().notifications[0].id

		useNotificationStore.getState().markRead(id)

		const state = useNotificationStore.getState()
		expect(state.notifications).toHaveLength(1)
		expect(state.notifications.filter((n) => !n.read).length).toBe(0)
	})
})

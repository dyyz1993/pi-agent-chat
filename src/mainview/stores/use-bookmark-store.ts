import { create } from "zustand"
import { apiClient } from "../lib/api-client"

export interface BookmarkItem {
	id: string
	filename: string
	filePath: string
	title: string
	description: string
	summary: string
	tags: string[]
	sourceSessionId: string
	sourceMessageIds: string[]
	sourcePreview: string
	mtimeMs: number
	size: number
	expanded?: boolean
}

interface BookmarkState {
	itemsByProject: Record<string, BookmarkItem[]>
	expandedIds: Set<string>
	isLoading: boolean
	searchQuery: string
	error: string | null

	loadBookmarks: (projectPath: string) => Promise<void>
	addBookmark: (projectPath: string, sessionId: string, messageIds: string[], messageContent: string) => Promise<BookmarkItem | null>
	removeBookmark: (filePath: string) => Promise<void>
	toggleExpand: (id: string) => void
	setSearchQuery: (query: string) => void
	clearError: () => void
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
	itemsByProject: {},
	expandedIds: new Set<string>(),
	isLoading: false,
	searchQuery: "",
	error: null,

	loadBookmarks: async (projectPath: string) => {
		set({ isLoading: true, error: null })
		try {
			const result = await apiClient.call("bookmark.list", { projectPath })
			const items: BookmarkItem[] = (result as { files: BookmarkItem[] }).files.map((f) => ({
				...f,
				expanded: false,
			}))
			set({ itemsByProject: { ...get().itemsByProject, [projectPath]: items }, isLoading: false })
		} catch (e: unknown) {
			set({ error: (e instanceof Error ? e.message : String(e)) || "加载收藏失败", isLoading: false })
		}
	},

	addBookmark: async (projectPath, sessionId, messageIds, messageContent) => {
		set({ isLoading: true, error: null })
		try {
		const result = await apiClient.call("bookmark.add", { projectPath, sessionId, messageIds, messageContent }) as {
				filename: string; filePath: string; title: string; summary: string; tags: string[]
			}
		const item: BookmarkItem = {
				...result,
				id: result.filePath,
			sourcePreview: messageContent.slice(0, 200),
			description: "",
			sourceSessionId: sessionId,
			sourceMessageIds: messageIds,
			mtimeMs: Date.now(),
			size: 0,
			expanded: false,
		}
			const prev = get().itemsByProject[projectPath] || []
			set({
				itemsByProject: { ...get().itemsByProject, [projectPath]: [item, ...prev] },
				isLoading: false,
				expandedIds: new Set([...get().expandedIds, item.id]),
			})
			return item
		} catch (e: unknown) {
			set({ error: (e instanceof Error ? e.message : String(e)) || "收藏失败", isLoading: false })
			return null
		}
	},

	removeBookmark: async (filePath: string) => {
		try {
			await apiClient.call("bookmark.remove", { filePath })
		} catch {}
		const state = get()
		const next: Record<string, BookmarkItem[]> = {}
		for (const [path, items] of Object.entries(state.itemsByProject)) {
			next[path] = items.filter((i) => i.filePath !== filePath)
		}
		const newExpanded = new Set(state.expandedIds)
		newExpanded.delete(filePath)
		set({ itemsByProject: next, expandedIds: newExpanded })
	},

	toggleExpand: (id: string) => {
		const expanded = new Set(get().expandedIds)
		if (expanded.has(id)) expanded.delete(id)
		else expanded.add(id)
		set({ expandedIds: expanded })
	},

	setSearchQuery: (query: string) => set({ searchQuery: query }),
	clearError: () => set({ error: null }),
}))

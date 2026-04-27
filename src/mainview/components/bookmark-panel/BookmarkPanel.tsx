import { useEffect } from "react"
import {
	ChevronDown,
	Search,
	Star,
	Trash2,
} from "lucide-react"
import { useBookmarkStore, type BookmarkItem } from "../../stores/use-bookmark-store"
import { useSessionStore } from "../../stores/use-session-store"
import { useShallow } from "zustand/react/shallow"

function relativeTime(ms: number): string {
	const diff = Date.now() - ms
	const mins = Math.floor(diff / 60000)
	if (mins < 1) return "刚刚"
	if (mins < 60) return `${mins}分钟前`
	const hours = Math.floor(mins / 60)
	if (hours < 24) return `${hours}h前`
	const days = Math.floor(hours / 24)
	return `${days}d前`
}

export function BookmarkPanel() {
	const sessionId = useSessionStore((s) => s.activeSessionId)
	const projectTabs = useSessionStore((s) => s.projectTabs)
	const activeProjectId = useSessionStore((s) => s.activeProjectId)

	const items = useBookmarkStore(useShallow((s) => {
		const allItems: BookmarkItem[] = []
		for (const vals of Object.values(s.itemsByProject)) allItems.push(...vals)
		return allItems
	}))
	const expandedIds = useBookmarkStore((s) => s.expandedIds)
	const isLoading = useBookmarkStore((s) => s.isLoading)
	const searchQuery = useBookmarkStore((s) => s.searchQuery)
	const error = useBookmarkStore((s) => s.error)

	const loadBookmarks = useBookmarkStore((s) => s.loadBookmarks)
	const toggleExpand = useBookmarkStore((s) => s.toggleExpand)
	const removeBookmark = useBookmarkStore((s) => s.removeBookmark)

	useEffect(() => {
		if (!sessionId) return
		const tab = projectTabs.find((t) => t.id === activeProjectId)
		if (!tab) return
		loadBookmarks(tab.path)
	}, [sessionId, activeProjectId, projectTabs])

	if (!sessionId) {
		return (
			<div className="p-3 text-xs text-center text-gray-500">无活动会话</div>
		)
	}

	const filteredItems = searchQuery.trim()
		? items.filter(
			(item) =>
			item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
			item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
			item.tags.some((t: string) => t.toLowerCase().includes(searchQuery.toLowerCase())),
	  )
		: items

	if (error) {
		return (
			<div className="p-3 text-xs text-center text-red-400">{error}</div>
		)
	}

	if (isLoading) {
		return (
			<div className="p-3 text-xs text-center text-gray-500">加载中...</div>
		)
	}

	if (filteredItems.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
				<Star className="w-8 h-8 mb-3 text-gray-600" />
				<p className="text-sm text-gray-400">暂无收藏</p>
				<p className="mt-1 text-xs text-gray-600">hover 消息点击 ☆ 按钮添加收藏</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-800/50">
				<Search className="w-3.5 h-3.5 text-gray-500 shrink-0" />
				<input
					className="flex-1 bg-transparent border-none outline-none text-xs text-gray-300 placeholder:text-gray-600"
					placeholder="搜索收藏..."
					value={searchQuery}
					onChange={(e) => useBookmarkStore.getState().setSearchQuery(e.target.value)}
				/>
				{filteredItems.length > 0 && (
					<span className="text-[9px] text-gray-600 tabular-nums">{filteredItems.length}</span>
				)}
			</div>

			<div className="flex-1 overflow-y-auto px-2 pb-2">
				{filteredItems.map((item) => {
					const isExpanded = expandedIds.has(item.id)
					return (
						<div key={item.id} className="border-b border-gray-800/50 last:border-b-0">
							<button
								onClick={() => toggleExpand(item.id)}
								className="w-full flex items-center gap-1.5 py-2 px-2 text-[11px] font-medium text-gray-300 hover:bg-gray-800/30 transition-colors text-left border-none bg-none cursor-pointer"
							>
								<Star
									className={`w-3.5 h-3.5 shrink-0 ${isExpanded ? "text-amber-400 fill-amber-400" : "text-gray-500"}`}
									size={13}
								/>
								<span className="flex-1 text-left truncate">{item.title}</span>
								<span className="text-[9px] text-gray-600 shrink-0 ml-auto">
									{relativeTime(item.mtimeMs)}
								</span>
							<ChevronDown
									className={`w-3.5 h-3.5 shrink-0 text-gray-500 transition-transform ${isExpanded ? "rotate-0" : "-rotate-180"}`}
									size={12}
								/>
							</button>

						{isExpanded && (
							<div className="mx-2 mb-2">
								<div className="px-3 py-1.5 text-[10px] font-medium text-amber-400/80 flex items-center gap-1.5">
									<span>智能体 · build</span>
									<span>·</span>
									<span>{item.sourceSessionId.slice(0, 12)}</span>
								</div>
								{item.tags.length > 0 && (
									<div className="flex flex-wrap gap-1 px-3 pb-1">
										{item.tags.map((tag: string) => (
											<span key={tag} className="px-1.5 py-0.5 rounded bg-amber-400/10 text-[9px] text-amber-300 font-medium">
												{tag}
											</span>
										))}
									</div>
								)}
								<div className="px-3 pb-2">
									<pre className="text-[10px] text-gray-400 whitespace-pre-wrap break-words leading-relaxed font-mono max-h-40 overflow-y-auto">
										{item.summary || item.description}
									</pre>
								</div>
								<div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-800/30">
									<span className="text-[9px] text-gray-600">
										{item.sourcePreview ? `预览: ${item.sourcePreview.slice(0, 60)}...` : ""}
									</span>
									<button
										onClick={(e) => {
											e.stopPropagation()
											removeBookmark(item.filePath)
										}}
										className="p-1 hover:bg-red-500/10 rounded text-gray-500 hover:text-red-400 transition-colors"
										title="删除收藏"
									>
										<Trash2 size={11} />
								</button>
							</div>
						</div>
						)}
					</div>
					)
				})}
			</div>
		</div>
	)
}

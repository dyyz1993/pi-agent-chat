import { useState, useEffect, useCallback } from "react"
import {
	Brain,
	Search,
	Save,
	Sparkles,
	FileText,
	ChevronDown,
	ChevronRight,
} from "lucide-react"
import { useMemoryStore } from "../../stores/use-memory-store"
import { useSessionStore } from "../../stores/use-session-store"
import { useShallow } from "zustand/react/shallow"
import { apiClient } from "../../lib/api-client"

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

const TYPE_BADGES: Record<string, { label: string; cls: string }> = {
	project: { label: "项目", cls: "bg-emerald-400/15 text-emerald-400" },
	user: { label: "用户", cls: "bg-indigo-400/15 text-indigo-400" },
	feedback: { label: "反馈", cls: "bg-amber-400/15 text-amber-400" },
	reference: { label: "参考", cls: "bg-sky-400/15 text-sky-400" },
}

const EVENT_CONFIG: Record<string, { icon: typeof Brain; label: string; color: string }> = {
	memory_prefetch: { icon: Search, label: "搜索记忆", color: "text-blue-400" },
	memory_prefetch_result: { icon: Search, label: "记忆匹配", color: "text-blue-400" },
	memory_extract: { icon: Save, label: "保存记忆", color: "text-green-400" },
	memory_extract_result: { icon: Save, label: "提取结果", color: "text-green-400" },
	memory_dream: { icon: Sparkles, label: "整合记忆", color: "text-purple-400" },
	memory_dream_result: { icon: Sparkles, label: "整合结果", color: "text-purple-400" },
}

function SectionHeader({
	collapsed,
	onToggle,
	icon: Icon,
	iconCls,
	label,
	badge,
}: {
	collapsed: boolean
	onToggle: () => void
	icon: React.ElementType
	iconCls?: string
	label: string
	badge?: number
}) {
	return (
		<button
			onClick={onToggle}
			className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-300 hover:bg-gray-800/30 transition-colors"
		>
			{collapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
			<Icon className={`w-3 h-3 shrink-0 ${iconCls || ""}`} />
			<span>{label}</span>
			{badge != null && badge > 0 && (
				<span className="ml-auto text-[9px] text-gray-600">{badge}</span>
			)}
		</button>
	)
}

function FileContentPreview({ filePath }: { filePath: string }) {
	const [content, setContent] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		apiClient.call("memory.readFile", { filePath }).then((result) => {
			if (!cancelled) {
				setContent((result as { content: string }).content)
				setLoading(false)
			}
		}).catch(() => {
			if (!cancelled) setLoading(false)
		})
		return () => { cancelled = true }
	}, [filePath])

	if (loading) {
		return <div className="px-3 py-1.5 text-[10px] text-gray-600">加载中...</div>
	}
	if (!content) {
		return <div className="px-3 py-1.5 text-[10px] text-gray-600">无法读取</div>
	}
	return (
		<pre className="mx-2 mb-1.5 p-2 rounded bg-gray-900/80 border border-gray-800 text-[10px] text-gray-400 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
			{content.length > 2000 ? content.slice(0, 2000) + "..." : content}
		</pre>
	)
}

export function MemoryPanel() {
	const sessionId = useSessionStore((s) => s.activeSessionId)
	const projectTabs = useSessionStore((s) => s.projectTabs)
	const activeProjectId = useSessionStore((s) => s.activeProjectId)

	const events = useMemoryStore(useShallow((s) => s.eventsBySession[sessionId || ""] || []))
	const files = useMemoryStore(useShallow((s) => s.filesBySession[sessionId || ""] || []))
	const entrypoint = useMemoryStore((s) => sessionId ? s.entrypointBySession[sessionId] : null)
	const injected = useMemoryStore(useShallow((s) => sessionId ? (s.injectedBySession[sessionId] || []) : []))
	const expandedFile = useMemoryStore(
		useCallback((s) => sessionId ? (s.expandedFileBySession[sessionId] ?? null) : null, [sessionId])
	)
	const collapsedSections = useMemoryStore((s) => s.collapsedSections)
	const toggleSection = useMemoryStore((s) => s.toggleSection)
	const setExpandedFile = useMemoryStore((s) => s.setExpandedFile)

	const loadFiles = useMemoryStore((s) => s.loadFiles)

	useEffect(() => {
		if (!sessionId) return
		const tab = projectTabs.find((t) => t.id === activeProjectId)
		if (!tab) return
		loadFiles(tab.path, sessionId)
	}, [sessionId, activeProjectId, projectTabs])

	if (!sessionId) {
		return <div className="p-3 text-xs text-gray-500">无活动会话</div>
	}

	const hasInjected = injected.length > 0
	const hasFiles = files.length > 0
	const hasEntrypoint = !!entrypoint
	const hasEvents = events.length > 0

	if (!hasFiles && !hasEvents && !hasInjected && !hasEntrypoint) {
		return (
			<div className="p-3 text-xs text-gray-500 text-center">
				<Brain className="w-6 h-6 mx-auto mb-2 text-gray-600" />
				<p>暂无记忆</p>
				<p className="mt-1 text-gray-600">对话后将自动提取和管理记忆</p>
			</div>
		)
	}

	const last10Events = [...events].reverse().slice(0, 10)

	function getEventLabel(customType: string, data: unknown): string {
		if (customType === "memory_prefetch_result") {
			const d = data as { summary?: string } | undefined
			const summary = d?.summary || ""
			const match = summary.match(/(\d+)/)
			if (match) return `匹配 ${match[1]} 条记忆`
			return "记忆匹配"
		}
		const cfg = EVENT_CONFIG[customType]
		if (cfg) return cfg.label
		return customType
	}

	return (
		<div className="py-1">
			{hasInjected && (
				<div className="border-b border-gray-800/50">
					<SectionHeader
						collapsed={collapsedSections.has("injected")}
						onToggle={() => toggleSection("injected")}
						icon={Search}
						iconCls="text-blue-400"
						label="本次注入"
						badge={injected.length}
					/>
					{!collapsedSections.has("injected") && (
						<div className="px-2.5 pb-1.5 space-y-1">
							{injected.map((item, i) => (
								<div
									key={i}
									className="flex items-start gap-1.5 px-1.5 py-1 rounded bg-blue-400/5 border border-blue-400/10"
								>
									<span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
									<span className="text-[10px] text-blue-300/80 leading-tight">
										{item.summary}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{hasFiles && (
				<div className="border-b border-gray-800/50">
					<SectionHeader
						collapsed={collapsedSections.has("files")}
						onToggle={() => toggleSection("files")}
						icon={FileText}
						iconCls="text-gray-400"
						label="记忆文件"
						badge={files.length}
					/>
					{!collapsedSections.has("files") && (
						<div className="px-2.5 pb-1.5 space-y-0.5">
							{files.map((f) => {
								const badge = TYPE_BADGES[f.type || ""]
								const isExpanded = expandedFile === f.filePath
								return (
									<div key={f.filePath}>
										<button
											onClick={() => setExpandedFile(isExpanded ? null : f.filePath)}
											className="w-full flex items-center gap-1.5 py-1 px-1 rounded hover:bg-gray-800/40 transition-colors text-left"
										>
											{badge ? (
												<span className={`px-1 py-0 rounded text-[8px] font-medium shrink-0 ${badge.cls}`}>
													{badge.label}
												</span>
											) : (
												<span className="px-1 py-0 rounded text-[8px] font-medium shrink-0 bg-gray-400/15 text-gray-400">
													其他
												</span>
											)}
											<span className="text-[10px] text-gray-300 truncate flex-1">
												{f.description || f.filename}
											</span>
											<span className="text-[9px] text-gray-600 shrink-0">
												{relativeTime(f.mtimeMs)}
											</span>
										</button>
										{isExpanded && (
											<FileContentPreview filePath={f.filePath} />
										)}
									</div>
								)
							})}
						</div>
					)}
				</div>
			)}

			{hasEntrypoint && (
				<div className="border-b border-gray-800/50">
					<SectionHeader
						collapsed={collapsedSections.has("entrypoint")}
						onToggle={() => toggleSection("entrypoint")}
						icon={FileText}
						iconCls="text-yellow-400"
						label="MEMORY.md 索引"
					/>
					{!collapsedSections.has("entrypoint") && (
						<div className="px-2.5 pb-1.5">
							<pre className="p-2 rounded bg-gray-900/80 border border-gray-800 text-[10px] text-gray-400 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
								{(entrypoint || "").length > 2000 ? (entrypoint || "").slice(0, 2000) + "..." : entrypoint}
							</pre>
						</div>
					)}
				</div>
			)}

			{hasEvents && (
				<div className="border-b border-gray-800/50 last:border-b-0">
					<SectionHeader
						collapsed={collapsedSections.has("operations")}
						onToggle={() => toggleSection("operations")}
						icon={Brain}
						iconCls="text-gray-400"
						label="最近操作"
						badge={events.length}
					/>
					{!collapsedSections.has("operations") && (
						<div className="px-2.5 pb-1.5 space-y-0.5">
							{last10Events.map((event) => {
								const config = EVENT_CONFIG[event.customType] || {
									icon: Brain,
									label: event.customType,
									color: "text-gray-400",
								}
								const Icon = config.icon
								const label = getEventLabel(event.customType, event.data)
								const timeStr = new Date(event.timestamp).toLocaleTimeString("zh-CN", {
									hour: "2-digit",
									minute: "2-digit",
								})
								return (
									<div
										key={event.id}
										className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-gray-800/40 transition-colors"
									>
										<Icon className={`w-3 h-3 shrink-0 ${config.color}`} />
										<span className={`text-[10px] font-medium ${config.color}`}>
											{label}
										</span>
										<span className="ml-auto text-[9px] text-gray-600 shrink-0">
											{timeStr}
										</span>
									</div>
								)
							})}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

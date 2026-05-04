import { useState, useEffect } from "react"
import {
	Shield,
	ChevronDown,
	ChevronRight,
	Zap,
	Clock,
	AlertTriangle,
	Info,
	FileCode,
	CheckCircle2,
	XCircle,
	RefreshCw,
	FolderOpen,
	Loader2,
} from "lucide-react"
import { useRulesStore } from "../../stores/use-rules-store"
import { useSessionStore } from "../../stores/use-session-store"
import { useShallow } from "zustand/react/shallow"
import { apiClient } from "../../lib/api-client"
import type { RuleDetail, RuleSeverity, MatchRecord, LifecycleEntry } from "../../../shared/modules/rules"

const SEVERITY_CONFIG: Record<RuleSeverity, { label: string; cls: string; icon: typeof AlertTriangle }> = {
	critical: { label: "严重", cls: "text-red-400 bg-red-400/10", icon: AlertTriangle },
	high: { label: "高", cls: "text-orange-400 bg-orange-400/10", icon: AlertTriangle },
	medium: { label: "中", cls: "text-yellow-400 bg-yellow-400/10", icon: Info },
	low: { label: "低", cls: "text-blue-400 bg-blue-400/10", icon: Info },
	hint: { label: "提示", cls: "text-gray-400 bg-gray-400/10", icon: Info },
}

const SCOPE_LABELS: Record<string, string> = {
	user: "用户",
	pi: "PI",
	project: "项目",
	managed: "系统",
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
			<Icon className={`w-3 h-3 shrink-0 ${iconCls ?? ""}`} />
			<span>{label}</span>
			{badge != null && badge > 0 && (
				<span className="ml-auto text-[9px] text-gray-600">{badge}</span>
			)}
		</button>
	)
}

function useRuleContent(filePath: string | undefined, expanded: boolean) {
	const [content, setContent] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		if (!expanded || !filePath) {
			setContent(null)
			return
		}
		let cancelled = false
		setLoading(true)
		const baseUrl = apiClient.getBaseUrl()
		const token = apiClient.getAuthToken()
		fetch(`${baseUrl}/file/${encodeURIComponent(filePath)}?token=${token}`)
			.then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
			.then((text) => {
				if (!cancelled) {
					const stripped = text.replace(/^---\r?\n[\s\S]*?\n?---\r?\n?/, "")
					setContent(stripped)
					setLoading(false)
				}
			})
			.catch((err) => {
				console.warn("[RulesPanel] load failed:", err)
				if (!cancelled) {
					setContent(null)
					setLoading(false)
				}
			})
		return () => { cancelled = true }
	}, [filePath, expanded])

	return { content, loading }
}

function RuleCard({
	rule,
	isInjected,
	expanded,
	onTriggered,
	onToggle,
}: {
	rule: RuleDetail
	isInjected: boolean
	expanded: boolean
	onTriggered: boolean
	onToggle: () => void
}) {
	const sev = SEVERITY_CONFIG[rule.severity] || SEVERITY_CONFIG.medium
	const { content, loading } = useRuleContent(rule.filePath, expanded)

	return (
		<div className="border-b border-gray-800/50 last:border-b-0">
			<button
				onClick={onToggle}
				className="w-full text-left px-2.5 py-1.5 hover:bg-gray-800/20 transition-colors"
			>
				<div className="flex items-center gap-1.5">
					{isInjected ? (
						<CheckCircle2 className="w-2.5 h-2.5 text-green-400 shrink-0" />
					) : onTriggered ? (
						<Zap className="w-2.5 h-2.5 text-amber-400 shrink-0" />
					) : (
						<Clock className="w-2.5 h-2.5 text-gray-600 shrink-0" />
					)}
					<span className="text-[11px] text-gray-200 truncate flex-1">{rule.title}</span>
					<span className={`text-[9px] px-1 py-0.5 rounded ${sev.cls}`}>{sev.label}</span>
				</div>
				<div className="flex items-center gap-2 mt-0.5">
					<span className="text-[9px] text-gray-600">{rule.name}</span>
					<span className="text-[9px] text-gray-700">|</span>
					<span className="text-[9px] text-gray-600">{SCOPE_LABELS[rule.scope] || rule.scope}</span>
					{rule.isUnconditional ? (
						<span className="text-[9px] text-green-500/70">始终活跃</span>
					) : (
						<span className="text-[9px] text-gray-600 truncate">{rule.globs.join(", ")}</span>
					)}
				</div>
			</button>

			{expanded && (
				<div className="px-2.5 pb-2 pt-0.5 space-y-1">
					{rule.description && (
						<div className="text-[10px] text-gray-400">{rule.description}</div>
					)}
					{rule.source && (
						<div className="text-[10px] text-gray-600">
							来源: {rule.source}
						</div>
					)}
					{!rule.isUnconditional && rule.globs.length > 0 && (
						<div className="text-[10px] text-gray-600">
							匹配模式: <code className="text-[9px] text-indigo-400/70">{rule.globs.join(", ")}</code>
						</div>
					)}
					{loading && (
						<div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-gray-500">
							<Loader2 className="w-2.5 h-2.5 animate-spin" />
							<span>加载中...</span>
						</div>
					)}
					{!loading && content && (
						<div className="mt-1.5 p-2 bg-gray-800/50 rounded text-[10px] text-gray-300 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto font-mono">
							{content}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

function MatchRecordCard({ record }: { record: MatchRecord }) {
	const details = record.matchedRuleDetails ?? []
	return (
		<div className="px-2.5 py-1 text-[10px] space-y-0.5">
			<div className="flex items-center gap-1.5">
				<Zap className="w-2.5 h-2.5 text-amber-400 shrink-0" />
				<span className="text-gray-500">{new Date(record.timestamp).toLocaleTimeString()}</span>
				<span className="text-gray-700">|</span>
				<span className="text-gray-400 truncate">{record.filePath.split("/").pop()}</span>
				<span className="text-gray-700">&rarr;</span>
				<span className="text-gray-300 truncate">{record.toolName}</span>
			</div>
			{details.map((d) => (
				<div key={d.name} className="flex items-center gap-1 pl-5">
					<span className="text-gray-400 truncate">{d.title || d.name}</span>
					<code className="text-[9px] text-indigo-400/70 truncate">{d.matchedGlob}</code>
				</div>
			))}
		</div>
	)
}

function LifecycleEntryCard({ entry }: { entry: LifecycleEntry }) {
	const iconMap: Record<string, React.ElementType> = {
		loaded: RefreshCw,
		injected: CheckCircle2,
		reloaded: RefreshCw,
		unloaded: XCircle,
		expired: Clock,
	}
	const Icon = iconMap[entry.event] || Clock
	return (
		<div className="px-2.5 py-1 text-[10px]">
			<div className="flex items-center gap-1.5">
				<Icon className="w-2.5 h-2.5 text-gray-500 shrink-0" />
				<span className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
				<span className="text-gray-400">{entry.event}</span>
				{entry.ruleCount != null && (
					<span className="text-gray-600">({entry.ruleCount} rules)</span>
				)}
			</div>
			{entry.details?.scannedDirs && entry.details.scannedDirs.length > 0 && (
				<div className="pl-5 space-y-0.5">
					{entry.details.scannedDirs.map((d) => (
						<div key={d.dir} className="flex items-center gap-1 text-gray-600">
							<FolderOpen className="w-2 h-2 shrink-0" />
							<span className="truncate">{d.dir}</span>
							<span className="text-gray-700">({d.fileCount})</span>
							{d.ruleNames.length > 0 && (
								<span className="text-indigo-400/70 truncate">{d.ruleNames.join(", ")}</span>
							)}
						</div>
					))}
				</div>
			)}
			{entry.details?.configSource && (
				<div className="pl-5 text-gray-600 truncate">
					config: {entry.details.configSource}
				</div>
			)}
			{entry.details?.cacheHit != null && (
				<div className="pl-5 text-gray-600">
					cache: {entry.details.cacheHit ? "hit" : "miss"}
				</div>
			)}
		</div>
	)
}

export function RulesPanel() {
	const activeSessionId = useSessionStore((s) => s.activeSessionId)
	const collapsedSections = useRulesStore((s) => s.collapsedSections)
	const toggleSection = useRulesStore((s) => s.toggleSection)
	const expandedRule = useRulesStore(
		useShallow((s) => activeSessionId ? (s.expandedRuleBySession[activeSessionId] ?? null) : null),
	)
	const setExpandedRule = useRulesStore((s) => s.setExpandedRule)

	const session = useRulesStore(
		useShallow((s) => s.bySession[activeSessionId ?? ""] ?? null),
	)

	const rules = session?.rules || []
	const injectedRuleNames = session?.injectedRuleNames || []
	const matchHistory = session?.matchHistory || []
	const lifecycleLog = session?.lifecycleLog || []
	const totalRules = session?.totalRules || 0

	const unconditional = rules.filter((r) => r.isUnconditional)
	const conditional = rules.filter((r) => !r.isUnconditional)
	const showSource = !collapsedSections.has("source")
	const showUnconditional = !collapsedSections.has("unconditional")
	const showConditional = !collapsedSections.has("conditional")
	const showHistory = !collapsedSections.has("history")
	const showLifecycle = !collapsedSections.has("lifecycle")

	const triggeredNames = new Set(matchHistory.flatMap((h) => h.ruleNames))

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center gap-2 px-2.5 py-2 border-b border-gray-800 shrink-0">
				<Shield className="w-3.5 h-3.5 text-indigo-400" />
				<span className="text-[11px] font-medium text-gray-300">Rules Engine</span>
				<span className="text-[9px] text-gray-600 ml-auto">{totalRules} 条规则</span>
			</div>

			<div className="flex-1 overflow-y-auto">
				{rules.length === 0 ? (
					<div className="flex items-center justify-center py-8 text-gray-600 text-[11px]">
						暂无规则加载
					</div>
				) : (
					<>
						{lifecycleLog.length > 0 && (
							<>
								<SectionHeader
									collapsed={!showSource}
									onToggle={() => toggleSection("source")}
									icon={FolderOpen}
									iconCls="text-indigo-400"
									label="加载来源"
									badge={lifecycleLog.length}
								/>
								{showSource && lifecycleLog.slice(0, 10).map((entry, i) => (
									<LifecycleEntryCard key={`${entry.timestamp}-${i}`} entry={entry} />
								))}
							</>
						)}

						<SectionHeader
							collapsed={!showUnconditional}
							onToggle={() => toggleSection("unconditional")}
							icon={CheckCircle2}
							iconCls="text-green-400"
							label="始终活跃"
							badge={unconditional.length}
						/>
						{showUnconditional && unconditional.map((rule) => (
							<RuleCard
								key={rule.name}
								rule={rule}
								isInjected={injectedRuleNames.includes(rule.name)}
								onTriggered={triggeredNames.has(rule.name)}
								expanded={expandedRule === rule.name}
								onToggle={() => setExpandedRule(expandedRule === rule.name ? null : rule.name)}
							/>
						))}

						<SectionHeader
							collapsed={!showConditional}
							onToggle={() => toggleSection("conditional")}
							icon={FileCode}
							iconCls="text-amber-400"
							label="条件规则"
							badge={conditional.length}
						/>
						{showConditional && conditional.map((rule) => (
							<RuleCard
								key={rule.name}
								rule={rule}
								isInjected={injectedRuleNames.includes(rule.name)}
								onTriggered={triggeredNames.has(rule.name)}
								expanded={expandedRule === rule.name}
								onToggle={() => setExpandedRule(expandedRule === rule.name ? null : rule.name)}
							/>
						))}

						<SectionHeader
							collapsed={!showHistory}
							onToggle={() => toggleSection("history")}
							icon={Zap}
							iconCls="text-amber-400"
							label="触发历史"
							badge={matchHistory.length}
						/>
						{showHistory && matchHistory.length > 0 && (
							<div className="border-t border-gray-800/50">
								{matchHistory.slice(0, 30).map((record, i) => (
									<MatchRecordCard key={`${record.timestamp}-${i}`} record={record} />
								))}
							</div>
						)}
						{showHistory && matchHistory.length === 0 && (
							<div className="px-2.5 py-3 text-[10px] text-gray-600 text-center">
								暂无触发记录
							</div>
						)}

						{lifecycleLog.length > 0 && (
							<>
								<SectionHeader
									collapsed={!showLifecycle}
									onToggle={() => toggleSection("lifecycle")}
									icon={Clock}
									iconCls="text-gray-400"
									label="生命周期"
									badge={lifecycleLog.length}
								/>
								{showLifecycle && lifecycleLog.map((entry, i) => (
									<LifecycleEntryCard key={`lc-${entry.timestamp}-${i}`} entry={entry} />
								))}
							</>
						)}
					</>
				)}
			</div>
		</div>
	)
}

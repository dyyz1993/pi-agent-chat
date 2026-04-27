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
} from "lucide-react"
import { useRulesStore } from "../../stores/use-rules-store"
import { useSessionStore } from "../../stores/use-session-store"
import { useShallow } from "zustand/react/shallow"
import type { RuleSummary, RuleSeverity, RulesMatchRecord } from "../../../shared/modules/rules"

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
			<Icon className={`w-3 h-3 shrink-0 ${iconCls || ""}`} />
			<span>{label}</span>
			{badge != null && badge > 0 && (
				<span className="ml-auto text-[9px] text-gray-600">{badge}</span>
			)}
		</button>
	)
}

function RuleCard({
	rule,
	expanded,
	onToggle,
}: {
	rule: RuleSummary
	expanded: boolean
	onToggle: () => void
}) {
	const sev = SEVERITY_CONFIG[rule.severity] || SEVERITY_CONFIG.medium
	const statusIcon =
		rule.status === "active" ? <CheckCircle2 className="w-2.5 h-2.5 text-green-400 shrink-0" /> :
		rule.status === "unloaded" ? <XCircle className="w-2.5 h-2.5 text-gray-600 shrink-0" /> :
		<Clock className="w-2.5 h-2.5 text-gray-600 shrink-0" />

	return (
		<div className="border-b border-gray-800/50 last:border-b-0">
			<button
				onClick={onToggle}
				className="w-full text-left px-2.5 py-1.5 hover:bg-gray-800/20 transition-colors"
			>
				<div className="flex items-center gap-1.5">
					{statusIcon}
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
						<span className="text-[9px] text-gray-600 truncate">{rule.paths.join(", ")}</span>
					)}
				</div>
			</button>

			{expanded && (
				<div className="px-2.5 pb-2 pt-0.5 space-y-1">
					{rule.source && (
						<div className="text-[10px] text-gray-600">
							来源: {rule.source}
						</div>
					)}
					{!rule.isUnconditional && rule.paths.length > 0 && (
						<div className="text-[10px] text-gray-600">
							匹配模式: <code className="text-[9px] text-indigo-400/70">{rule.paths.join(", ")}</code>
						</div>
					)}
					{rule.severity && (
						<div className="text-[10px] text-gray-600">
							严重级别: <span className={sev.cls}>{rule.severity}</span>
						</div>
					)}
					{rule.content && (
						<div className="mt-1.5 p-2 bg-gray-800/50 rounded text-[10px] text-gray-300 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto font-mono">
							{rule.content}
						</div>
					)}
					{rule.loadedAt > 0 && (
						<div className="text-[10px] text-gray-600">
							加载时间: {new Date(rule.loadedAt).toLocaleTimeString()}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

function MatchRecord({ record }: { record: RulesMatchRecord }) {
	const sev = SEVERITY_CONFIG[record.severity] || SEVERITY_CONFIG.medium
	return (
		<div className="flex items-center gap-1.5 px-2.5 py-1 text-[10px]">
			<Zap className="w-2.5 h-2.5 text-amber-400 shrink-0" />
			<span className="text-gray-500">{new Date(record.timestamp).toLocaleTimeString()}</span>
			<span className="text-gray-700">|</span>
			<span className="text-gray-400 truncate">{record.filePath.split("/").pop()}</span>
			<span className="text-gray-700">→</span>
			<span className="text-gray-300 truncate">{record.ruleTitle}</span>
			<span className={`text-[8px] px-0.5 rounded ${sev.cls}`}>{sev.label}</span>
		</div>
	)
}

export function RulesPanel() {
	const activeSessionId = useSessionStore((s) => s.activeSessionId)
	const collapsedSections = useRulesStore((s) => s.collapsedSections)
	const toggleSection = useRulesStore((s) => s.toggleSection)
	const expandedRule = useRulesStore((s) => s.expandedRule)
	const setExpandedRule = useRulesStore((s) => s.setExpandedRule)

	const rules = useRulesStore(
		useShallow((s) => s.rulesBySession[activeSessionId || ""] || []),
	)
	const matchHistory = useRulesStore(
		useShallow((s) => s.matchHistoryBySession[activeSessionId || ""] || []),
	)

	const unconditional = rules.filter((r) => r.isUnconditional)
	const conditional = rules.filter((r) => !r.isUnconditional)
	const showUnconditional = !collapsedSections.has("unconditional")
	const showConditional = !collapsedSections.has("conditional")
	const showHistory = !collapsedSections.has("history")

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center gap-2 px-2.5 py-2 border-b border-gray-800 shrink-0">
				<Shield className="w-3.5 h-3.5 text-indigo-400" />
				<span className="text-[11px] font-medium text-gray-300">Rules Engine</span>
				<span className="text-[9px] text-gray-600 ml-auto">{rules.length} 条规则</span>
			</div>

			<div className="flex-1 overflow-y-auto">
				{rules.length === 0 ? (
					<div className="flex items-center justify-center py-8 text-gray-600 text-[11px]">
						暂无规则加载
					</div>
				) : (
					<>
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
									<MatchRecord key={`${record.timestamp}-${i}`} record={record} />
								))}
							</div>
						)}
						{showHistory && matchHistory.length === 0 && (
							<div className="px-2.5 py-3 text-[10px] text-gray-600 text-center">
								暂无触发记录
							</div>
						)}
					</>
				)}
			</div>
		</div>
	)
}

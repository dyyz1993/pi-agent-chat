import { create } from "zustand"
import type { RuleSummary, RulesMatchRecord, RulesChannelEvent } from "../../shared/modules/rules"

interface RulesState {
	rulesBySession: Record<string, RuleSummary[]>
	matchHistoryBySession: Record<string, RulesMatchRecord[]>
	cacheTTLBySession: Record<string, number>
	loadedAtBySession: Record<string, number>
	expandedRule: string | null
	collapsedSections: Set<string>

	handleRulesEvent: (sessionId: string, event: RulesChannelEvent) => void
	setExpandedRule: (name: string | null) => void
	toggleSection: (section: string) => void
	clearSession: (sessionId: string) => void
}

const DEFAULT_COLLAPSED = new Set(["history"])

export const useRulesStore = create<RulesState>()((set) => ({
	rulesBySession: {},
	matchHistoryBySession: {},
	cacheTTLBySession: {},
	loadedAtBySession: {},
	expandedRule: null,
	collapsedSections: DEFAULT_COLLAPSED,

	handleRulesEvent: (sessionId, event) => {
		switch (event.type) {
			case "rules.loaded":
			case "rules.reload":
				set((s) => ({
					rulesBySession: { ...s.rulesBySession, [sessionId]: event.rules },
					cacheTTLBySession: { ...s.cacheTTLBySession, [sessionId]: event.cacheTTL },
					loadedAtBySession: { ...s.loadedAtBySession, [sessionId]: event.loadedAt },
				}))
				break
			case "rules.matched": {
				const records: RulesMatchRecord[] = event.matchedRules.map((r) => ({
					filePath: event.filePath,
					ruleName: r.name,
					ruleTitle: r.title,
					severity: r.severity,
					timestamp: Date.now(),
				}))
				set((s) => {
					const existing = s.matchHistoryBySession[sessionId] || []
					return {
						matchHistoryBySession: {
							...s.matchHistoryBySession,
							[sessionId]: [...records, ...existing].slice(0, 100),
						},
						rulesBySession: {
							...s.rulesBySession,
							[sessionId]: (s.rulesBySession[sessionId] || []).map((rule) => {
								const wasMatched = event.matchedRules.some((mr) => mr.name === rule.name)
								return wasMatched ? { ...rule, status: "active" as const } : rule
							}),
						},
					}
				})
				break
			}
			case "rules.injected":
				break
			case "rules.compacted":
				break
			case "rules.unloaded":
				set((s) => ({
					rulesBySession: { ...s.rulesBySession, [sessionId]: (s.rulesBySession[sessionId] || []).map((r) => ({ ...r, status: "unloaded" as const })) },
				}))
				break
		}
	},

	setExpandedRule: (name) => set({ expandedRule: name }),

	toggleSection: (section) =>
		set((s) => {
			const next = new Set(s.collapsedSections)
			if (next.has(section)) next.delete(section)
			else next.add(section)
			return { collapsedSections: next }
		}),

	clearSession: (sessionId) =>
		set((s) => {
			const { [sessionId]: _r, ...restRules } = s.rulesBySession
			const { [sessionId]: _m, ...restMatches } = s.matchHistoryBySession
			const { [sessionId]: _c, ...restCache } = s.cacheTTLBySession
			const { [sessionId]: _l, ...restLoaded } = s.loadedAtBySession
			return {
				rulesBySession: restRules,
				matchHistoryBySession: restMatches,
				cacheTTLBySession: restCache,
				loadedAtBySession: restLoaded,
			}
		}),
}))

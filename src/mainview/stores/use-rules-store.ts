import { create } from "zustand"
import type { RuleDetail, MatchRecord, LifecycleEntry, RulesChannelEvent } from "../../shared/modules/rules"
import { useSessionStore } from "./use-session-store"

interface RulesSessionState {
	rules: RuleDetail[]
	injectedRuleNames: string[]
	matchHistory: MatchRecord[]
	lifecycleLog: LifecycleEntry[]
	totalRules: number
	unconditionalCount: number
	conditionalCount: number
	loadedAt: number
	cacheTTL: number
}

interface RulesState {
	bySession: Record<string, RulesSessionState>
	expandedRuleBySession: Record<string, string | null>
	collapsedSections: Set<string>

	handleRulesEvent: (sessionId: string, event: RulesChannelEvent) => void
	setExpandedRule: (name: string | null) => void
	toggleSection: (section: string) => void
	clearSession: (sessionId: string) => void
}

const DEFAULT_COLLAPSED = new Set(["history", "lifecycle"])
const EMPTY_SESSION: RulesSessionState = {
	rules: [],
	injectedRuleNames: [],
	matchHistory: [],
	lifecycleLog: [],
	totalRules: 0,
	unconditionalCount: 0,
	conditionalCount: 0,
	loadedAt: 0,
	cacheTTL: 0,
}

export const useRulesStore = create<RulesState>()((set) => ({
	bySession: {},
	expandedRuleBySession: {},
	collapsedSections: DEFAULT_COLLAPSED,

	handleRulesEvent: (sessionId, event) => {
		switch (event.type) {
			case "snapshot":
				set((s) => {
					const prev = s.bySession[sessionId] || { ...EMPTY_SESSION }
					const incomingHistory = event.matchHistory || []
					const mergedHistory = incomingHistory.length > 0
						? incomingHistory
						: prev.matchHistory
					return {
						bySession: {
							...s.bySession,
							[sessionId]: {
								rules: event.rules,
								injectedRuleNames: event.injectedRuleNames,
								matchHistory: mergedHistory,
								lifecycleLog: event.lifecycleLog.length > 0 ? event.lifecycleLog : prev.lifecycleLog,
								totalRules: event.totalRules,
								unconditionalCount: event.unconditionalCount,
								conditionalCount: event.conditionalCount,
								loadedAt: event.loadedAt,
								cacheTTL: event.cacheTTL,
							},
						},
					}
				})
				break
			case "matched":
				set((s) => {
					const prev = s.bySession[sessionId] || { ...EMPTY_SESSION }
					const record: MatchRecord = {
						filePath: event.filePath,
						ruleNames: event.matchedRules.map((r) => r.name),
						toolName: event.toolName,
						toolCallId: event.toolCallId,
						severity: event.severity,
						timestamp: event.timestamp,
						matchedRuleDetails: event.matchedRules,
					}
					return {
						bySession: {
							...s.bySession,
							[sessionId]: {
								...prev,
								matchHistory: [record, ...prev.matchHistory].slice(0, 100),
							},
						},
					}
				})
				break
			case "injected":
				set((s) => {
					const prev = s.bySession[sessionId] || { ...EMPTY_SESSION }
					return {
						bySession: {
							...s.bySession,
							[sessionId]: {
								...prev,
								injectedRuleNames: event.ruleNames,
							},
						},
					}
				})
				break
			case "reloaded":
				set((s) => {
					const prev = s.bySession[sessionId] || { ...EMPTY_SESSION }
					return {
						bySession: {
							...s.bySession,
							[sessionId]: {
								...prev,
								rules: event.rules,
								loadedAt: event.loadedAt,
							},
						},
					}
				})
				break
			case "unloaded":
				set((s) => {
					const prev = s.bySession[sessionId] || { ...EMPTY_SESSION }
					return {
						bySession: {
							...s.bySession,
							[sessionId]: {
								...EMPTY_SESSION,
								matchHistory: prev.matchHistory,
								lifecycleLog: prev.lifecycleLog,
							},
						},
					}
				})
				break
		}
	},

	setExpandedRule: (name) => {
		const sessionId = useSessionStore.getState().activeSessionId
		if (!sessionId) return
		set((s) => ({
			expandedRuleBySession: { ...s.expandedRuleBySession, [sessionId]: name },
		}))
	},

	toggleSection: (section) =>
		set((s) => {
			const next = new Set(s.collapsedSections)
			if (next.has(section)) next.delete(section)
			else next.add(section)
			return { collapsedSections: next }
		}),

	clearSession: (sessionId) =>
		set((s) => {
			const { [sessionId]: _, ...rest } = s.bySession
			return { bySession: rest }
		}),
}))

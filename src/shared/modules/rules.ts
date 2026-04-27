export type RuleSeverity = "critical" | "high" | "medium" | "low" | "hint";
export type RuleScope = "user" | "pi" | "project" | "managed";
export type RuleStatus = "active" | "expired" | "pending" | "unloaded";

export interface RuleSummary {
	name: string;
	title: string;
	scope: RuleScope;
	source: string;
	severity: RuleSeverity;
	isUnconditional: boolean;
	paths: string[];
	content: string;
	loadedAt: number;
	expiresAt: number;
	status: RuleStatus;
}

export interface RulesMatchRecord {
	filePath: string;
	ruleName: string;
	ruleTitle: string;
	severity: RuleSeverity;
	timestamp: number;
}

export type RulesChannelEvent =
	| { type: "rules.loaded"; totalRules: number; unconditional: number; conditional: number; rules: RuleSummary[]; loadedAt: number; cacheTTL: number }
	| { type: "rules.injected"; injectedCount: number; systemPromptDelta: number; ruleNames: string[] }
	| { type: "rules.matched"; filePath: string; matchedRules: RuleSummary[]; severity: "info" | "warning" }
	| { type: "rules.compacted"; reInjectedCount: number; ruleNames: string[] }
	| { type: "rules.unloaded"; reason: string }
	| { type: "rules.reload"; totalRules: number; unconditional: number; conditional: number; rules: RuleSummary[]; loadedAt: number; cacheTTL: number };

export interface RulesMethods {
	"rules.list": {
		params: { sessionId: string };
		result: { rules: RuleSummary[]; totalRules: number };
	};
}

export interface RulesEvents {
	"rules.event": RulesEventPayload;
}

export interface RulesEventPayload {
	sessionId: string;
	event: RulesChannelEvent;
}

export type RuleSeverity = "critical" | "high" | "medium" | "low" | "hint";

export type RulesChannelEvent =
  | {
      type: "snapshot";
      rules: RuleDetail[];
      injectedRuleNames: string[];
      totalRules: number;
      unconditionalCount: number;
      conditionalCount: number;
      matchHistory: MatchRecord[];
      lifecycleLog: LifecycleEntry[];
      loadedAt: number;
      cacheTTL: number;
    }
  | {
      type: "matched";
      filePath: string;
      matchedRules: MatchedRuleDetail[];
      toolName: string;
      toolCallId: string;
      severity: "info" | "warning";
      timestamp: number;
    }
  | { type: "injected"; ruleNames: string[]; systemPromptLength: number }
  | { type: "reloaded"; rules: RuleDetail[]; loadedAt: number }
  | { type: "unloaded"; reason: string };

export interface RuleDetail {
  name: string;
  title: string;
  filePath: string;
  scope: "user" | "pi" | "project" | "managed";
  source: string;
  severity: RuleSeverity;
  isUnconditional: boolean;
  globs: string[];
  description?: string;
}

export interface MatchedRuleDetail {
  name: string;
  title: string;
  severity: RuleSeverity;
  matchedGlob: string;
}

export interface MatchRecord {
  filePath: string;
  ruleNames: string[];
  toolName: string;
  toolCallId: string;
  severity: "info" | "warning";
  timestamp: number;
  matchedRuleDetails?: MatchedRuleDetail[];
}

export interface LifecycleEntry {
  event: "loaded" | "injected" | "reloaded" | "unloaded" | "expired";
  message: string;
  ruleCount?: number;
  timestamp: number;
  details?: {
    scannedDirs?: Array<{ dir: string; fileCount: number; ruleNames: string[] }>;
    configSource?: string;
    cacheHit?: boolean;
    injectedRules?: Array<{ name: string; promptDelta: number }>;
  };
}

export interface RulesMethods {
  "rules.list": {
    params: { sessionId: string };
    result: { rules: RuleDetail[]; totalRules: number };
  };
  "rules.requestSnapshot": {
    params: { sessionId: string };
    result: {
      rules: RuleDetail[];
      totalRules: number;
      unconditionalCount: number;
      conditionalCount: number;
    };
  };
}

export interface RulesEvents {
  "rules.event": RulesEventPayload;
}

export interface RulesEventPayload {
  sessionId: string;
  event: RulesChannelEvent;
}

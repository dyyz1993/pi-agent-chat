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
      status?: RuleMatchStatus;
      /** @deprecated Use status instead */
      alreadyLoaded?: boolean;
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

export type RuleMatchStatus = "loaded" | "already_loaded" | "reloaded";

export interface MatchedRuleDetail {
  name: string;
  title: string;
  severity: RuleSeverity;
  matchedGlob: string;
  /**
   * Match status:
   * - "loaded": first time injected for this file
   * - "already_loaded": previously injected and still in context (skipped)
   * - "reloaded": previously injected but was invalidated (context removed), now re-injected
   */
  status?: RuleMatchStatus;
  /** @deprecated Use status instead */
  alreadyLoaded?: boolean;
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

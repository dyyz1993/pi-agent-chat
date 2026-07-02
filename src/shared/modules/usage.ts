export type UsageRangePreset = "7d" | "14d" | "30d" | "year" | "all";
export type UsageScope = "global" | "project";
export type UsageLoadMode = "cache" | "refresh";

export interface UsageRange {
  preset: UsageRangePreset;
  startAt: number | null;
  endAt: number;
  label: string;
}

export interface UsageDailyBucket {
  date: string;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  sessions: number;
  messages: number;
  toolCalls: number;
  mcpCalls: number;
  memoryWrites: number;
  memoryHits: number;
  skillHits: number;
  hookBlocks: number;
  models: UsageDailyModelToken[];
}

export interface UsageDailyModelToken {
  provider: string | null;
  model: string;
  tokens: number;
  calls: number;
}

export interface UsageTopModel {
  provider: string | null;
  model: string;
  tokens: number;
  calls: number;
}

export interface UsageTopMcpTool {
  server: string;
  tool: string;
  calls: number;
  errors: number;
}

export interface UsageTopSkill {
  name: string;
  calls: number;
  patchCount: number;
}

export interface UsageToolDistributionItem {
  name: string;
  category: "read" | "edit" | "write" | "bash" | "search" | "mcp" | "other";
  calls: number;
  share: number;
}

export interface UsageTopContextReference {
  ref: string;
  count: number;
  tokens: number;
}

export interface UsageInefficientPattern {
  type: "read_edit_churn" | "repeated_read";
  sessionId: string;
  count: number;
  sequence: string[];
  suggestion: string;
}

export interface UsageObservabilityStats {
  contextSamples: number;
  maxContextTokens: number;
  avgContextTokens: number;
  maxContextPercent: number | null;
  contextRefTotal: number;
  contextRefDuplicateCount: number;
  contextRefDuplicateRatio: number;
  topDuplicateContextRefs: UsageTopContextReference[];
  toolCalls: number;
  toolDistribution: UsageToolDistributionItem[];
  inefficientPatterns: UsageInefficientPattern[];
}

export interface UsageTotals {
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  sessions: number;
  messages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  mcpCalls: number;
  memoryWrites: number;
  memoryFailures: number;
  memoryHits: number;
  skillHits: number;
  hookBlocks: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  longestTaskMs: number;
  peakDayTokens: number;
}

export interface UsageDataQuality {
  scannedSessionFiles: number;
  parsedEntries: number;
  skippedEntries: number;
  estimatedFields: string[];
  lastCacheWriteAt: number | null;
  cacheStatus?: "hit" | "miss" | "refresh";
  indexUpdatedAt?: number | null;
  indexReadAt?: number | null;
}

export interface UsageShareStats {
  scope: UsageScope;
  projectPath: string;
  generatedAt: number;
  range: UsageRange;
  totals: UsageTotals;
  daily: UsageDailyBucket[];
  topModels: UsageTopModel[];
  topMcpTools: UsageTopMcpTool[];
  topSkills: UsageTopSkill[];
  observability: UsageObservabilityStats;
  dataQuality: UsageDataQuality;
}

export interface UsageMethods {
  "usage.getShareStats": {
    params: {
      scope?: UsageScope;
      projectPath?: string;
      range?: UsageRangePreset;
      mode?: UsageLoadMode;
    };
    result: UsageShareStats | null;
  };
}

import type {
  UsageDailyBucket,
  UsageDailyModelToken,
  UsageDataQuality,
  UsageInefficientPattern,
  UsageObservabilityStats,
  UsageRange,
  UsageRangePreset,
  UsageScope,
  UsageShareStats,
  UsageToolDistributionItem,
  UsageTopContextReference,
  UsageTopMcpTool,
  UsageTopModel,
  UsageTopSkill,
  UsageTotals,
} from "../modules/usage";

export interface UsageSourceEntry {
  sessionId: string;
  value: unknown;
}

export interface UsageFact {
  sessionId: string;
  timestamp: number;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
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
  model: UsageDailyModelToken | null;
  mcpTools: UsageTopMcpTool[];
  skills: UsageTopSkill[];
  observability: UsageObservabilityFact | null;
}

export interface UsageObservabilityToolEvent {
  sessionId: string;
  timestamp: number;
  name: string;
  category: UsageToolDistributionItem["category"];
  ref: string | null;
}

export interface UsageObservabilityContextRef {
  ref: string;
  tokens: number;
}

export interface UsageObservabilityFact {
  contextTokens: number;
  contextWindow: number;
  contextPercent: number | null;
  contextRefs: UsageObservabilityContextRef[];
  toolEvents: UsageObservabilityToolEvent[];
}

export interface UsageObservabilityRollup {
  contextSamples: number;
  contextTokenTotal: number;
  maxContextTokens: number;
  maxContextPercent: number | null;
  contextRefs: UsageObservabilityContextRef[];
  toolEvents: UsageObservabilityToolEvent[];
}

export interface UsageDailyRollup {
  sessionId: string;
  date: string;
  firstTimestamp: number;
  lastTimestamp: number;
  timestamps: number[];
  bucket: UsageDailyBucket;
  userMessages: number;
  assistantMessages: number;
  memoryFailures: number;
  mcpTools: UsageTopMcpTool[];
  skills: UsageTopSkill[];
  observability: UsageObservabilityRollup;
}

export interface AggregateOptions {
  scope?: UsageScope;
  projectPath?: string;
  range?: UsageRangePreset;
  now?: number;
  scannedSessionFiles?: number;
  skippedEntries?: number;
  lastCacheWriteAt?: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_BURST_GAP_MS = 2 * 60 * 60 * 1000;

const MEMORY_WRITE_TYPES = new Set([
  "memory_created",
  "memory_updated",
  "memory_update",
  "memory_extract_result",
]);

const MEMORY_FAILURE_TYPES = new Set(["memory_failed", "memory_update_failed"]);

const MEMORY_HIT_TYPES = new Set(["memory_prefetch_result", "memory_inject"]);

const HOOK_BLOCK_TYPES = new Set(["hook_block", "hook_stop_block", "hooks_blocked"]);
const CONTEXT_REF_CUSTOM_TYPES = new Set([
  "context_usage",
  "memory_prefetch_result",
  "memory_inject",
]);

function emptyObservabilityFact(): UsageObservabilityFact {
  return {
    contextTokens: 0,
    contextWindow: 0,
    contextPercent: null,
    contextRefs: [],
    toolEvents: [],
  };
}

function emptyObservabilityRollup(): UsageObservabilityRollup {
  return {
    contextSamples: 0,
    contextTokenTotal: 0,
    maxContextTokens: 0,
    maxContextPercent: null,
    contextRefs: [],
    toolEvents: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function localDateKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function rangeLabel(range: UsageRangePreset): string {
  if (range === "7d") return "最近 7 天";
  if (range === "14d") return "最近 14 天";
  if (range === "30d") return "最近 30 天";
  if (range === "year") return "最近一年";
  return "全部";
}

function resolveRange(range: UsageRangePreset, now: number, earliest: number | null): UsageRange {
  const todayStart = startOfLocalDay(now);
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "30d" ? 30 : 365;
  const startAt =
    range === "all"
      ? earliest === null
        ? null
        : startOfLocalDay(earliest)
      : todayStart - (days - 1) * DAY_MS;
  return {
    preset: range,
    startAt,
    endAt: now,
    label: rangeLabel(range),
  };
}

function getEntryTimestamp(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const direct = readTimestamp(value.timestamp);
  if (direct !== null) return direct;
  const message = isRecord(value.message) ? value.message : null;
  return message ? readTimestamp(message.timestamp) : null;
}

function getMessage(value: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(value.message)) return value.message;
  return null;
}

function contentBlocks(message: Record<string, unknown>): unknown[] {
  const content = message.content;
  if (Array.isArray(content)) return content;
  return [];
}

function extractUsage(message: Record<string, unknown>): UsageDailyBucket {
  const usage = isRecord(message.usage) ? message.usage : {};
  const input = readNumber(usage.input ?? usage.inputTokens);
  const output = readNumber(usage.output ?? usage.outputTokens);
  const cacheRead = readNumber(usage.cacheRead ?? usage.cacheReadTokens);
  const cacheWrite = readNumber(usage.cacheWrite ?? usage.cacheWriteTokens);
  const costObject = isRecord(usage.cost) ? usage.cost : null;
  const cost = readNumber(costObject?.total ?? usage.cost);
  return emptyBucket("", {
    input,
    output,
    cacheRead,
    cacheWrite,
    cost,
    tokens: input + output + cacheRead + cacheWrite,
  });
}

function emptyBucket(date: string, patch?: Partial<UsageDailyBucket>): UsageDailyBucket {
  return {
    date,
    tokens: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    sessions: 0,
    messages: 0,
    toolCalls: 0,
    mcpCalls: 0,
    memoryWrites: 0,
    memoryHits: 0,
    skillHits: 0,
    hookBlocks: 0,
    models: [],
    ...patch,
  };
}

function addBucket(target: UsageDailyBucket, source: Partial<UsageDailyBucket>): void {
  target.tokens += source.tokens ?? 0;
  target.input += source.input ?? 0;
  target.output += source.output ?? 0;
  target.cacheRead += source.cacheRead ?? 0;
  target.cacheWrite += source.cacheWrite ?? 0;
  target.cost += source.cost ?? 0;
  target.sessions += source.sessions ?? 0;
  target.messages += source.messages ?? 0;
  target.toolCalls += source.toolCalls ?? 0;
  target.mcpCalls += source.mcpCalls ?? 0;
  target.memoryWrites += source.memoryWrites ?? 0;
  target.memoryHits += source.memoryHits ?? 0;
  target.skillHits += source.skillHits ?? 0;
  target.hookBlocks += source.hookBlocks ?? 0;
}

function addDailyModelToken(bucket: UsageDailyBucket, patch: UsageDailyModelToken): void {
  const existing = bucket.models.find(
    (item) => item.provider === patch.provider && item.model === patch.model,
  );
  if (existing) {
    existing.tokens += patch.tokens;
    existing.calls += patch.calls;
    return;
  }
  bucket.models.push({ ...patch });
}

function topValues<T>(map: Map<string, T>, sortValue: (value: T) => number, limit: number): T[] {
  return Array.from(map.values())
    .sort((a, b) => sortValue(b) - sortValue(a))
    .slice(0, limit);
}

function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const [, server, ...toolParts] = name.split("__");
  if (!server || toolParts.length === 0) return null;
  return { server, tool: toolParts.join("__") };
}

function normalizeToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function toolCategory(name: string): UsageToolDistributionItem["category"] {
  const normalized = normalizeToolName(name);
  if (normalized.startsWith("mcp__")) return "mcp";
  if (normalized === "read" || normalized === "file_read" || normalized === "read_file")
    return "read";
  if (
    normalized === "edit" ||
    normalized === "file_edit" ||
    normalized === "write_file" ||
    normalized === "multiedit" ||
    normalized === "multi_edit" ||
    normalized === "patch"
  )
    return normalized.includes("write") ? "write" : "edit";
  if (normalized === "write" || normalized === "file_write") return "write";
  if (normalized === "bash" || normalized === "shell") return "bash";
  if (
    normalized === "grep" ||
    normalized === "glob" ||
    normalized === "find" ||
    normalized === "ls"
  )
    return "search";
  return "other";
}

function toolNameFromBlock(block: unknown): string | null {
  if (!isRecord(block)) return null;
  if (typeof block.name === "string") return block.name;
  if (typeof block.toolName === "string") return block.toolName;
  if (isRecord(block.toolCall) && typeof block.toolCall.name === "string")
    return block.toolCall.name;
  return null;
}

function isToolCallBlock(block: unknown): boolean {
  if (!isRecord(block)) return false;
  const type = typeof block.type === "string" ? block.type : "";
  return (
    type === "toolCall" ||
    type === "tool_call" ||
    type === "toolExecution" ||
    type === "tool_execution" ||
    Boolean(block.toolCall)
  );
}

function readToolArgs(block: unknown): unknown {
  if (!isRecord(block)) return null;
  if (block.args !== undefined) return block.args;
  if (block.input !== undefined) return block.input;
  if (isRecord(block.toolCall) && block.toolCall.input !== undefined) return block.toolCall.input;
  return null;
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readPathLike(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pathRefFromArgs(args: unknown): string | null {
  if (isRecord(args)) {
    return (
      readPathLike(args.path) ??
      readPathLike(args.filePath) ??
      readPathLike(args.file) ??
      readPathLike(args.glob) ??
      readPathLike(args.pattern) ??
      null
    );
  }
  if (typeof args !== "string") return null;
  const parsed = tryParseJsonObject(args);
  if (parsed) return pathRefFromArgs(parsed);
  const quotedPath = args.match(/["']((?:\/|~\/|\.\.?\/)[^"']+)["']/)?.[1];
  if (quotedPath) return quotedPath;
  const barePath = args.match(/\b((?:\/|~\/|\.\.?\/)[^\s,;]+)/)?.[1];
  return barePath ?? null;
}

function pushContextRef(target: UsageObservabilityContextRef[], ref: unknown, tokens = 0): void {
  const normalized = typeof ref === "string" ? ref.trim() : "";
  if (!normalized) return;
  target.push({ ref: normalized, tokens: Math.max(0, readNumber(tokens)) });
}

function contextRefsFromData(data: unknown): UsageObservabilityContextRef[] {
  const refs: UsageObservabilityContextRef[] = [];
  if (!isRecord(data)) return refs;

  const selectedFiles = data.selectedFiles;
  if (Array.isArray(selectedFiles)) {
    for (const file of selectedFiles) pushContextRef(refs, file);
  }

  const files = data.files;
  if (Array.isArray(files)) {
    for (const file of files) {
      if (typeof file === "string") {
        pushContextRef(refs, file);
      } else if (isRecord(file)) {
        pushContextRef(refs, file.path ?? file.file ?? file.name, readNumber(file.tokens));
      }
    }
  }

  const breakdown = data.breakdown;
  if (Array.isArray(breakdown)) {
    for (const item of breakdown) {
      if (!isRecord(item)) continue;
      const details = item.details;
      if (!Array.isArray(details)) continue;
      for (const detail of details) {
        if (!isRecord(detail)) continue;
        pushContextRef(refs, detail.label, readNumber(detail.tokens));
      }
    }
  }

  return refs;
}

function contextUsageFromData(
  data: unknown,
): Pick<
  UsageObservabilityFact,
  "contextTokens" | "contextWindow" | "contextPercent" | "contextRefs"
> {
  if (!isRecord(data)) {
    return { contextTokens: 0, contextWindow: 0, contextPercent: null, contextRefs: [] };
  }
  const tokens = readNumber(data.tokens);
  const contextWindow = readNumber(data.contextWindow);
  const percent = readNumber(data.percent);
  return {
    contextTokens: tokens,
    contextWindow,
    contextPercent:
      percent > 1 && percent <= 100
        ? percent
        : contextWindow > 0 && tokens > 0
          ? tokens / contextWindow
          : null,
    contextRefs: contextRefsFromData(data),
  };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (typeof block.text === "string") return block.text;
      if (typeof block.content === "string") return block.content;
      return "";
    })
    .join("\n");
}

function collectSkillNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /<skill\b[^>]*(?:name|id)=["']([^"']+)["'][^>]*>/gi,
    /<system-reminder\b[^>]*>\s*[\s\S]*?\bskill\s+([a-zA-Z0-9:_./-]+)/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const name = match[1]?.trim();
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}

function updateStreaks(dayKeys: string[], now: number): { current: number; longest: number } {
  if (dayKeys.length === 0) return { current: 0, longest: 0 };
  const days = [...new Set(dayKeys)].sort();
  let longest = 1;
  let currentRun = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = Date.parse(`${days[i - 1]}T00:00:00`);
    const cur = Date.parse(`${days[i]}T00:00:00`);
    if (cur - prev === DAY_MS) {
      currentRun += 1;
    } else {
      currentRun = 1;
    }
    longest = Math.max(longest, currentRun);
  }

  let current = 0;
  let cursor = startOfLocalDay(now);
  const daySet = new Set(days);
  while (daySet.has(localDateKey(cursor))) {
    current += 1;
    cursor -= DAY_MS;
  }
  return { current, longest };
}

function makeTotals(): UsageTotals {
  return {
    tokens: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    sessions: 0,
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    mcpCalls: 0,
    memoryWrites: 0,
    memoryFailures: 0,
    memoryHits: 0,
    skillHits: 0,
    hookBlocks: 0,
    activeDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    longestTaskMs: 0,
    peakDayTokens: 0,
  };
}

function inRange(timestamp: number, range: UsageRange): boolean {
  return (range.startAt === null || timestamp >= range.startAt) && timestamp <= range.endAt;
}

function readCustomType(value: Record<string, unknown>): string | null {
  const customType = typeof value.customType === "string" ? value.customType : null;
  if (customType) return customType;
  const data = isRecord(value.data) ? value.data : null;
  return typeof data?.type === "string" ? data.type : null;
}

function countSelectedFiles(data: unknown): number {
  if (!isRecord(data)) return 0;
  const selectedFiles = data.selectedFiles;
  return Array.isArray(selectedFiles) ? selectedFiles.length : 0;
}

function patchSkillMap(
  topSkills: Map<string, UsageTopSkill>,
  name: string,
  patch: Partial<UsageTopSkill>,
): void {
  const existing = topSkills.get(name) ?? { name, calls: 0, patchCount: 0 };
  topSkills.set(name, {
    ...existing,
    calls: existing.calls + (patch.calls ?? 0),
    patchCount: existing.patchCount + (patch.patchCount ?? 0),
  });
}

function patchMcpList(items: UsageTopMcpTool[], patch: UsageTopMcpTool): void {
  const existing = items.find((item) => item.server === patch.server && item.tool === patch.tool);
  if (existing) {
    existing.calls += patch.calls;
    existing.errors += patch.errors;
    return;
  }
  items.push({ ...patch });
}

function patchSkillList(items: UsageTopSkill[], patch: UsageTopSkill): void {
  const existing = items.find((item) => item.name === patch.name);
  if (existing) {
    existing.calls += patch.calls;
    existing.patchCount += patch.patchCount;
    return;
  }
  items.push({ ...patch });
}

function addObservabilityFactToRollup(
  rollup: UsageObservabilityRollup,
  fact: UsageObservabilityFact,
): void {
  if (fact.contextTokens > 0 || fact.contextWindow > 0 || fact.contextPercent !== null) {
    rollup.contextSamples += 1;
    rollup.contextTokenTotal += fact.contextTokens;
    rollup.maxContextTokens = Math.max(rollup.maxContextTokens, fact.contextTokens);
    if (fact.contextPercent !== null) {
      rollup.maxContextPercent =
        rollup.maxContextPercent === null
          ? fact.contextPercent
          : Math.max(rollup.maxContextPercent, fact.contextPercent);
    }
  }
  rollup.contextRefs.push(...fact.contextRefs);
  rollup.toolEvents.push(...fact.toolEvents);
}

function mergeObservabilityRollup(
  target: UsageObservabilityRollup,
  source?: Partial<UsageObservabilityRollup> | null,
): void {
  if (!source) return;
  target.contextSamples += source.contextSamples ?? 0;
  target.contextTokenTotal += source.contextTokenTotal ?? 0;
  target.maxContextTokens = Math.max(target.maxContextTokens, source.maxContextTokens ?? 0);
  if (source.maxContextPercent !== null && source.maxContextPercent !== undefined) {
    target.maxContextPercent =
      target.maxContextPercent === null
        ? source.maxContextPercent
        : Math.max(target.maxContextPercent, source.maxContextPercent);
  }
  if (Array.isArray(source.contextRefs)) target.contextRefs.push(...source.contextRefs);
  if (Array.isArray(source.toolEvents)) target.toolEvents.push(...source.toolEvents);
}

function topDuplicateContextRefs(refs: UsageObservabilityContextRef[]): {
  total: number;
  duplicateCount: number;
  top: UsageTopContextReference[];
} {
  const map = new Map<string, UsageTopContextReference>();
  for (const ref of refs) {
    const existing = map.get(ref.ref) ?? { ref: ref.ref, count: 0, tokens: 0 };
    map.set(ref.ref, {
      ...existing,
      count: existing.count + 1,
      tokens: existing.tokens + ref.tokens,
    });
  }
  const duplicateCount = Array.from(map.values()).reduce(
    (sum, item) => sum + Math.max(0, item.count - 1),
    0,
  );
  const top = Array.from(map.values())
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count || b.tokens - a.tokens)
    .slice(0, 8);
  return { total: refs.length, duplicateCount, top };
}

function toolDistribution(events: UsageObservabilityToolEvent[]): UsageToolDistributionItem[] {
  const map = new Map<string, UsageToolDistributionItem>();
  for (const event of events) {
    const existing = map.get(event.name) ?? {
      name: event.name,
      category: event.category,
      calls: 0,
      share: 0,
    };
    map.set(event.name, { ...existing, calls: existing.calls + 1 });
  }
  const total = events.length;
  return Array.from(map.values())
    .map((item) => ({ ...item, share: total > 0 ? item.calls / total : 0 }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    .slice(0, 12);
}

function detectRepeatedReads(
  sessionId: string,
  events: UsageObservabilityToolEvent[],
): UsageInefficientPattern[] {
  const byRef = new Map<string, UsageObservabilityToolEvent[]>();
  for (const event of events) {
    if (event.category !== "read" || !event.ref) continue;
    const bucket = byRef.get(event.ref) ?? [];
    bucket.push(event);
    byRef.set(event.ref, bucket);
  }
  return Array.from(byRef.entries())
    .filter(([, reads]) => reads.length > 1)
    .map(([ref, reads]) => ({
      type: "repeated_read" as const,
      sessionId,
      count: reads.length,
      sequence: reads.map((event) => `${event.name}:${ref}`),
      suggestion: `同一引用 ${ref} 被重复读取 ${reads.length} 次，可考虑扩大读取范围或复用前一次结果。`,
    }));
}

function detectReadEditChurn(
  sessionId: string,
  events: UsageObservabilityToolEvent[],
): UsageInefficientPattern[] {
  const relevant = events.filter((event) => event.category === "read" || event.category === "edit");
  if (relevant.length < 4) return [];

  const patterns: UsageInefficientPattern[] = [];
  for (let i = 0; i <= relevant.length - 4; i++) {
    const window = relevant.slice(i, i + 4);
    const alternating =
      window[0]?.category === "read" &&
      window[1]?.category === "edit" &&
      window[2]?.category === "read" &&
      window[3]?.category === "edit";
    if (!alternating) continue;
    patterns.push({
      type: "read_edit_churn",
      sessionId,
      count: window.length,
      sequence: window.map((event) => event.name),
      suggestion: "检测到 read/edit 来回震荡，可考虑一次读全相关上下文后批量编辑。",
    });
    break;
  }
  return patterns;
}

function detectInefficientPatterns(
  events: UsageObservabilityToolEvent[],
): UsageInefficientPattern[] {
  const bySession = new Map<string, UsageObservabilityToolEvent[]>();
  for (const event of events) {
    const bucket = bySession.get(event.sessionId) ?? [];
    bucket.push(event);
    bySession.set(event.sessionId, bucket);
  }
  const patterns: UsageInefficientPattern[] = [];
  for (const [sessionId, sessionEvents] of bySession) {
    const ordered = [...sessionEvents].sort((a, b) => a.timestamp - b.timestamp);
    patterns.push(...detectReadEditChurn(sessionId, ordered));
    patterns.push(...detectRepeatedReads(sessionId, ordered));
  }
  return patterns.sort((a, b) => b.count - a.count).slice(0, 12);
}

function buildObservabilityStats(rollups: UsageObservabilityRollup[]): UsageObservabilityStats {
  const combined = emptyObservabilityRollup();
  for (const rollup of rollups) {
    mergeObservabilityRollup(combined, rollup);
  }
  const refStats = topDuplicateContextRefs(combined.contextRefs);
  return {
    contextSamples: combined.contextSamples,
    maxContextTokens: combined.maxContextTokens,
    avgContextTokens:
      combined.contextSamples > 0
        ? Math.round(combined.contextTokenTotal / combined.contextSamples)
        : 0,
    maxContextPercent: combined.maxContextPercent,
    contextRefTotal: refStats.total,
    contextRefDuplicateCount: refStats.duplicateCount,
    contextRefDuplicateRatio: refStats.total > 0 ? refStats.duplicateCount / refStats.total : 0,
    topDuplicateContextRefs: refStats.top,
    toolCalls: combined.toolEvents.length,
    toolDistribution: toolDistribution(combined.toolEvents),
    inefficientPatterns: detectInefficientPatterns(combined.toolEvents),
  };
}

function emptyFact(sessionId: string, timestamp: number): UsageFact {
  return {
    sessionId,
    timestamp,
    tokens: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    mcpCalls: 0,
    memoryWrites: 0,
    memoryFailures: 0,
    memoryHits: 0,
    skillHits: 0,
    hookBlocks: 0,
    model: null,
    mcpTools: [],
    skills: [],
    observability: null,
  };
}

export function usageFactFromEntry(item: UsageSourceEntry): UsageFact | null {
  const value = item.value;
  if (!isRecord(value)) return null;
  const timestamp = getEntryTimestamp(value);
  if (timestamp === null) return null;

  const fact = emptyFact(item.sessionId, timestamp);
  const entryType = typeof value.type === "string" ? value.type : "";
  const message = getMessage(value);

  if (entryType === "message" && message) {
    const role = typeof message.role === "string" ? message.role : "";
    fact.messages = 1;
    if (role === "user") fact.userMessages = 1;
    if (role === "assistant") fact.assistantMessages = 1;

    const usage = extractUsage(message);
    fact.tokens = usage.tokens;
    fact.input = usage.input;
    fact.output = usage.output;
    fact.cacheRead = usage.cacheRead;
    fact.cacheWrite = usage.cacheWrite;
    fact.cost = usage.cost;

    if (usage.tokens > 0) {
      const provider = typeof message.provider === "string" ? message.provider : null;
      const model =
        typeof message.model === "string"
          ? message.model
          : typeof message.modelId === "string"
            ? message.modelId
            : "unknown";
      fact.model = {
        provider,
        model,
        tokens: usage.tokens,
        calls: 1,
      };
    }

    const observability = emptyObservabilityFact();
    for (const block of contentBlocks(message)) {
      if (!isToolCallBlock(block)) continue;
      const name = toolNameFromBlock(block);
      fact.toolCalls += 1;
      if (!name) continue;
      observability.toolEvents.push({
        sessionId: item.sessionId,
        timestamp,
        name: normalizeToolName(name),
        category: toolCategory(name),
        ref: pathRefFromArgs(readToolArgs(block)),
      });
      const mcp = parseMcpToolName(name);
      if (mcp) {
        fact.mcpCalls += 1;
        fact.mcpTools.push({ server: mcp.server, tool: mcp.tool, calls: 1, errors: 0 });
      }
    }

    for (const skillName of collectSkillNames(textFromContent(message.content))) {
      fact.skillHits += 1;
      fact.skills.push({ name: skillName, calls: 1, patchCount: 0 });
    }

    if (observability.toolEvents.length > 0) {
      fact.observability = observability;
    }
  }

  if (entryType === "custom") {
    const customType = readCustomType(value);
    const data = isRecord(value.data) ? value.data : null;
    if (customType && CONTEXT_REF_CUSTOM_TYPES.has(customType)) {
      const observability = fact.observability ?? emptyObservabilityFact();
      const context =
        customType === "context_usage"
          ? contextUsageFromData(data)
          : { contextTokens: 0, contextWindow: 0, contextPercent: null, contextRefs: [] };
      observability.contextTokens = context.contextTokens;
      observability.contextWindow = context.contextWindow;
      observability.contextPercent = context.contextPercent;
      observability.contextRefs.push(
        ...(customType === "context_usage" ? context.contextRefs : contextRefsFromData(data)),
      );
      fact.observability = observability;
    }
    if (customType && MEMORY_WRITE_TYPES.has(customType)) {
      fact.memoryWrites = 1;
    }
    if (customType && MEMORY_FAILURE_TYPES.has(customType)) {
      fact.memoryFailures = 1;
    }
    if (customType && MEMORY_HIT_TYPES.has(customType)) {
      fact.memoryHits = Math.max(1, countSelectedFiles(data));
    }
    if (
      (customType && HOOK_BLOCK_TYPES.has(customType)) ||
      data?.decision === "block" ||
      data?.status === "blocked"
    ) {
      fact.hookBlocks = 1;
    }
    if (customType === "skill_usage" || customType === "skill_used") {
      const name =
        typeof data?.name === "string"
          ? data.name
          : typeof data?.skillName === "string"
            ? data.skillName
            : null;
      if (name) {
        fact.skillHits = 1;
        fact.skills.push({ name, calls: 1, patchCount: 0 });
      }
    }
    if (customType === "skill_patch" || customType === "skill_updated") {
      const name =
        typeof data?.name === "string"
          ? data.name
          : typeof data?.skillName === "string"
            ? data.skillName
            : null;
      if (name) {
        fact.skills.push({ name, calls: 0, patchCount: 1 });
      }
    }
  }

  return fact;
}

export function createUsageDailyRollup(sessionId: string, timestamp: number): UsageDailyRollup {
  const date = localDateKey(timestamp);
  return {
    sessionId,
    date,
    firstTimestamp: timestamp,
    lastTimestamp: timestamp,
    timestamps: [],
    bucket: emptyBucket(date),
    userMessages: 0,
    assistantMessages: 0,
    memoryFailures: 0,
    mcpTools: [],
    skills: [],
    observability: emptyObservabilityRollup(),
  };
}

export function addUsageFactToDailyRollup(rollup: UsageDailyRollup, fact: UsageFact): void {
  rollup.firstTimestamp = Math.min(rollup.firstTimestamp, fact.timestamp);
  rollup.lastTimestamp = Math.max(rollup.lastTimestamp, fact.timestamp);
  rollup.timestamps.push(fact.timestamp);
  rollup.userMessages += fact.userMessages;
  rollup.assistantMessages += fact.assistantMessages;
  rollup.memoryFailures += fact.memoryFailures;

  addBucket(rollup.bucket, {
    tokens: fact.tokens,
    input: fact.input,
    output: fact.output,
    cacheRead: fact.cacheRead,
    cacheWrite: fact.cacheWrite,
    cost: fact.cost,
    messages: fact.messages,
    toolCalls: fact.toolCalls,
    mcpCalls: fact.mcpCalls,
    memoryWrites: fact.memoryWrites,
    memoryHits: fact.memoryHits,
    skillHits: fact.skillHits,
    hookBlocks: fact.hookBlocks,
  });

  if (fact.model) {
    addDailyModelToken(rollup.bucket, fact.model);
  }

  for (const mcp of fact.mcpTools) {
    patchMcpList(rollup.mcpTools, mcp);
  }

  for (const skill of fact.skills) {
    patchSkillList(rollup.skills, skill);
  }

  if (fact.observability) {
    addObservabilityFactToRollup(rollup.observability, fact.observability);
  }
}

export function aggregateUsageFacts(
  facts: UsageFact[],
  options: AggregateOptions,
): UsageShareStats {
  const now = options.now ?? Date.now();
  const earliest = facts.reduce<number | null>(
    (acc, fact) => (acc === null ? fact.timestamp : Math.min(acc, fact.timestamp)),
    null,
  );
  const range = resolveRange(options.range ?? "30d", now, earliest);
  const totals = makeTotals();
  const dayMap = new Map<string, UsageDailyBucket>();
  const sessionsByDay = new Map<string, Set<string>>();
  const sessionsInRange = new Set<string>();
  const activeTimestampsBySession = new Map<string, number[]>();
  const topModels = new Map<string, UsageTopModel>();
  const topMcpTools = new Map<string, UsageTopMcpTool>();
  const topSkills = new Map<string, UsageTopSkill>();
  const observability = emptyObservabilityRollup();

  let parsedEntries = 0;

  function bucketFor(timestamp: number): UsageDailyBucket {
    const key = localDateKey(timestamp);
    let bucket = dayMap.get(key);
    if (!bucket) {
      bucket = emptyBucket(key);
      dayMap.set(key, bucket);
    }
    return bucket;
  }

  for (const fact of facts) {
    const timestamp = fact.timestamp;
    if (!inRange(timestamp, range)) continue;
    parsedEntries += 1;

    sessionsInRange.add(fact.sessionId);
    const timestamps = activeTimestampsBySession.get(fact.sessionId) ?? [];
    timestamps.push(timestamp);
    activeTimestampsBySession.set(fact.sessionId, timestamps);

    const dayKey = localDateKey(timestamp);
    const daySessions = sessionsByDay.get(dayKey) ?? new Set<string>();
    daySessions.add(fact.sessionId);
    sessionsByDay.set(dayKey, daySessions);

    const bucket = bucketFor(timestamp);
    totals.messages += fact.messages;
    totals.userMessages += fact.userMessages;
    totals.assistantMessages += fact.assistantMessages;
    totals.tokens += fact.tokens;
    totals.input += fact.input;
    totals.output += fact.output;
    totals.cacheRead += fact.cacheRead;
    totals.cacheWrite += fact.cacheWrite;
    totals.cost += fact.cost;
    totals.toolCalls += fact.toolCalls;
    totals.mcpCalls += fact.mcpCalls;
    totals.memoryWrites += fact.memoryWrites;
    totals.memoryFailures += fact.memoryFailures;
    totals.memoryHits += fact.memoryHits;
    totals.skillHits += fact.skillHits;
    totals.hookBlocks += fact.hookBlocks;
    if (fact.observability) {
      addObservabilityFactToRollup(observability, fact.observability);
    }

    addBucket(bucket, {
      tokens: fact.tokens,
      input: fact.input,
      output: fact.output,
      cacheRead: fact.cacheRead,
      cacheWrite: fact.cacheWrite,
      cost: fact.cost,
      messages: fact.messages,
      toolCalls: fact.toolCalls,
      mcpCalls: fact.mcpCalls,
      memoryWrites: fact.memoryWrites,
      memoryHits: fact.memoryHits,
      skillHits: fact.skillHits,
      hookBlocks: fact.hookBlocks,
    });

    if (fact.model && fact.model.tokens > 0) {
      const key = `${fact.model.provider ?? ""}::${fact.model.model}`;
      const existing = topModels.get(key) ?? {
        provider: fact.model.provider,
        model: fact.model.model,
        tokens: 0,
        calls: 0,
      };
      topModels.set(key, {
        ...existing,
        tokens: existing.tokens + fact.model.tokens,
        calls: existing.calls + fact.model.calls,
      });
      addDailyModelToken(bucket, fact.model);
    }

    for (const mcp of fact.mcpTools) {
      const key = `${mcp.server}::${mcp.tool}`;
      const existing = topMcpTools.get(key) ?? {
        server: mcp.server,
        tool: mcp.tool,
        calls: 0,
        errors: 0,
      };
      topMcpTools.set(key, {
        ...existing,
        calls: existing.calls + mcp.calls,
        errors: existing.errors + mcp.errors,
      });
    }

    for (const skill of fact.skills) {
      patchSkillMap(topSkills, skill.name, {
        calls: skill.calls,
        patchCount: skill.patchCount,
      });
    }
  }

  for (const [dayKey, sessions] of sessionsByDay) {
    const bucket = dayMap.get(dayKey);
    if (bucket) bucket.sessions = sessions.size;
  }

  totals.sessions = sessionsInRange.size;
  totals.activeDays = dayMap.size;
  totals.longestTaskMs = longestActiveBurst(activeTimestampsBySession);
  totals.peakDayTokens = Array.from(dayMap.values()).reduce(
    (max, bucket) => Math.max(max, bucket.tokens),
    0,
  );
  const streaks = updateStreaks(Array.from(dayMap.keys()), now);
  totals.currentStreak = streaks.current;
  totals.longestStreak = streaks.longest;

  const daily = fillDailyBuckets(range, dayMap);
  const dataQuality: UsageDataQuality = {
    scannedSessionFiles: options.scannedSessionFiles ?? 0,
    parsedEntries,
    skippedEntries: options.skippedEntries ?? 0,
    estimatedFields: ["skillHits", "hookBlocks", "memoryHits", "observability.contextRefs"],
    lastCacheWriteAt: options.lastCacheWriteAt ?? null,
  };

  return {
    projectPath: options.projectPath ?? "",
    scope: options.scope ?? "project",
    generatedAt: now,
    range,
    totals,
    daily,
    topModels: topValues(topModels, (item) => item.tokens, 6),
    topMcpTools: topValues(topMcpTools, (item) => item.calls, 8),
    topSkills: topValues(topSkills, (item) => item.calls + item.patchCount, 8),
    observability: buildObservabilityStats([observability]),
    dataQuality,
  };
}

export function aggregateUsageDailyRollups(
  rollups: UsageDailyRollup[],
  options: AggregateOptions,
): UsageShareStats {
  const now = options.now ?? Date.now();
  const earliest = rollups.reduce<number | null>(
    (acc, rollup) => (acc === null ? rollup.firstTimestamp : Math.min(acc, rollup.firstTimestamp)),
    null,
  );
  const range = resolveRange(options.range ?? "30d", now, earliest);
  const totals = makeTotals();
  const dayMap = new Map<string, UsageDailyBucket>();
  const sessionsByDay = new Map<string, Set<string>>();
  const sessionsInRange = new Set<string>();
  const activeTimestampsBySession = new Map<string, number[]>();
  const topModels = new Map<string, UsageTopModel>();
  const topMcpTools = new Map<string, UsageTopMcpTool>();
  const topSkills = new Map<string, UsageTopSkill>();
  const observability = emptyObservabilityRollup();
  let parsedEntries = 0;

  for (const rollup of rollups) {
    if (rollup.lastTimestamp < (range.startAt ?? Number.NEGATIVE_INFINITY)) continue;
    if (rollup.firstTimestamp > range.endAt) continue;

    const timestampsInRange = rollup.timestamps.filter((timestamp) => inRange(timestamp, range));
    if (timestampsInRange.length === 0) continue;
    parsedEntries += timestampsInRange.length;

    sessionsInRange.add(rollup.sessionId);
    const timestamps = activeTimestampsBySession.get(rollup.sessionId) ?? [];
    timestamps.push(...timestampsInRange);
    activeTimestampsBySession.set(rollup.sessionId, timestamps);

    const daySessions = sessionsByDay.get(rollup.date) ?? new Set<string>();
    daySessions.add(rollup.sessionId);
    sessionsByDay.set(rollup.date, daySessions);

    let bucket = dayMap.get(rollup.date);
    if (!bucket) {
      bucket = emptyBucket(rollup.date);
      dayMap.set(rollup.date, bucket);
    }

    addBucket(bucket, rollup.bucket);
    for (const model of rollup.bucket.models) {
      addDailyModelToken(bucket, model);
      const key = `${model.provider ?? ""}::${model.model}`;
      const existing = topModels.get(key) ?? {
        provider: model.provider,
        model: model.model,
        tokens: 0,
        calls: 0,
      };
      topModels.set(key, {
        ...existing,
        tokens: existing.tokens + model.tokens,
        calls: existing.calls + model.calls,
      });
    }

    for (const mcp of rollup.mcpTools) {
      const key = `${mcp.server}::${mcp.tool}`;
      const existing = topMcpTools.get(key) ?? {
        server: mcp.server,
        tool: mcp.tool,
        calls: 0,
        errors: 0,
      };
      topMcpTools.set(key, {
        ...existing,
        calls: existing.calls + mcp.calls,
        errors: existing.errors + mcp.errors,
      });
    }

    for (const skill of rollup.skills) {
      patchSkillMap(topSkills, skill.name, {
        calls: skill.calls,
        patchCount: skill.patchCount,
      });
    }
    mergeObservabilityRollup(observability, rollup.observability);

    totals.messages += rollup.bucket.messages;
    totals.userMessages += rollup.userMessages;
    totals.assistantMessages += rollup.assistantMessages;
    totals.tokens += rollup.bucket.tokens;
    totals.input += rollup.bucket.input;
    totals.output += rollup.bucket.output;
    totals.cacheRead += rollup.bucket.cacheRead;
    totals.cacheWrite += rollup.bucket.cacheWrite;
    totals.cost += rollup.bucket.cost;
    totals.toolCalls += rollup.bucket.toolCalls;
    totals.mcpCalls += rollup.bucket.mcpCalls;
    totals.memoryWrites += rollup.bucket.memoryWrites;
    totals.memoryFailures += rollup.memoryFailures;
    totals.memoryHits += rollup.bucket.memoryHits;
    totals.skillHits += rollup.bucket.skillHits;
    totals.hookBlocks += rollup.bucket.hookBlocks;
  }

  for (const [dayKey, sessions] of sessionsByDay) {
    const bucket = dayMap.get(dayKey);
    if (bucket) bucket.sessions = sessions.size;
  }

  totals.sessions = sessionsInRange.size;
  totals.activeDays = dayMap.size;
  totals.longestTaskMs = longestActiveBurst(activeTimestampsBySession);
  totals.peakDayTokens = Array.from(dayMap.values()).reduce(
    (max, bucket) => Math.max(max, bucket.tokens),
    0,
  );
  const streaks = updateStreaks(Array.from(dayMap.keys()), now);
  totals.currentStreak = streaks.current;
  totals.longestStreak = streaks.longest;

  const daily = fillDailyBuckets(range, dayMap);
  const dataQuality: UsageDataQuality = {
    scannedSessionFiles: options.scannedSessionFiles ?? 0,
    parsedEntries,
    skippedEntries: options.skippedEntries ?? 0,
    estimatedFields: ["skillHits", "hookBlocks", "memoryHits", "observability.contextRefs"],
    lastCacheWriteAt: options.lastCacheWriteAt ?? null,
  };

  return {
    projectPath: options.projectPath ?? "",
    scope: options.scope ?? "project",
    generatedAt: now,
    range,
    totals,
    daily,
    topModels: topValues(topModels, (item) => item.tokens, 6),
    topMcpTools: topValues(topMcpTools, (item) => item.calls, 8),
    topSkills: topValues(topSkills, (item) => item.calls + item.patchCount, 8),
    observability: buildObservabilityStats([observability]),
    dataQuality,
  };
}

export function aggregateUsageEntries(
  entries: UsageSourceEntry[],
  options: AggregateOptions,
): UsageShareStats {
  const facts = entries.flatMap((entry) => {
    const fact = usageFactFromEntry(entry);
    return fact ? [fact] : [];
  });
  return aggregateUsageFacts(facts, options);
}

function longestActiveBurst(timestampsBySession: Map<string, number[]>): number {
  let longest = 0;
  for (const timestamps of timestampsBySession.values()) {
    const sorted = [...timestamps].sort((a, b) => a - b);
    if (sorted.length < 2) continue;
    let start = sorted[0] ?? 0;
    let prev = start;
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i] ?? prev;
      if (current - prev > ACTIVE_BURST_GAP_MS) {
        longest = Math.max(longest, prev - start);
        start = current;
      }
      prev = current;
    }
    longest = Math.max(longest, prev - start);
  }
  return longest;
}

function fillDailyBuckets(
  range: UsageRange,
  dayMap: Map<string, UsageDailyBucket>,
): UsageDailyBucket[] {
  if (range.startAt === null) {
    return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }
  const end = startOfLocalDay(range.endAt);
  const buckets: UsageDailyBucket[] = [];
  for (let cursor = range.startAt; cursor <= end; cursor += DAY_MS) {
    const key = localDateKey(cursor);
    buckets.push(dayMap.get(key) ?? emptyBucket(key));
  }
  return buckets;
}

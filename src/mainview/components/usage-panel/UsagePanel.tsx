import { useEffect, useRef, type ComponentType } from "react";
import {
  Activity,
  BarChart3,
  Brain,
  Flame,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Trophy,
  Wrench,
} from "lucide-react";
import { useSessionStore } from "../../stores/use-session-store";
import { usageScopeKey, usageStatsKey, useUsageStore } from "../../stores/use-usage-store";
import type {
  UsageDailyBucket,
  UsageObservabilityStats,
  UsageRangePreset,
  UsageScope,
  UsageShareStats,
  UsageTopModel,
} from "../../../shared/modules/usage";

const RANGES: Array<{ id: UsageRangePreset; label: string }> = [
  { id: "7d", label: "7天" },
  { id: "30d", label: "30天" },
  { id: "year", label: "一年" },
  { id: "all", label: "全部" },
];

const MODEL_COLORS = ["#4196f3", "#45c477", "#7c5ce6", "#ff6b6b", "#ff9f43", "#48d1cc"];
const MIN_HEATMAP_COLUMNS = 53;
const EMPTY_OBSERVABILITY: UsageObservabilityStats = {
  contextSamples: 0,
  maxContextTokens: 0,
  avgContextTokens: 0,
  maxContextPercent: null,
  contextRefTotal: 0,
  contextRefDuplicateCount: 0,
  contextRefDuplicateRatio: 0,
  topDuplicateContextRefs: [],
  toolCalls: 0,
  toolDistribution: [],
  inefficientPatterns: [],
};

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${(value / 100000000).toFixed(abs >= 1000000000 ? 1 : 2)}亿`;
  if (abs >= 10000) return `${(value / 10000).toFixed(abs >= 100000 ? 1 : 2)}万`;
  return Math.round(value).toLocaleString();
}

function compactMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function modelKey(model: Pick<UsageTopModel, "provider" | "model">): string {
  return `${model.provider ?? ""}::${model.model}`;
}

function modelColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length] ?? MODEL_COLORS[0];
}

function percentLabel(value: number, total: number): string {
  if (!total) return "0%";
  const percent = (value / total) * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

function durationLabel(ms: number): string {
  if (!ms) return "0m";
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${rest}m` : `${hours}h`;
}

function talkScore(day: UsageDailyBucket): number {
  if (!day.messages && !day.sessions) return 0;
  return day.messages + Math.max(0, day.sessions - 1) * 2;
}

function heatTone(score: number, max: number): string {
  if (!score || !max) return "bg-surface-hover/40";
  const ratio = score / max;
  if (ratio > 0.8) return "bg-status-success";
  if (ratio > 0.55) return "bg-status-success/80";
  if (ratio > 0.3) return "bg-status-success/55";
  return "bg-status-success/30";
}

function MetricCell({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-w-0 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-text-tertiary">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-lg font-semibold leading-tight text-text-primary">
        {value}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border-secondary bg-bg-primary/55">
      <MetricCell label={label} value={value} icon={icon} />
    </div>
  );
}

function localDate(date: string): Date {
  const [year, month, day] = date.split("-").map((value) => Number(value));
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

interface ContributionCell {
  date: string | null;
  bucket: UsageDailyBucket | null;
}

function mondayBasedDay(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function buildContributionCells(daily: UsageDailyBucket[]): ContributionCell[] {
  if (daily.length === 0) return [];
  const cells: ContributionCell[] = [];
  const leadingBlankCount = mondayBasedDay(localDate(daily[0]?.date ?? ""));

  for (let i = 0; i < leadingBlankCount; i++) {
    cells.push({ date: null, bucket: null });
  }

  for (const bucket of daily) {
    cells.push({ date: bucket.date, bucket });
  }

  const columns = Math.ceil(cells.length / 7);
  const fillerColumns = Math.max(0, MIN_HEATMAP_COLUMNS - columns);
  if (fillerColumns > 0) {
    cells.unshift(
      ...Array.from<unknown, ContributionCell>({ length: fillerColumns * 7 }, () => ({
        date: null,
        bucket: null,
      })),
    );
  }

  return cells;
}

function buildMonthLabels(cells: ContributionCell[]): string[] {
  const columns = Math.ceil(cells.length / 7);
  const labels: string[] = [];
  let previousMonth: number | null = null;

  for (let column = 0; column < columns; column++) {
    const columnCells = cells.slice(column * 7, column * 7 + 7);
    const firstBucket = columnCells.find((cell) => cell.bucket)?.bucket ?? null;
    if (!firstBucket) {
      labels.push("");
      continue;
    }

    const date = localDate(firstBucket.date);
    const month = date.getMonth();
    labels.push(month !== previousMonth ? `${month + 1}月` : "");
    previousMonth = month;
  }

  return labels;
}

function Heatmap({ daily }: { daily: UsageDailyBucket[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const cells = buildContributionCells(daily);
  const columns = Math.max(1, Math.ceil(cells.length / 7));
  const monthLabels = buildMonthLabels(cells);
  const max = daily.reduce((acc, item) => Math.max(acc, talkScore(item)), 0);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollLeft = scroller.scrollWidth;
  }, [daily]);

  return (
    <div className="rounded-md border border-border-secondary bg-bg-primary/55 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
          <MessageCircle className="h-3 w-3" />
          Talk 活动
        </div>
        <div className="flex items-center gap-1 text-[9px] text-text-tertiary">
          <span>少</span>
          {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
            <span key={ratio} className={`h-2.5 w-2.5 rounded-sm ${heatTone(max * ratio, max)}`} />
          ))}
          <span>多</span>
        </div>
      </div>
      <div ref={scrollerRef} className="overflow-x-auto pb-1">
        <div className="ml-auto w-max">
          <div
            className="ml-5 grid gap-1 text-[9px] leading-3 text-text-tertiary"
            style={{ gridTemplateColumns: `repeat(${columns}, 14px)` }}
          >
            {monthLabels.map((label, index) => (
              <div key={`${index}-${label}`} className="h-3 w-8 overflow-visible whitespace-nowrap">
                {label}
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            <div className="grid shrink-0 grid-rows-7 gap-1 text-[8px] leading-[10px] text-text-tertiary">
              {["一", "", "三", "", "五", "", ""].map((label, index) => (
                <div key={index} className="h-3.5 w-4">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-flow-col grid-rows-7 gap-1">
              {cells.map((cell, index) => {
                if (!cell.bucket) {
                  return (
                    <div
                      key={`blank-${index}`}
                      aria-hidden="true"
                      className="h-3.5 w-3.5 rounded-sm bg-surface-hover/45"
                    />
                  );
                }

                const score = talkScore(cell.bucket);
                const label = `${cell.bucket.date} · ${compactNumber(cell.bucket.messages)} 条消息 · ${compactNumber(cell.bucket.sessions)} 个会话 · ${compactNumber(cell.bucket.tokens)} tokens`;

                return (
                  <div
                    key={cell.bucket.date}
                    title={label}
                    aria-label={label}
                    className={`h-3.5 w-3.5 rounded-sm ${heatTone(score, max)}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrendBars({
  daily,
  topModels,
}: {
  daily: UsageDailyBucket[];
  topModels: UsageTopModel[];
}) {
  const visible = daily.slice(-30);
  const modelIndex = new Map(topModels.map((item, index) => [modelKey(item), index]));
  const max = visible.reduce((acc, item) => Math.max(acc, item.tokens), 0);
  const legend = topModels.slice(0, 6);

  return (
    <div className="rounded-md border border-border-secondary bg-bg-primary/55 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
        <BarChart3 className="h-3 w-3" />
        Token 趋势
      </div>
      <div className="flex h-28 items-end gap-1 overflow-hidden rounded bg-bg-secondary/40 px-1.5 pt-3">
        {visible.map((day) => {
          const height = max && day.tokens ? Math.max(3, Math.round((day.tokens / max) * 100)) : 3;
          const segments = [...day.models].sort((a, b) => {
            const indexA = modelIndex.get(modelKey(a)) ?? Number.MAX_SAFE_INTEGER;
            const indexB = modelIndex.get(modelKey(b)) ?? Number.MAX_SAFE_INTEGER;
            return indexA - indexB;
          });

          return (
            <div key={day.date} className="flex min-w-[6px] flex-1 items-end">
              <div
                title={`${day.date} · ${compactNumber(day.tokens)} tokens`}
                className="flex w-full min-w-[4px] flex-col-reverse overflow-hidden rounded-t bg-surface-hover/35"
                style={{ height }}
              >
                {segments.map((segment) => {
                  const colorIndex = modelIndex.get(modelKey(segment)) ?? 0;
                  const segmentHeight = day.tokens ? (segment.tokens / day.tokens) * 100 : 0;
                  return (
                    <div
                      key={`${segment.provider ?? ""}-${segment.model}`}
                      title={`${day.date} · ${segment.model} · ${compactNumber(segment.tokens)} tokens`}
                      style={{
                        height: `${segmentHeight}%`,
                        backgroundColor: modelColor(colorIndex),
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {legend.length > 0 && (
        <div className="mt-2 grid grid-cols-1 gap-1.5 text-[10px] text-text-tertiary sm:grid-cols-3">
          {legend.map((model, index) => (
            <div key={modelKey(model)} className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: modelColor(index) }}
              />
              <span className="truncate">{model.model}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelUsageDonut({ models }: { models: UsageTopModel[] }) {
  const total = models.reduce((sum, item) => sum + item.tokens, 0);
  let cursor = 0;
  const gradientParts = models.length
    ? models.map((item, index) => {
        const start = cursor;
        const percent = total ? (item.tokens / total) * 100 : 0;
        cursor += percent;
        return `${modelColor(index)} ${start}% ${cursor}%`;
      })
    : ["rgb(var(--color-bg-secondary)) 0% 100%"];

  return (
    <div className="rounded-md border border-border-secondary bg-bg-primary/55 p-2.5">
      <div className="mb-2 text-[11px] font-medium text-text-secondary">模型用量</div>
      <div className="grid gap-3 sm:grid-cols-[150px,1fr] sm:items-center">
        <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-full sm:h-36 sm:w-36">
          <div
            className="flex h-full w-full items-center justify-center rounded-full"
            style={{ background: `conic-gradient(${gradientParts.join(", ")})` }}
          >
            <div className="flex h-[58%] w-[58%] flex-col items-center justify-center rounded-full bg-bg-primary text-center shadow-[0_0_0_1px_rgb(var(--color-border-secondary))]">
              <div className="text-lg font-semibold leading-none text-text-primary">
                {compactNumber(total)}
              </div>
              <div className="mt-1 text-[9px] text-text-tertiary">tokens</div>
            </div>
          </div>
        </div>
        <div className="min-w-0 divide-y divide-border-secondary/70">
          {models.length === 0 ? (
            <div className="py-3 text-center text-[10px] text-text-tertiary">暂无数据</div>
          ) : (
            models.slice(0, 6).map((item, index) => (
              <div
                key={modelKey(item)}
                className="flex min-w-0 items-center gap-2 py-2 text-[10px]"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: modelColor(index) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-text-secondary">
                    {item.model}
                  </div>
                  <div className="mt-0.5 text-text-tertiary">
                    {compactNumber(item.tokens)} tokens
                  </div>
                </div>
                <div className="shrink-0 text-[11px] font-medium text-text-tertiary">
                  {percentLabel(item.tokens, total)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RankedList({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-md border border-border-secondary bg-bg-primary/55 p-2.5">
      <div className="mb-1.5 text-[11px] font-medium text-text-secondary">{title}</div>
      {items.length === 0 ? (
        <div className="py-3 text-center text-[10px] text-text-tertiary">暂无数据</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <div key={item.label} className="flex min-w-0 items-center gap-2 text-[10px]">
              <span className="min-w-0 flex-1 truncate text-text-secondary">{item.label}</span>
              <span className="shrink-0 text-text-tertiary">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ratioLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value < 0.01) return "<1%";
  return `${Math.round(value * 100)}%`;
}

function ObservabilityCard({ stats }: { stats: UsageObservabilityStats }) {
  const hasData = stats.contextSamples > 0 || stats.toolCalls > 0 || stats.contextRefTotal > 0;
  const toolItems = stats.toolDistribution.slice(0, 6).map((item) => ({
    label: `${item.name} · ${item.category}`,
    value: `${item.calls} 次 · ${ratioLabel(item.share)}`,
  }));
  const patternItems = stats.inefficientPatterns.slice(0, 5).map((item) => ({
    label:
      item.type === "read_edit_churn"
        ? `${item.sessionId} · read/edit 震荡`
        : `${item.sessionId} · 重复读取`,
    value: `${item.count} 次`,
  }));
  const duplicateItems = stats.topDuplicateContextRefs.slice(0, 5).map((item) => ({
    label: item.ref,
    value: `${item.count} 次 · ${compactNumber(item.tokens)} tokens`,
  }));

  return (
    <div className="rounded-md border border-border-secondary bg-bg-primary/55 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
        <Activity className="h-3 w-3" />
        链路观测
      </div>
      {!hasData ? (
        <div className="rounded border border-dashed border-border-secondary/70 px-3 py-4 text-center text-[10px] text-text-tertiary">
          暂无 context_usage 或工具序列数据。刷新用量索引后，新会话会逐步沉淀。
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="平均上下文"
              value={compactNumber(stats.avgContextTokens)}
              icon={BarChart3}
            />
            <StatCard
              label="峰值上下文"
              value={
                stats.maxContextPercent === null
                  ? compactNumber(stats.maxContextTokens)
                  : `${compactNumber(stats.maxContextTokens)} · ${ratioLabel(
                      stats.maxContextPercent > 1
                        ? stats.maxContextPercent / 100
                        : stats.maxContextPercent,
                    )}`
              }
              icon={Flame}
            />
            <StatCard
              label="重复引用率"
              value={`${ratioLabel(stats.contextRefDuplicateRatio)} (${stats.contextRefDuplicateCount})`}
              icon={Brain}
            />
            <StatCard
              label="低效模式"
              value={compactNumber(stats.inefficientPatterns.length)}
              icon={Wrench}
            />
          </div>
          <RankedList title="工具调用分布" items={toolItems} />
          <RankedList title="重复上下文引用" items={duplicateItems} />
          <RankedList title="可优化模式" items={patternItems} />
        </div>
      )}
    </div>
  );
}

function ShareCard({ stats }: { stats: UsageShareStats }) {
  const mcpItems = stats.topMcpTools.map((item) => ({
    label: `${item.server}/${item.tool}`,
    value: `${item.calls} 次`,
  }));
  const skillItems = stats.topSkills.map((item) => ({
    label: item.name,
    value: item.patchCount ? `${item.calls} 用 · ${item.patchCount} 改` : `${item.calls} 次`,
  }));

  return (
    <div className="space-y-2.5 pb-16">
      <div className="overflow-hidden rounded-md border border-accent/25 bg-accent/10">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-bg-primary">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-text-primary">Agent 战绩</div>
            <div className="truncate text-[10px] text-text-tertiary">{stats.range.label}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-accent/20 sm:grid-cols-4">
          <div className="border-r border-b border-accent/20 sm:border-b-0">
            <MetricCell
              label="Token 消耗"
              value={compactNumber(stats.totals.tokens)}
              icon={Flame}
            />
          </div>
          <div className="border-b border-accent/20 sm:border-r sm:border-b-0">
            <MetricCell label="活跃天数" value={`${stats.totals.activeDays} 天`} icon={Activity} />
          </div>
          <div className="border-r border-accent/20">
            <MetricCell
              label="最长任务"
              value={durationLabel(stats.totals.longestTaskMs)}
              icon={Sparkles}
            />
          </div>
          <MetricCell label="当前连击" value={`${stats.totals.currentStreak} 天`} icon={Trophy} />
        </div>
      </div>

      <Heatmap daily={stats.daily} />
      <TrendBars daily={stats.daily} topModels={stats.topModels} />
      <ObservabilityCard stats={stats.observability ?? EMPTY_OBSERVABILITY} />

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="会话" value={compactNumber(stats.totals.sessions)} icon={Activity} />
        <StatCard label="消息" value={compactNumber(stats.totals.messages)} icon={BarChart3} />
        <StatCard label="MCP 调用" value={compactNumber(stats.totals.mcpCalls)} icon={Wrench} />
        <StatCard label="记忆写入" value={compactNumber(stats.totals.memoryWrites)} icon={Brain} />
        <StatCard
          label="Skill 命中"
          value={compactNumber(stats.totals.skillHits)}
          icon={Sparkles}
        />
        <StatCard label="成本估算" value={compactMoney(stats.totals.cost)} icon={Flame} />
      </div>

      <ModelUsageDonut models={stats.topModels} />
      <RankedList title="最常用 MCP" items={mcpItems} />
      <RankedList title="Skill 沉淀/使用" items={skillItems} />

      <div className="rounded-md border border-border-secondary bg-bg-primary/40 p-2 text-[9px] leading-4 text-text-tertiary">
        扫描 {stats.dataQuality.scannedSessionFiles} 个 session，解析{" "}
        {stats.dataQuality.parsedEntries} 条记录。Skill、Hook、Memory 命中会随历史事件完整度估算。
      </div>
    </div>
  );
}

interface UsagePanelProps {
  scope?: UsageScope;
  projectPath?: string;
  embedded?: boolean;
}

export function UsagePanel({
  scope = "project",
  projectPath: projectPathProp,
  embedded = false,
}: UsagePanelProps) {
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const activeProjectTab = projectTabs.find((tab) => tab.id === activeProjectId) ?? null;
  const projectPath = projectPathProp ?? activeProjectTab?.path ?? "";
  const scopeKey = usageScopeKey(scope, projectPath);
  const range = useUsageStore((s) => s.rangeByScope[scopeKey] ?? "30d");
  const key = usageStatsKey(scope, projectPath, range);
  const stats = useUsageStore((s) => s.statsByKey[key] ?? null);
  const loading = useUsageStore((s) => s.loadingByKey[key] ?? false);
  const error = useUsageStore((s) => s.errorByKey[key] ?? null);
  const loadShareStats = useUsageStore((s) => s.loadShareStats);
  const setRange = useUsageStore((s) => s.setRange);

  useEffect(() => {
    if (scope === "project" && !projectPath) return;
    void loadShareStats({
      scope,
      projectPath: scope === "project" ? projectPath : undefined,
      range,
    });
  }, [scope, projectPath, range, loadShareStats]);

  if (scope === "project" && !projectPath) {
    return <div className="p-3 text-xs text-text-tertiary">未选择项目</div>;
  }

  const subtitle =
    scope === "global"
      ? "所有项目"
      : activeProjectTab?.remote
        ? `${activeProjectTab.remote.host}:${activeProjectTab.remote.remotePath}`
        : projectPath;

  return (
    <div
      data-testid="usage-panel"
      className={`flex min-w-0 flex-col text-text-primary ${
        embedded ? "h-full bg-transparent" : "h-full bg-bg-secondary"
      }`}
    >
      <div
        className={`shrink-0 ${
          embedded
            ? "pb-3"
            : "border-b border-border-secondary px-2.5 py-2 dark:border-surface-code/50"
        }`}
      >
        <div className="flex items-center gap-2">
          <Trophy className="h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-text-secondary">战绩</div>
            <div className="truncate text-[9px] text-text-tertiary">{subtitle}</div>
          </div>
          <button
            type="button"
            onClick={() =>
              void loadShareStats({
                scope,
                projectPath: scope === "project" ? projectPath : undefined,
                range,
                forceRefresh: true,
              })
            }
            title="刷新"
            className="flex h-11 w-11 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-surface-hover/60 hover:text-text-secondary sm:h-7 sm:w-7"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="mt-2 flex rounded-md border border-border-secondary bg-bg-primary/40 p-0.5">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setRange(scopeKey, item.id)}
              className={`h-11 min-w-0 flex-1 rounded px-1 text-[10px] font-medium transition-colors sm:h-6 ${
                range === item.id
                  ? "bg-surface-hover text-text-primary"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="border-b border-status-error/30 px-2.5 py-1.5 text-[10px] text-status-error">
          {error}
        </div>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto ${embedded ? "pb-16" : "p-2.5"}`}>
        {!stats ? (
          <div className="rounded-md border border-dashed border-border-secondary p-6 text-center text-xs text-text-tertiary">
            {loading ? "加载中" : "暂无可展示的用量数据"}
          </div>
        ) : (
          <ShareCard stats={stats} />
        )}
      </div>
    </div>
  );
}

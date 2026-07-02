import { BarChart3, Info, X } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import type { SessionStatus, ContextUsage, ContextUsageBreakdownId } from "../../types";

function formatTokens(tokens: number | null | undefined): string {
  if (tokens == null || tokens <= 0) return "--";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return `${tokens}`;
}

function formatStatTokens(tokens: number | null | undefined): string {
  if (tokens == null || tokens <= 0) return "0";
  return formatTokens(tokens);
}

function formatCost(cost: number | null | undefined): string {
  if (!cost || cost <= 0) return "$0";
  if (cost < 0.001) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

const GRID_CELL_COUNT = 100;

const BREAKDOWN_META: Record<
  ContextUsageBreakdownId | "remaining",
  { labelKey: string; className: string; barClassName: string }
> = {
  conversation: {
    labelKey: "conversation",
    className: "bg-semantic-accent",
    barClassName: "bg-semantic-accent",
  },
  thinking: {
    labelKey: "thinking",
    className: "bg-pink-400",
    barClassName: "bg-pink-400",
  },
  memory: {
    labelKey: "memory",
    className: "bg-semantic-memory",
    barClassName: "bg-semantic-memory",
  },
  system_base: {
    labelKey: "systemBase",
    className: "bg-semantic-agent",
    barClassName: "bg-semantic-agent",
  },
  rules: {
    labelKey: "rules",
    className: "bg-status-info",
    barClassName: "bg-status-info",
  },
  context_files: {
    labelKey: "contextFiles",
    className: "bg-status-success",
    barClassName: "bg-status-success",
  },
  skills: {
    labelKey: "skills",
    className: "bg-status-warning",
    barClassName: "bg-status-warning",
  },
  agents: {
    labelKey: "agents",
    className: "bg-semantic-agent",
    barClassName: "bg-semantic-agent",
  },
  tool_inputs: {
    labelKey: "toolInputs",
    className: "bg-orange-300",
    barClassName: "bg-orange-300",
  },
  tool_outputs: {
    labelKey: "toolOutputs",
    className: "bg-teal-300",
    barClassName: "bg-teal-300",
  },
  tools: {
    labelKey: "tools",
    className: "bg-semantic-tool",
    barClassName: "bg-semantic-tool",
  },
  mcp_tools: {
    labelKey: "mcpTools",
    className: "bg-semantic-notify",
    barClassName: "bg-semantic-notify",
  },
  lsp: {
    labelKey: "lsp",
    className: "bg-status-error",
    barClassName: "bg-status-error",
  },
  provider_system: {
    labelKey: "providerSystem",
    className: "bg-violet-400",
    barClassName: "bg-violet-400",
  },
  provider_messages: {
    labelKey: "providerMessages",
    className: "bg-cyan-300",
    barClassName: "bg-cyan-300",
  },
  provider_tools: {
    labelKey: "providerTools",
    className: "bg-amber-300",
    barClassName: "bg-amber-300",
  },
  provider_options: {
    labelKey: "providerOptions",
    className: "bg-slate-400",
    barClassName: "bg-slate-400",
  },
  unclassified: {
    labelKey: "unclassified",
    className: "bg-text-tertiary",
    barClassName: "bg-text-tertiary",
  },
  remaining: {
    labelKey: "remaining",
    className: "bg-bg-tertiary",
    barClassName: "bg-bg-tertiary",
  },
};

const BREAKDOWN_ORDER: ContextUsageBreakdownId[] = [
  "conversation",
  "thinking",
  "memory",
  "system_base",
  "rules",
  "context_files",
  "skills",
  "agents",
  "tool_inputs",
  "tool_outputs",
  "tools",
  "mcp_tools",
  "lsp",
  "provider_system",
  "provider_messages",
  "provider_tools",
  "provider_options",
  "unclassified",
];

const BREAKDOWN_GROUPS: Array<{
  id: string;
  labelKey: string;
  itemIds: ContextUsageBreakdownId[];
}> = [
  {
    id: "message_history",
    labelKey: "messageHistory",
    itemIds: [
      "conversation",
      "thinking",
      "memory",
      "rules",
      "lsp",
      "tool_inputs",
      "tool_outputs",
      "provider_messages",
    ],
  },
  {
    id: "system_context",
    labelKey: "systemContext",
    itemIds: ["system_base", "context_files", "skills", "agents", "provider_system"],
  },
  {
    id: "tool_definitions",
    labelKey: "toolDefinitions",
    itemIds: ["tools", "mcp_tools", "provider_tools"],
  },
  {
    id: "provider_metadata",
    labelKey: "providerMetadata",
    itemIds: ["provider_options", "unclassified"],
  },
];

const STATUS_CONFIGS = {
  streaming: { strokeClass: "text-status-warning", animClass: "animate-pulse" },
  compacting: { strokeClass: "text-status-warning", animClass: "animate-pulse" },
  permission: { strokeClass: "text-status-error", animClass: "" },
  retrying: { strokeClass: "text-status-error", animClass: "animate-pulse" },
  idle: { strokeClass: "text-status-success", animClass: "" },
} as const;

function statusConfig(status: SessionStatus | undefined) {
  switch (status) {
    case "streaming":
    case "compacting":
      return STATUS_CONFIGS.streaming;
    case "permission":
      return STATUS_CONFIGS.permission;
    case "retrying":
      return STATUS_CONFIGS.retrying;
    case "idle":
    default:
      return STATUS_CONFIGS.idle;
  }
}

const ContextRing = memo(function ContextRing({
  percent,
  strokeClass,
  isWorking,
  contextLabel,
}: {
  percent: number;
  strokeClass: string;
  isWorking: boolean;
  contextLabel: string;
}) {
  const size = 18;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(percent, 0), 1);
  const offset = circumference - clamped * circumference;

  return (
    <svg
      width={size}
      height={size}
      className={`shrink-0 ${isWorking ? "animate-pulse" : ""} ${strokeClass}`}
      viewBox={`0 0 ${size} ${size}`}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={contextLabel}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-text-secondary"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
});

export const TokenStatusBar = memo(function TokenStatusBar({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation(["chat", "common"]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);

  const parentContext = useSessionStore((s) => s.sessionContextMap[sessionId]);
  const parentStatus = useSessionStore((s) => s.sessionStatusMap[sessionId]);
  const refreshSessionContext = useSessionStore((s) => s.refreshSessionContext);

  const subContext = useSubagentStore((s) =>
    activeSubId ? s.subagentContextMap[activeSubId] : undefined,
  );
  const subStatus = useSubagentStore((s) =>
    activeSubId ? s.subagentStatusMap[activeSubId] : undefined,
  );

  const effectiveSessionId = activeSubId ?? sessionId;
  const contextUsage: ContextUsage | undefined = activeSubId ? subContext : parentContext;
  const sessionStatus: SessionStatus | undefined = activeSubId ? subStatus : parentStatus;
  const sessionStats = useSessionStore((s) => s.sessionStatsMap[effectiveSessionId]);
  const refreshSessionStats = useSessionStore((s) => s.refreshSessionStats);

  const config = statusConfig(sessionStatus);
  const used = formatTokens(contextUsage?.tokens);
  const available = formatTokens(contextUsage?.contextWindow);

  let percent = 0;
  if (contextUsage?.tokens && contextUsage?.contextWindow > 0) {
    percent = contextUsage.tokens / contextUsage.contextWindow;
  }

  const isWorking =
    sessionStatus === "streaming" || sessionStatus === "compacting" || sessionStatus === "retrying";
  const breakdown = useMemo(() => {
    const items = contextUsage?.breakdown ?? [];
    const byId = new Map(items.map((item) => [item.id, item]));
    return BREAKDOWN_ORDER.map((id) => byId.get(id)).filter(
      (item): item is NonNullable<typeof item> => Boolean(item && item.tokens > 0),
    );
  }, [contextUsage?.breakdown]);
  const groupedBreakdown = useMemo(() => {
    const byId = new Map(breakdown.map((item) => [item.id, item]));
    return BREAKDOWN_GROUPS.map((group) => {
      const children = group.itemIds
        .map((id) => byId.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item && item.tokens > 0));
      const tokens = children.reduce((sum, item) => sum + item.tokens, 0);
      return { ...group, children, tokens };
    }).filter((group) => group.tokens > 0);
  }, [breakdown]);
  const conversation = contextUsage?.breakdown?.find((item) => item.id === "conversation");
  const providerRequest = contextUsage?.providerRequest;
  const topToolDefinitions = providerRequest?.toolDefinitions?.slice(0, 6) ?? [];
  const topToolInteractions = providerRequest?.toolInteractions?.slice(0, 6) ?? [];
  const breakdownTotal = breakdown.reduce((sum, item) => sum + item.tokens, 0);
  const usedTokens = contextUsage?.tokens ?? breakdownTotal;
  const contextWindow = contextUsage?.contextWindow ?? 0;
  const remainingTokens = Math.max(0, contextWindow - usedTokens);
  const tokensPerCell =
    contextWindow > 0 ? Math.max(1, Math.round(contextWindow / GRID_CELL_COUNT)) : 0;
  const gridCells = useMemo(() => {
    if (contextWindow <= 0) return [];
    const cells: Array<{ key: string; labelKey: string; className: string }> = [];
    for (const item of breakdown) {
      const count = Math.max(0, Math.round((item.tokens / contextWindow) * GRID_CELL_COUNT));
      const meta = BREAKDOWN_META[item.id];
      for (let i = 0; i < count; i++) {
        cells.push({ key: `${item.id}-${i}`, labelKey: meta.labelKey, className: meta.className });
      }
    }
    while (cells.length < GRID_CELL_COUNT) {
      cells.push({
        key: `remaining-${cells.length}`,
        labelKey: BREAKDOWN_META.remaining.labelKey,
        className: BREAKDOWN_META.remaining.className,
      });
    }
    return cells.slice(0, GRID_CELL_COUNT);
  }, [breakdown, contextWindow]);

  const handleToggleDetails = () => {
    const nextOpen = !detailsOpen;
    setDetailsOpen(nextOpen);
    if (nextOpen && !isRefreshing) {
      setIsRefreshing(true);
      Promise.all([refreshSessionContext(effectiveSessionId), refreshSessionStats(effectiveSessionId)])
        .catch(() => {})
        .finally(() => setIsRefreshing(false));
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <ContextRing
        percent={percent}
        strokeClass={config.strokeClass}
        isWorking={isWorking}
        contextLabel={t("tokenStatus.contextUsage", { percent: Math.round(percent * 100) })}
      />
      <span>{activeSubId ? t("tokenStatus.subagent") : t("tokenStatus.used")}</span>
      <span className="text-text-tertiary font-medium">{used}</span>
      {contextUsage?.contextWindow ? (
        <>
          <span className="text-text-secondary">/</span>
          <span>
            {t("tokenStatus.available")} {available}
          </span>
        </>
      ) : null}
      {sessionStats ? (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-text-tertiary">
          <span className="text-text-secondary">·</span>
          <span>{t("tokenStatus.cumulative")}</span>
          <span>
            {t("tokenStatus.sessionInput")}{" "}
            <span className="font-medium text-text-secondary">
              {formatStatTokens(sessionStats.tokens.input)}
            </span>
          </span>
          <span>
            {t("tokenStatus.sessionOutput")}{" "}
            <span className="font-medium text-text-secondary">
              {formatStatTokens(sessionStats.tokens.output)}
            </span>
          </span>
          <span>
            {t("tokenStatus.sessionCache")}{" "}
            <span className="font-medium text-text-secondary">
              {formatStatTokens(sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite)}
            </span>
          </span>
          <span className="font-medium text-text-secondary">{formatCost(sessionStats.cost)}</span>
          <span>
            {t("tokenStatus.sessionTools")}{" "}
            <span className="font-medium text-text-secondary">{sessionStats.toolCalls}</span>
          </span>
          <span>
            {t("tokenStatus.sessionMessages")}{" "}
            <span className="font-medium text-text-secondary">{sessionStats.totalMessages}</span>
          </span>
        </span>
      ) : null}
      {contextUsage ? (
        <>
          <button
            type="button"
            className="ml-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary sm:h-5 sm:w-5"
            aria-label={t("tokenStatus.breakdown")}
            title={t("tokenStatus.breakdown")}
            onClick={handleToggleDetails}
          >
            <Info className={`h-3.5 w-3.5 ${isRefreshing ? "animate-pulse" : ""}`} />
          </button>
          {detailsOpen ? (
            <div className="fixed inset-0 z-modal flex items-end justify-center bg-black/50 p-0 sm:items-center sm:px-4 sm:py-6">
              <div
                className="flex w-full flex-col overflow-hidden rounded-t-lg border border-border-primary bg-bg-elevated shadow-floating sm:max-h-[min(760px,92vh)] sm:max-w-3xl sm:rounded-lg"
                style={{ maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px))" }}
              >
                <div
                  className="flex items-center justify-between border-b border-border-primary px-4 py-3 sm:px-5 sm:py-4"
                  style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
                >
                  <div className="flex min-w-0 items-center gap-2 text-base font-semibold text-text-primary sm:text-lg">
                    <BarChart3 className="h-5 w-5 text-semantic-accent" />
                    <span className="truncate">{t("tokenStatus.capacityTitle")}</span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary sm:h-8 sm:w-8"
                    aria-label={t("close", { ns: "common" })}
                    onClick={() => setDetailsOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                    <div>
                      <div className="text-2xl font-semibold text-text-primary sm:text-2xl">
                        {formatTokens(usedTokens)}
                        <span className="text-sm font-normal text-text-tertiary sm:text-base">
                          {" "}
                          / {formatTokens(contextWindow)} · {Math.round(percent * 100)}%
                        </span>
                      </div>
                    </div>
                    {tokensPerCell > 0 ? (
                      <div className="text-xs text-text-tertiary">
                        {t("tokenStatus.tokensPerCell", { tokens: formatTokens(tokensPerCell) })}
                      </div>
                    ) : null}
                  </div>

                  {breakdown.length > 0 ? (
                    <>
                      <div
                        className="mb-4 grid gap-1 rounded-md bg-bg-primary p-3"
                        style={{ gridTemplateColumns: "repeat(20, minmax(0, 1fr))" }}
                      >
                        {gridCells.map((cell) => (
                          <div
                            key={cell.key}
                            title={t(`tokenStatus.breakdownItems.${cell.labelKey}`)}
                            className={`h-4 rounded sm:h-5 ${cell.className}`}
                          />
                        ))}
                      </div>

                      <div className="overflow-hidden rounded-lg border border-border-primary">
                        {groupedBreakdown.map((group) => {
                          const groupPercent =
                            contextWindow > 0 ? (group.tokens / contextWindow) * 100 : 0;
                          return (
                            <div
                              key={group.id}
                              className="border-b border-border-primary last:border-b-0"
                            >
                              <div className="grid grid-cols-[minmax(0,1fr)_72px_44px] items-center gap-x-3 gap-y-2 bg-bg-primary px-3 py-3 sm:grid-cols-[minmax(0,1fr)_100px_88px_56px] sm:px-4 sm:py-2.5">
                                <div className="min-w-0 text-sm font-semibold text-text-primary">
                                  <span className="truncate">
                                    {t(`tokenStatus.breakdownGroups.${group.labelKey}`)}
                                  </span>
                                </div>
                                <div className="order-4 col-span-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary sm:order-none sm:col-span-1">
                                  <div
                                    className="h-full rounded-full bg-semantic-accent"
                                    style={{ width: `${Math.min(100, groupPercent)}%` }}
                                  />
                                </div>
                                <div className="text-right text-sm font-semibold text-text-primary">
                                  {formatTokens(group.tokens)}
                                </div>
                                <div className="text-right text-sm text-text-tertiary">
                                  {Math.round(groupPercent)}%
                                </div>
                              </div>
                              {group.children.map((item) => {
                                const meta = BREAKDOWN_META[item.id];
                                const itemPercent =
                                  contextWindow > 0 ? (item.tokens / contextWindow) * 100 : 0;
                                return (
                                  <div key={item.id} className="border-t border-border-primary/70">
                                    <div className="grid grid-cols-[minmax(0,1fr)_72px_44px] items-center gap-x-3 gap-y-2 px-3 py-2.5 pl-6 sm:grid-cols-[minmax(0,1fr)_100px_88px_56px] sm:px-4 sm:py-2 sm:pl-8">
                                      <div className="flex min-w-0 items-center gap-2 text-sm text-text-secondary">
                                        <span
                                          className={`h-3 w-3 shrink-0 rounded ${meta.className}`}
                                        />
                                        <span className="truncate">
                                          {t(`tokenStatus.breakdownItems.${meta.labelKey}`)}
                                        </span>
                                      </div>
                                      <div className="order-4 col-span-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary sm:order-none sm:col-span-1">
                                        <div
                                          className={`h-full rounded-full ${meta.barClassName}`}
                                          style={{ width: `${Math.min(100, itemPercent)}%` }}
                                        />
                                      </div>
                                      <div className="text-right text-sm font-semibold text-text-primary">
                                        {formatTokens(item.tokens)}
                                      </div>
                                      <div className="text-right text-sm text-text-tertiary">
                                        {Math.round(itemPercent)}%
                                      </div>
                                    </div>
                                    {item.details && item.details.length > 0 ? (
                                      <div className="space-y-1 pb-2 pl-10 pr-3 sm:pl-12 sm:pr-4">
                                        {item.details.map((detail) => (
                                          <div
                                            key={detail.label}
                                            className="grid grid-cols-[minmax(0,1fr)_72px] gap-3 text-xs text-text-tertiary sm:grid-cols-[minmax(0,1fr)_88px]"
                                          >
                                            <span className="truncate">{detail.label}</span>
                                            <span className="text-right font-medium">
                                              {formatTokens(detail.tokens)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                        <div className="grid grid-cols-[minmax(0,1fr)_72px_44px] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_100px_88px_56px] sm:px-4 sm:py-2.5">
                          <div className="flex min-w-0 items-center gap-2 text-sm text-text-secondary">
                            <span
                              className={`h-4 w-4 shrink-0 rounded ${BREAKDOWN_META.remaining.className}`}
                            />
                            <span className="truncate">
                              {t("tokenStatus.breakdownItems.remaining")}
                            </span>
                          </div>
                          <div className="order-4 col-span-3 h-1.5 overflow-hidden rounded-full bg-bg-tertiary sm:order-none sm:col-span-1">
                            <div
                              className={`h-full rounded-full ${BREAKDOWN_META.remaining.barClassName}`}
                              style={{
                                width: `${Math.min(100, contextWindow > 0 ? (remainingTokens / contextWindow) * 100 : 0)}%`,
                              }}
                            />
                          </div>
                          <div className="text-right text-sm font-semibold text-text-primary">
                            {formatTokens(remainingTokens)}
                          </div>
                          <div className="text-right text-sm text-text-tertiary">
                            {Math.round(
                              contextWindow > 0 ? (remainingTokens / contextWindow) * 100 : 0,
                            )}
                            %
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-border-primary bg-bg-primary px-4 py-5 text-sm text-text-tertiary">
                      {isRefreshing
                        ? t("tokenStatus.refreshingBreakdown")
                        : t("tokenStatus.breakdownUnavailable")}
                    </div>
                  )}

                  {conversation?.compaction ? (
                    <div className="mt-4 rounded-lg border border-border-primary bg-bg-primary px-4 py-3 text-sm text-text-secondary">
                      {t("tokenStatus.compaction", {
                        count: conversation.compaction.count,
                        saved: formatTokens(conversation.compaction.estimatedSavedTokens),
                      })}
                    </div>
                  ) : null}

                  {providerRequest ? (
                    <div className="mt-4 overflow-hidden rounded-lg border border-border-primary bg-bg-primary">
                      <div className="flex items-center justify-between gap-3 border-b border-border-primary px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-text-primary">
                            {t("tokenStatus.providerSnapshot")}
                          </div>
                          <div className="truncate text-xs text-text-tertiary">
                            {providerRequest.provider} · {providerRequest.modelId}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-sm font-semibold text-text-primary">
                          {formatTokens(providerRequest.payloadTokens)}
                        </div>
                      </div>
                      {providerRequest.sections.map((section) => (
                        <div
                          key={section.id}
                          className="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-3 border-b border-border-primary px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_80px_80px] sm:py-2"
                        >
                          <div className="min-w-0 text-sm text-text-secondary">
                            <span className="truncate">
                              {t(`tokenStatus.providerSections.${section.id}`)}
                            </span>
                          </div>
                          <div className="hidden text-right text-xs text-text-tertiary sm:block">
                            {section.count != null
                              ? t("tokenStatus.providerCount", { count: section.count })
                              : "--"}
                          </div>
                          <div className="text-right text-sm font-semibold text-text-primary">
                            {formatTokens(section.tokens)}
                          </div>
                        </div>
                      ))}
                      {topToolDefinitions.length > 0 ? (
                        <div className="border-t border-border-primary px-4 py-3">
                          <div className="mb-2 text-xs font-semibold uppercase text-text-tertiary">
                            {t("tokenStatus.providerToolDefinitions")}
                          </div>
                          <div className="space-y-1.5">
                            {topToolDefinitions.map((tool) => (
                              <div
                                key={tool.name}
                                className="grid grid-cols-[minmax(0,1fr)_72px] gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_80px]"
                              >
                                <span className="truncate text-text-secondary">{tool.name}</span>
                                <span className="text-right font-semibold text-text-primary">
                                  {formatTokens(tool.tokens)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {topToolInteractions.length > 0 ? (
                        <div className="border-t border-border-primary px-4 py-3">
                          <div className="mb-2 text-xs font-semibold uppercase text-text-tertiary">
                            {t("tokenStatus.providerToolIO")}
                          </div>
                          <div className="space-y-1.5">
                            {topToolInteractions.map((tool) => (
                              <div
                                key={tool.name}
                                className="grid grid-cols-[minmax(0,1fr)_64px_64px] gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_72px_72px]"
                              >
                                <span className="truncate text-text-secondary">{tool.name}</span>
                                <span
                                  className="text-right text-text-tertiary"
                                  title={t("tokenStatus.providerToolInputAvg", {
                                    avg: formatTokens(tool.avgInputTokens),
                                  })}
                                >
                                  {formatTokens(tool.inputTokens)}
                                </span>
                                <span
                                  className="text-right font-semibold text-text-primary"
                                  title={t("tokenStatus.providerToolOutputAvg", {
                                    avg: formatTokens(tool.avgOutputTokens),
                                  })}
                                >
                                  {formatTokens(tool.outputTokens)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div
                  className="flex flex-col gap-1 border-t border-border-primary px-4 py-3 text-xs text-text-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
                >
                  <span>
                    {contextWindow > 0
                      ? t("tokenStatus.contextWindowLabel", { tokens: formatTokens(contextWindow) })
                      : t("tokenStatus.capacityTitle")}
                  </span>
                  <span>{t("tokenStatus.cellHint")}</span>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
});

import { useCallback, memo, useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Target,
  ThumbsDown,
  Zap,
} from "lucide-react";

import { useSessionStore } from "../../stores/use-session-store";
import { useMemoryStore } from "../../stores/use-memory-store";
import { formatFilePath } from "../../lib/format-path";
import { getCustomTypeIcon } from "./tool-icon-map";
import {
  ENTRY_TYPE_KEYS,
  getMemoryConfig,
  getMemorySummary,
  parseSnippetToEntries,
} from "./memory-config";
import { formatDuration } from "./primitives/formatDuration";
import { ContextReferenceCard, type ContextReference } from "./ContextReferenceCard";
import {
  CHAT_COMPACT_BLOCK_CLASS,
  CHAT_COMPACT_ROW_BUTTON_BASE_CLASS,
} from "./chat-layout-classes";

export const MEMORY_CUSTOM_TYPES = ENTRY_TYPE_KEYS;

function getSearchingSummary(data: unknown): string | null {
  const d = data as Record<string, unknown> | undefined;
  if (!d) return "搜索中…";
  if (d._timedOut) return "搜索超时";
  const q = typeof d.query === "string" ? d.query : "";
  if (!q) return "搜索中…";
  return `「${q.length > 40 ? q.slice(0, 40) + "…" : q}」搜索中…`;
}

function extractTierInfo(data: unknown): { tier: string; model?: string } | null {
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;
  const tier = typeof d.tier === "string" ? d.tier : undefined;
  const model = typeof d.model === "string" ? d.model : undefined;
  if (!tier && !model) return null;
  return { tier: tier ?? "", model };
}

function TierBadge({ tier }: { tier: string }) {
  if (!tier) return null;
  const config: Record<string, { style: string; Icon: ComponentType<{ className?: string }> }> = {
    fast: {
      style: "bg-status-warning/[0.12] text-status-warning border-status-warning/25",
      Icon: Zap,
    },
    pro: {
      style: "bg-semantic-accent/[0.12] text-semantic-accent border-semantic-accent/25",
      Icon: Target,
    },
    max: {
      style: "bg-semantic-agent/[0.12] text-semantic-agent border-semantic-agent/25",
      Icon: Brain,
    },
  };
  const cfg = config[tier];
  if (!cfg) return null;
  const { Icon } = cfg;

  return (
    <span
      className={`ml-1 flex items-center gap-0.5 text-[10px] px-1.5 py-px rounded font-medium shrink-0 border ${cfg.style}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {tier}
    </span>
  );
}

function PrefetchSearchingDetail({ data }: { data: unknown }) {
  const { t } = useTranslation("chat");
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;
  const query = typeof d.query === "string" ? d.query : "";
  const availableFiles = typeof d.availableFiles === "number" ? d.availableFiles : 0;
  const timedOut = d._timedOut === true;

  return (
    <div className="px-3 pb-2 text-[11px] space-y-2">
      <div
        className={`flex items-center gap-1.5 ${timedOut ? "text-status-warning" : "text-status-info"}`}
      >
        {timedOut ? (
          <AlertCircle className="w-3 h-3 shrink-0" />
        ) : (
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        )}
        <span>{timedOut ? t("memorySearchTimedOut") : t("searchingMemory")}</span>
      </div>
      {query && (
        <div className="flex gap-1.5">
          <span className="text-text-tertiary shrink-0">{t("searchQuery")}</span>
          <span className="text-text-secondary">「{query}」</span>
        </div>
      )}
      {availableFiles > 0 && (
        <div className="flex gap-1.5">
          <span className="text-text-tertiary shrink-0">{t("availableFilesLabel")}</span>
          <span className="text-text-secondary">{t("filesCount", { count: availableFiles })}</span>
        </div>
      )}
    </div>
  );
}

export const MemoryCard = memo(function MemoryCard({
  customType,
  data,
  blockId,
  isEntry: _isEntry,
  mergedResultData,
}: {
  customType: string;
  data: unknown;
  blockId: string;
  isEntry?: boolean;
  mergedResultData?: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation("chat");

  const isMerged = customType === "memory_prefetch" && mergedResultData !== undefined;
  const isSearching = customType === "memory_prefetch" && mergedResultData === undefined;

  const displayType = isMerged ? "memory_prefetch_result" : customType;
  const displayData = isMerged ? mergedResultData : data;

  const config = getMemoryConfig(displayType) ?? {
    label: displayType,
    color: "text-text-tertiary",
  };
  const Icon = getCustomTypeIcon(displayType).icon;

  const summary = isSearching
    ? getSearchingSummary(data)
    : getMemorySummary(displayType, displayData);

  const tierInfo = extractTierInfo(displayData);

  const sessionId = useSessionStore.getState().activeSessionId;
  const prefetchSelectedFiles = Array.isArray(
    (displayData as Record<string, unknown>)?.selectedFiles,
  )
    ? ((displayData as Record<string, unknown>).selectedFiles as string[])
    : [];
  const isMarked = sessionId
    ? useMemoryStore.getState().isIrrelevantMarked(sessionId, blockId)
    : false;
  const canMarkIrrelevant =
    displayType === "memory_prefetch_result" && prefetchSelectedFiles.length > 0;

  const handleMarkIrrelevant = useCallback(() => {
    if (!sessionId || isMarked) return;
    const d = displayData as Record<string, unknown> | undefined;
    const query =
      typeof d?._prefetchQuery === "string"
        ? d._prefetchQuery
        : typeof d?.query === "string"
          ? d.query
          : "";
    const selectedFiles = Array.isArray(d?.selectedFiles) ? (d.selectedFiles as string[]) : [];
    if (!query || selectedFiles.length === 0) return;
    useMemoryStore.getState().markIrrelevant(sessionId, blockId, query, selectedFiles);
  }, [sessionId, blockId, displayData, isMarked]);

  return (
    <div className={CHAT_COMPACT_BLOCK_CLASS} data-block-id={blockId}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`${CHAT_COMPACT_ROW_BUTTON_BASE_CLASS} ${config.color} hover:bg-surface-hover/15 dark:hover:bg-surface-dim/15`}
        aria-expanded={expanded}
        aria-label={`${config.label}${summary ? `: ${summary}` : ""}`}
      >
        <Icon className="w-3 h-3 shrink-0" />
        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="font-medium whitespace-nowrap">{config.label}</span>
          {summary && <span className="text-text-tertiary truncate">{summary}</span>}
        </span>
        {tierInfo && <TierBadge tier={tierInfo.tier} />}
        {canMarkIrrelevant && !isMarked && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              handleMarkIrrelevant();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                handleMarkIrrelevant();
              }
            }}
            className="shrink-0 flex items-center rounded hover:bg-semantic-notify/20 text-text-tertiary hover:text-semantic-notify transition-colors cursor-pointer"
            title={t("markIrrelevant")}
          >
            <ThumbsDown className="w-3 h-3" />
          </span>
        )}
        {isMarked && (
          <span
            className="shrink-0 flex items-center text-semantic-notify/70"
            title={t("alreadyMarkedIrrelevant")}
          >
            <ThumbsDown className="w-3 h-3" />
          </span>
        )}
        {typeof (displayData as Record<string, unknown>)?.durationMs === "number" &&
          ((displayData as Record<string, unknown>).durationMs as number) > 0 && (
            <span className="shrink-0 text-[10px] text-text-tertiary/50 tabular-nums">
              {formatDuration((displayData as Record<string, unknown>).durationMs as number)}
            </span>
          )}
        <span className="text-text-tertiary shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      {expanded &&
        (isSearching ? (
          <PrefetchSearchingDetail data={data} />
        ) : (
          <MemoryExpandedContent
            customType={displayType}
            data={displayData}
            isMarkedIrrelevant={isMarked}
          />
        ))}
    </div>
  );
});

function MemoryExpandedContent({
  customType,
  data,
  isMarkedIrrelevant,
}: {
  customType: string;
  data: unknown;
  isMarkedIrrelevant?: boolean;
}) {
  if (customType === "memory_prefetch_result" || customType === "memory_inject") {
    return <PrefetchResultDetail data={data} isMarkedIrrelevant={isMarkedIrrelevant} />;
  }
  if (customType === "memory_prefetch") {
    return <PrefetchStartDetail data={data} />;
  }
  if (customType === "memory_extract") {
    return <ExtractDetail data={data} />;
  }
  const dataStr = typeof data === "string" ? data : data ? JSON.stringify(data, null, 2) : "";
  if (!dataStr) return null;
  return (
    <pre className="px-3 pb-1 text-[11px] text-text-tertiary overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
      {dataStr.length > 500 ? dataStr.slice(0, 500) + "…" : dataStr}
    </pre>
  );
}

function ExtractDetail({ data }: { data: unknown }) {
  type FileEntry = { filename: string; name: string; description: string };
  const d = data as { created?: unknown[]; updated?: unknown[]; status?: string } | undefined;
  const created = (d?.created ?? []) as unknown[];
  const updated = (d?.updated ?? []) as unknown[];
  const isEnriched = (arr: unknown[]): arr is FileEntry[] =>
    arr.length > 0 &&
    typeof (arr[0] as Record<string, unknown>)?.filename === "string" &&
    typeof (arr[0] as Record<string, unknown>)?.name === "string";

  if (!isEnriched(created) && !isEnriched(updated)) {
    const dataStr = data ? JSON.stringify(data, null, 2) : "";
    if (!dataStr) return null;
    return (
      <pre className="px-3 pb-1 text-[11px] text-text-tertiary overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
        {dataStr.length > 500 ? dataStr.slice(0, 500) + "…" : dataStr}
      </pre>
    );
  }

  return (
    <div className="px-3 pb-1.5 flex flex-col gap-1">
      {(created as FileEntry[]).length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-status-success/80 mb-0.5">新建</div>
          {(created as FileEntry[]).map((f, i) => (
            <div key={i} className="text-[11px] text-text-tertiary flex gap-1 items-start">
              <FileText className="w-3 h-3 mt-0.5 shrink-0 text-status-success/60" />
              <span className="min-w-0">
                <span className="font-medium text-text-secondary">{f.name}</span>
                {f.description && <span className="text-text-tertiary"> — {f.description}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {(updated as FileEntry[]).length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-status-warning/80 mb-0.5">更新</div>
          {(updated as FileEntry[]).map((f, i) => (
            <div key={i} className="text-[11px] text-text-tertiary flex gap-1 items-start">
              <FileText className="w-3 h-3 mt-0.5 shrink-0 text-status-warning/60" />
              <span className="min-w-0">
                <span className="font-medium text-text-secondary">{f.name}</span>
                {f.description && <span className="text-text-tertiary"> — {f.description}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PrefetchResultDetail({
  data,
  isMarkedIrrelevant,
}: {
  data: unknown;
  isMarkedIrrelevant?: boolean;
}) {
  const { t } = useTranslation("chat");
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;

  const snippet = typeof d.snippet === "string" ? d.snippet : "";
  const selectedFiles = Array.isArray(d.selectedFiles) ? (d.selectedFiles as string[]) : [];
  const injectedBytes = typeof d.injectedBytes === "number" ? d.injectedBytes : 0;
  const durationMs = typeof d.durationMs === "number" ? d.durationMs : 0;
  const layer = typeof d.layer === "string" ? d.layer : "unknown";
  const rawSkipHits = d.skipHits;
  const rawGuardHits = d.guardHits;
  const rawTriggerHits = d.triggerHits;
  const isForce = d.isForce === true;
  const availableFiles = typeof d.availableFiles === "number" ? d.availableFiles : 0;
  const query = typeof d.query === "string" ? d.query : "";
  const tier = typeof d.tier === "string" ? d.tier : "";
  const modelLabel = typeof d.model === "string" ? d.model : "";

  const skipHits = Array.isArray(rawSkipHits)
    ? (rawSkipHits as Array<Record<string, string>>).map((h) =>
        typeof h === "string"
          ? { pattern: h, mode: "" }
          : { pattern: h.pattern ?? "", mode: h.mode ?? "" },
      )
    : [];
  const guardHits = Array.isArray(rawGuardHits)
    ? (rawGuardHits as Array<Record<string, string>>).map((h) =>
        typeof h === "string"
          ? { pattern: h, mode: "" }
          : { pattern: h.pattern ?? "", mode: h.mode ?? "" },
      )
    : [];
  const triggerHits = Array.isArray(rawTriggerHits)
    ? (rawTriggerHits as Array<Record<string, string>>).map((h) =>
        typeof h === "string"
          ? { pattern: h, mode: "" }
          : { pattern: h.pattern ?? "", mode: h.mode ?? "" },
      )
    : [];

  const hasMemory = snippet || selectedFiles.length > 0;
  const selectedFileReferences: ContextReference[] = selectedFiles.map((file, index) => ({
    id: `memory-file:${file}:${index}`,
    kind: "memory",
    title: file.split("/").pop() || file,
    subtitle: formatFilePath(file),
    path: file,
    status: "used",
  }));

  const memoryCount = snippet ? (snippet.match(/^###/gm)?.length ?? 1) : selectedFiles.length;
  const tokenCount = injectedBytes > 0 ? Math.round(injectedBytes / 4) : 0;

  const modeLabel = (mode: string) => {
    switch (mode) {
      case "exact":
        return t("exactMatch");
      case "prefix":
        return t("prefixMatch");
      case "contains":
        return t("containsMatch");
      case "regex":
        return t("regexMatch");
      default:
        return "";
    }
  };

  return (
    <div className="px-3 pb-2 text-[11px] space-y-1.5">
      {!hasMemory && <div className="text-text-tertiary italic py-1">{t("noRelevantMemory")}</div>}

      {snippet && (
        <div className="space-y-0.5">
          <div className="text-text-tertiary flex items-center gap-1 font-medium">
            <Brain className="w-3 h-3 text-status-info/60 shrink-0" />
            <span>{t("relatedMemory")}</span>
            <span className="text-text-tertiary ml-auto">
              {memoryCount}{" "}
              {t("memoryCountTokens", {
                count: memoryCount,
                tokens: tokenCount,
                size: Math.round(injectedBytes / 1024),
              })}
            </span>
          </div>
          {(() => {
            const entries = parseSnippetToEntries(snippet);
            if (entries.length > 0) {
              return (
                <div className="space-y-1 p-2 bg-surface-code/80 dark:bg-surface-dim/40 rounded border border-border-secondary/50 dark:border-border-secondary/30 max-h-48 overflow-y-auto">
                  {entries.map((entry, i) => (
                    <div key={i} className="flex gap-1.5 items-start">
                      <FileText className="w-3 h-3 mt-0.5 shrink-0 text-status-info/60" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-text-primary truncate">
                            {entry.name}
                          </span>
                          {entry.type && (
                            <span className="text-[9px] px-1 rounded bg-status-info/10 text-status-info shrink-0">
                              {entry.type}
                            </span>
                          )}
                        </div>
                        {entry.content && (
                          <div className="text-[10px] text-text-secondary leading-relaxed mt-0.5 line-clamp-4 whitespace-pre-wrap">
                            {entry.content.length > 200
                              ? entry.content.slice(0, 200) + "..."
                              : entry.content}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            }
            return (
              <pre className="p-2 bg-surface-code/80 dark:bg-surface-dim/40 rounded text-[11px] text-text-secondary overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-border-secondary/50 dark:border-border-secondary/30">
                {snippet}
              </pre>
            );
          })()}
        </div>
      )}

      {!snippet && selectedFiles.length > 0 && (
        <div className="text-text-tertiary italic py-0.5">
          {t("retrievedMemoryFiles", { count: selectedFiles.length })}
          {injectedBytes > 0 && (
            <span className="text-text-tertiary ml-auto">
              ~{Math.round(injectedBytes / 4)} tokens
            </span>
          )}
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer text-text-tertiary hover:text-text-secondary dark:hover:text-text-tertiary flex items-center gap-1 py-0.5 text-[10px]">
          <ChevronRight className="w-2.5 h-2.5 group-open:rotate-90 transition-transform" />
          {t("searchDetail")}
        </summary>
        <div className="mt-1 space-y-1.5 pl-1 text-[10px] text-text-tertiary">
          {query && (
            <div className="text-text-tertiary">
              {t("searchQuery")} <span className="text-text-secondary">「{query}」</span>
            </div>
          )}

          <div className="space-y-0.5">
            {layer === "not_triggered" && (
              <div className="text-text-tertiary">{t("notTriggered")}</div>
            )}
            {layer === "skip" && <div className="text-status-warning/80">{t("skipLayer")}</div>}
            {layer === "llm" && isForce && (
              <div className="text-status-error/80">{t("forceTrigger")}</div>
            )}
            {layer === "llm" && !isForce && (
              <div className="text-status-info/80">{t("keywordTrigger")}</div>
            )}
            {layer === "none" && <div className="text-text-tertiary">{t("noMemoryFiles")}</div>}
            {layer === "error" && <div className="text-status-error/80">{t("searchError")}</div>}
            {layer !== "skip" &&
              layer !== "llm" &&
              layer !== "not_triggered" &&
              layer !== "none" && (
                <div className="text-text-tertiary">{t("matchMethod", { method: layer })}</div>
              )}
          </div>

          {skipHits.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-status-warning/80">{t("skipRuleHit")}</div>
              {skipHits.map((h, i) => (
                <div key={i} className="pl-2 flex items-center gap-1.5">
                  <span className="text-status-warning/60">•</span>
                  <span className="text-text-secondary font-mono">「{h.pattern}」</span>
                  {h.mode && <span className="text-text-tertiary">({modeLabel(h.mode)})</span>}
                </div>
              ))}
            </div>
          )}

          {guardHits.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-status-success/80">{t("guardRuleHit")}</div>
              {guardHits.map((h, i) => (
                <div key={i} className="pl-2 flex items-center gap-1.5">
                  <span className="text-status-success/60">•</span>
                  <span className="text-text-secondary font-mono">「{h.pattern}」</span>
                  {h.mode && <span className="text-text-tertiary">({modeLabel(h.mode)})</span>}
                </div>
              ))}
            </div>
          )}

          {triggerHits.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-semantic-tool/80">{t("triggerKeywords")}</div>
              {triggerHits.map((h, i) => (
                <div key={i} className="pl-2 flex items-center gap-1.5">
                  <span className="text-semantic-tool/60">•</span>
                  <span className="text-text-secondary font-mono">「{h.pattern}」</span>
                  {h.mode && <span className="text-text-tertiary">({modeLabel(h.mode)})</span>}
                </div>
              ))}
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-text-tertiary flex items-center gap-1">
                {t("sourceFiles", { count: selectedFiles.length })}
              </div>
              <ContextReferenceCard references={selectedFileReferences} />
            </div>
          )}

          <div className="space-y-0.5">
            {availableFiles > 0 && (
              <div className="text-text-tertiary">
                {t("availableFiles", { count: availableFiles })}
              </div>
            )}
            {durationMs > 0 && (
              <div className="text-text-tertiary">
                {t("searchDuration", { duration: durationMs })}
              </div>
            )}
            {tier && (
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 shrink-0 text-status-warning/70" />
                <span className="text-text-tertiary">{t("usedModel")}</span>
                <span className="text-text-secondary">{modelLabel || tier}</span>
                {tier && modelLabel && <span className="text-text-secondary">({tier})</span>}
              </div>
            )}
          </div>
        </div>
      </details>

      {isMarkedIrrelevant && (
        <div className="flex items-center gap-1.5 text-[10px] text-semantic-notify/80 py-1 px-1">
          <ThumbsDown className="w-3 h-3 shrink-0" />
          <span>{t("markedIrrelevantHint")}</span>
        </div>
      )}
    </div>
  );
}

function PrefetchStartDetail({ data }: { data: unknown }) {
  const { t } = useTranslation("chat");
  const d = data as Record<string, unknown> | undefined;
  if (!d) return null;
  const query = typeof d.query === "string" ? d.query : "";
  const availableFiles = typeof d.availableFiles === "number" ? d.availableFiles : 0;

  return (
    <div className="px-3 pb-2 text-[11px] space-y-1">
      {query && (
        <div className="flex gap-1.5">
          <span className="text-text-tertiary shrink-0">{t("queryLabel")}</span>
          <span className="text-text-secondary truncate">{query}</span>
        </div>
      )}
      <div className="flex gap-1.5">
        <span className="text-text-tertiary shrink-0">{t("availableFilesLabel")}</span>
        <span className="text-text-secondary">{t("filesCount", { count: availableFiles })}</span>
      </div>
    </div>
  );
}

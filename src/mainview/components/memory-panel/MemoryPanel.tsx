import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Search,
  FileText,
  ChevronDown,
  ChevronRight,
  History,
  Shield,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMemoryStore } from "../../stores/use-memory-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useShallow } from "zustand/react/shallow";
import { apiClient } from "../../lib/api-client";
import { ALL_MEMORY_TYPES, getMemorySummary, parseSnippetToEntries } from "../chat/memory-config";
import type { MemoryTypeConfig } from "../chat/memory-config";
import { createLogger } from "../../../shared/lib/logger";

const log = createLogger("memory");

const TYPE_BADGES: Record<string, { labelKey: string; cls: string }> = {
  project: { labelKey: "typeProject", cls: "bg-status-success/15 text-status-success" },
  user: { labelKey: "typeUser", cls: "bg-semantic-accent/15 text-semantic-accent" },
  feedback: { labelKey: "typeFeedback", cls: "bg-status-warning/15 text-status-warning" },
  reference: { labelKey: "typeReference", cls: "bg-status-info/15 text-status-info" },
};

const EVENT_FALLBACK: MemoryTypeConfig = { icon: Brain, label: "", color: "text-text-tertiary" };

function getEventIcon(customType: string) {
  return ALL_MEMORY_TYPES[customType] ?? EVENT_FALLBACK;
}

function SectionHeader({
  collapsed,
  onToggle,
  icon: Icon,
  iconCls,
  label,
  badge,
}: {
  collapsed: boolean;
  onToggle: () => void;
  icon: React.ElementType;
  iconCls?: string;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover/50 dark:hover:bg-surface-dim/30 transition-colors"
    >
      {collapsed ? (
        <ChevronRight className="w-3 h-3 shrink-0" />
      ) : (
        <ChevronDown className="w-3 h-3 shrink-0" />
      )}
      <Icon className={`w-3 h-3 shrink-0 ${iconCls ?? ""}`} />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto text-[9px] text-text-secondary">{badge}</span>
      )}
    </button>
  );
}

function FileContentPreview({ filePath }: { filePath: string }) {
  const { t } = useTranslation("memory");
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .call("memory.readFile", { filePath })
      .then((result) => {
        if (!cancelled) {
          setContent((result as { content: string }).content);
          setLoading(false);
        }
      })
      .catch((err) => {
        log.warn("memory file load failed", { error: String(err) });
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (loading) {
    return <div className="px-3 py-1.5 text-[10px] text-text-tertiary">{t("loading")}</div>;
  }
  if (!content) {
    return <div className="px-3 py-1.5 text-[10px] text-text-tertiary">{t("cannotRead")}</div>;
  }
  return (
    <pre className="mx-2 mb-1.5 p-2 rounded bg-surface-code dark:bg-surface-code/80 border border-border-secondary dark:border-surface-code text-[10px] text-text-secondary overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
      {content.length > 2000 ? content.slice(0, 2000) + "..." : content}
    </pre>
  );
}

export function MemoryPanel() {
  const { t } = useTranslation("memory");
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);

  const events = useMemoryStore(useShallow((s) => s.eventsBySession[sessionId ?? ""] ?? []));
  const files = useMemoryStore(useShallow((s) => s.filesBySession[sessionId ?? ""] ?? []));
  const entrypoint = useMemoryStore((s) => (sessionId ? s.entrypointBySession[sessionId] : null));
  const injected = useMemoryStore(
    useShallow((s) => (sessionId ? s.injectedBySession[sessionId] || [] : [])),
  );
  const expandedFile = useMemoryStore(
    useCallback(
      (s) => (sessionId ? (s.expandedFileBySession[sessionId] ?? null) : null),
      [sessionId],
    ),
  );
  const collapsedSections = useMemoryStore((s) => s.collapsedSections);
  const toggleSection = useMemoryStore((s) => s.toggleSection);
  const setExpandedFile = useMemoryStore((s) => s.setExpandedFile);

  const loadFiles = useMemoryStore((s) => s.loadFiles);
  const memoryStatus = useMemoryStore(
    useShallow((s) => (sessionId ? s.statusBySession[sessionId] : null)),
  );
  const loadStatus = useMemoryStore((s) => s.loadStatus);
  const removeRuleAction = useMemoryStore((s) => s.removeRule);
  const [builtinExpanded, setBuiltinExpanded] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    loadStatus(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const tab = projectTabs.find((tab) => tab.id === activeProjectId);
    if (!tab) return;
    loadFiles(tab.path, sessionId);
  }, [sessionId, activeProjectId, projectTabs]);

  if (!sessionId) {
    return <div className="p-3 text-xs text-text-tertiary">{t("noActiveSession")}</div>;
  }

  const hasInjected = injected.length > 0;
  const hasFiles = files.length > 0;
  const hasEntrypoint = !!entrypoint;
  const hasEvents = events.length > 0;

  const last10Events = [...events].reverse().slice(0, 10);

  function getEventDetail(customType: string, data: unknown): React.ReactNode {
    if (customType === "memory_extract") {
      type FileEntry = { filename: string; name: string; description: string };
      const d = data as { created?: unknown[]; updated?: unknown[] } | undefined;
      const all: FileEntry[] = [];
      for (const arr of [d?.created ?? [], d?.updated ?? []]) {
        for (const item of arr) {
          const entry = item as Record<string, unknown>;
          if (typeof entry.filename === "string" && typeof entry.name === "string") {
            all.push({
              filename: entry.filename,
              name: entry.name,
              description: (entry.description as string) ?? "",
            });
          }
        }
      }
      if (all.length === 0) return null;
      return (
        <div className="flex flex-col gap-0.5 mt-0.5">
          {all.map((f, i) => (
            <span
              key={i}
              className="text-[9px] text-status-success/70 truncate max-w-[160px]"
              title={f.description || f.filename}
            >
              {f.name}
              {f.description ? `: ${f.description.slice(0, 40)}` : ""}
            </span>
          ))}
        </div>
      );
    }
    if (customType === "memory_updated") {
      const d = data as { files?: Array<{ filename: string }> } | undefined;
      const fileList = d?.files ?? [];
      return fileList.length > 0 ? (
        <span className="text-[9px] text-text-tertiary truncate max-w-[120px]">
          {fileList.map((f) => f.filename).join(", ")}
        </span>
      ) : null;
    }
    if (customType === "memory_prefetch_result") {
      const d = data as
        | { durationMs?: number; layer?: string; selectedFiles?: string[] }
        | undefined;
      const parts: string[] = [];
      if (d?.layer) parts.push(d.layer);
      if (d?.selectedFiles?.length) parts.push(`${d.selectedFiles.length} files`);
      if (d?.durationMs != null) parts.push(`${d.durationMs}ms`);
      return parts.length > 0 ? (
        <span className="text-[9px] text-text-tertiary">{parts.join(" · ")}</span>
      ) : null;
    }
    if (customType === "memory_irrelevant_marked") {
      const d = data as { selectedFiles?: string[] } | undefined;
      const files = d?.selectedFiles ?? [];
      return files.length > 0 ? (
        <span className="text-[9px] text-semantic-notify/70 truncate max-w-[120px]">
          {files.map((f) => f.split("/").pop() ?? f).join(", ")}
        </span>
      ) : null;
    }
    return null;
  }

  const relativeTimeStr = (ms: number): string => {
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("justNow");
    if (mins < 60) return t("minutesAgo", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    return t("daysAgo", { count: days });
  };

  const getBadgeLabel = (type: string): string => {
    const badge = TYPE_BADGES[type];
    return badge ? t(badge.labelKey) : t("typeOther");
  };

  const getEventLabel = (customType: string, data: unknown): string => {
    const panelLabels: Record<string, string> = {
      memory_prefetch: t("searchMemory"),
      memory_prefetch_result: t("memoryMatch"),
      memory_extract: t("saveMemory"),
      memory_extract_result: t("extractResult"),
      memory_dream: t("organizeMemory"),
      memory_dream_result: t("integrationResult"),
      bookmark_creating: t("creatingBookmark"),
      memory_created: t("bookmarkCreated"),
      memory_failed: t("bookmarkFailed"),
      memory_updated: t("bookmarkComplete"),
      memory_update_failed: t("bookmarkUpdateFailed"),
      memory_irrelevant_marked: t("markedIrrelevant"),
    };

    if (customType === "memory_prefetch_result") {
      const d = data as { summary?: string } | undefined;
      const summary = d?.summary ?? "";
      const match = summary.match(/(\d+)/);
      if (match) return t("matchCount", { count: match[1] });
      return t("memoryMatch");
    }
    if (customType === "memory_prefetch") {
      const summary = getMemorySummary(customType, data);
      if (summary) return summary;
      return panelLabels[customType] ?? customType;
    }
    if (customType === "memory_extract") {
      const summary = getMemorySummary(customType, data);
      if (summary) return summary;
      return panelLabels[customType] ?? customType;
    }
    if (customType === "memory_updated") {
      const d = data as { files?: Array<{ filename: string }> } | undefined;
      const count = d?.files?.length ?? 0;
      return count > 0 ? t("bookmarkCount", { count }) : t("bookmarkComplete");
    }
    if (customType === "memory_update_failed") {
      const d = data as { reason?: string } | undefined;
      return d?.reason ?? t("bookmarkFailed");
    }
    return panelLabels[customType] ?? customType;
  };

  return (
    <div className="py-1">
      {hasInjected && (
        <div className="border-b border-border-secondary dark:border-surface-code/50">
          <SectionHeader
            collapsed={collapsedSections.has("injected")}
            onToggle={() => toggleSection("injected")}
            icon={Search}
            iconCls="text-status-info"
            label={t("thisInjection")}
            badge={injected.length}
          />
          {!collapsedSections.has("injected") && (
            <div className="px-2.5 pb-1.5 space-y-1.5">
              {injected.map((item, i) => {
                const entries = item.snippet ? parseSnippetToEntries(item.snippet) : [];
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-status-info shrink-0" />
                      <span className="text-[10px] font-medium text-status-info/80">
                        {item.summary}
                      </span>
                      {entries.length > 0 && (
                        <span className="text-[9px] text-text-tertiary ml-auto">
                          {entries.length} {entries.length > 1 ? "files" : "file"}
                        </span>
                      )}
                    </div>
                    {entries.length > 0 ? (
                      <div className="space-y-0.5 pl-1">
                        {entries.map((entry, j) => {
                          const badge = TYPE_BADGES[entry.type ?? ""];
                          return (
                            <div
                              key={j}
                              className="px-1.5 py-1 rounded bg-surface-hover/40 dark:bg-surface-code/30 border border-border-secondary/40"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                {badge ? (
                                  <span
                                    className={`px-1 py-px rounded text-[8px] font-medium shrink-0 ${badge.cls}`}
                                  >
                                    {getBadgeLabel(entry.type ?? "")}
                                  </span>
                                ) : (
                                  <span className="px-1 py-px rounded text-[8px] font-medium shrink-0 bg-text-tertiary/15 text-text-tertiary">
                                    {getBadgeLabel("")}
                                  </span>
                                )}
                                <span className="text-[10px] font-medium text-text-primary truncate">
                                  {entry.name}
                                </span>
                              </div>
                              {entry.description && (
                                <div className="text-[9px] text-text-tertiary mt-0.5 truncate">
                                  {entry.description}
                                </div>
                              )}
                              {entry.content && (
                                <div
                                  className="text-[9px] text-text-secondary/70 mt-0.5 leading-tight line-clamp-3 whitespace-pre-wrap"
                                  title={entry.content}
                                >
                                  {entry.content.length > 150
                                    ? entry.content.slice(0, 150) + "..."
                                    : entry.content}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : item.snippet ? (
                      <div
                        className="pl-3 text-[9px] text-text-tertiary leading-tight whitespace-pre-wrap line-clamp-4"
                        title={item.snippet}
                      >
                        {item.snippet}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {/* Debug info from latest prefetch */}
              {(() => {
                const prefetchEvents = events.filter(
                  (e) => e.customType === "memory_prefetch_result",
                );
                const latest = prefetchEvents[prefetchEvents.length - 1];
                if (!latest) return null;
                const d = latest.data as
                  | {
                      layer?: string;
                      durationMs?: number;
                      selectedFiles?: string[];
                      availableFiles?: number;
                      skipHits?: string[];
                      guardHits?: string[];
                    }
                  | undefined;
                if (!d) return null;
                const layerColors: Record<string, string> = {
                  llm: "text-status-info",
                  auto: "text-status-success",
                  skip: "text-text-tertiary",
                };
                const layerIcons: Record<string, string> = { llm: "🔍", auto: "⚡", skip: "⏭️" };
                return (
                  <div className="mx-1 mt-1 px-1.5 py-1 rounded bg-surface-code/60 dark:bg-surface-code/40 text-[9px] text-text-tertiary flex items-center gap-1.5 flex-wrap">
                    <span className={layerColors[d.layer ?? ""] ?? "text-text-tertiary"}>
                      {layerIcons[d.layer ?? ""] ?? "?"} {d.layer}
                    </span>
                    <span>· {d.selectedFiles?.length ?? 0} files</span>
                    {d.durationMs != null && <span>· {d.durationMs}ms</span>}
                    {d.guardHits && d.guardHits.length > 0 && (
                      <span className="text-status-success">
                        ✅ guard:{" "}
                        {d.guardHits
                          .map((h: string | { pattern?: string; mode?: string }) =>
                            typeof h === "string" ? h : (h.pattern ?? JSON.stringify(h)),
                          )
                          .join(", ")}
                      </span>
                    )}
                    {d.skipHits && d.skipHits.length > 0 && (
                      <span className="text-status-warning">⏭️ skip: {d.skipHits.join(", ")}</span>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      <div className="border-b border-border-secondary dark:border-surface-code/50">
        <SectionHeader
          collapsed={collapsedSections.has("files")}
          onToggle={() => toggleSection("files")}
          icon={FileText}
          iconCls="text-text-tertiary"
          label={t("memoryFiles")}
          badge={files.length}
        />
        {!collapsedSections.has("files") &&
          (hasFiles ? (
            <div className="px-2.5 pb-1.5 space-y-0.5">
              {files.map((f) => {
                const badge = TYPE_BADGES[f.type ?? ""];
                const isExpanded = expandedFile === f.filePath;
                return (
                  <div key={f.filePath}>
                    <button
                      onClick={() => setExpandedFile(isExpanded ? null : f.filePath)}
                      className="w-full flex items-center gap-1.5 py-1 px-1 rounded hover:bg-surface-hover/50 dark:hover:bg-surface-code/40 transition-colors text-left"
                    >
                      {badge ? (
                        <span
                          className={`px-1 py-0 rounded text-[8px] font-medium shrink-0 ${badge.cls}`}
                        >
                          {getBadgeLabel(f.type ?? "")}
                        </span>
                      ) : (
                        <span className="px-1 py-0 rounded text-[8px] font-medium shrink-0 bg-text-tertiary/15 text-text-tertiary">
                          {t("typeOther")}
                        </span>
                      )}
                      <span className="text-[10px] text-text-secondary truncate flex-1">
                        {f.description ?? f.filename}
                      </span>
                      <span className="text-[9px] text-text-tertiary shrink-0">
                        {relativeTimeStr(f.mtimeMs)}
                      </span>
                    </button>
                    {isExpanded && <FileContentPreview filePath={f.filePath} />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-2.5 pb-2 py-2 text-center">
              <FileText className="w-4 h-4 mx-auto mb-1 text-text-tertiary" />
              <p className="text-[10px] text-text-tertiary">{t("noMemoryFiles")}</p>
              <p className="text-[9px] text-text-tertiary mt-0.5">{t("autoExtract")}</p>
            </div>
          ))}
      </div>

      {hasEntrypoint && (
        <div className="border-b border-border-secondary dark:border-surface-code/50">
          <SectionHeader
            collapsed={collapsedSections.has("entrypoint")}
            onToggle={() => toggleSection("entrypoint")}
            icon={FileText}
            iconCls="text-status-warning"
            label={t("memoryIndex")}
          />
          {!collapsedSections.has("entrypoint") && (
            <div className="px-2.5 pb-1.5">
              <pre className="p-2 rounded bg-surface-code dark:bg-surface-code/80 border border-border-secondary dark:border-surface-code text-[10px] text-text-secondary overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {(entrypoint || "").length > 2000
                  ? (entrypoint || "").slice(0, 2000) + "..."
                  : entrypoint}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Filter Rules */}
      <div className="border-b border-border-secondary dark:border-surface-code/50">
        <SectionHeader
          collapsed={collapsedSections.has("filters")}
          onToggle={() => toggleSection("filters")}
          icon={Shield}
          iconCls="text-status-warning"
          label={t("filterRules")}
          badge={
            (memoryStatus?.skipRules?.custom?.length ?? 0) +
            (memoryStatus?.guardRules?.custom?.length ?? 0) +
            (memoryStatus?.excludeKeywords?.length ?? 0)
          }
        />
        {!collapsedSections.has("filters") && (
          <div className="px-2.5 pb-1.5 space-y-2">
            {/* Exclude Keywords */}
            {(memoryStatus?.excludeKeywords?.length ?? 0) > 0 && (
              <div>
                <div className="text-[9px] font-medium text-text-tertiary mb-0.5">
                  📌 {t("excludeKeywords")} ({memoryStatus?.excludeKeywords?.length ?? 0})
                </div>
                <div className="flex flex-wrap gap-1">
                  {memoryStatus?.excludeKeywords?.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-status-error/10 text-[9px] text-status-error group"
                    >
                      {kw}
                      <button
                        onClick={() =>
                          sessionId && removeRuleAction(sessionId, { excludeKeyword: kw })
                        }
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t("remove")}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Skip Rules */}
            {(memoryStatus?.skipRules?.custom?.length ?? 0) > 0 && (
              <div>
                <div className="text-[9px] font-medium text-text-tertiary mb-0.5">
                  ⏭️ {t("customSkipRules")} ({memoryStatus?.skipRules?.custom?.length ?? 0})
                </div>
                <div className="flex flex-wrap gap-1">
                  {memoryStatus?.skipRules?.custom?.map((rule, i) => (
                    <span
                      key={`${rule.pattern}-${rule.mode}-${i}`}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-surface-code dark:bg-surface-code/60 text-[9px] text-text-secondary group"
                    >
                      {rule.mode}: "{rule.pattern}"
                      <button
                        onClick={() =>
                          sessionId &&
                          removeRuleAction(sessionId, {
                            rule: { pattern: rule.pattern, mode: rule.mode },
                          })
                        }
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t("remove")}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Guard Rules */}
            {(memoryStatus?.guardRules?.custom?.length ?? 0) > 0 && (
              <div>
                <div className="text-[9px] font-medium text-text-tertiary mb-0.5">
                  ✅ {t("customGuardRules")} ({memoryStatus?.guardRules?.custom?.length ?? 0})
                </div>
                <div className="flex flex-wrap gap-1">
                  {memoryStatus?.guardRules?.custom?.map((rule, i) => (
                    <span
                      key={`${rule.pattern}-${rule.mode}-${i}`}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-status-success/10 text-[9px] text-status-success group"
                    >
                      {rule.mode}: "{rule.pattern}"
                      <button
                        onClick={() =>
                          sessionId &&
                          removeRuleAction(sessionId, {
                            rule: { pattern: rule.pattern, mode: rule.mode },
                          })
                        }
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t("remove")}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Built-in rules (collapsed) */}
            <div>
              <button
                onClick={() => setBuiltinExpanded(!builtinExpanded)}
                className="text-[9px] text-text-tertiary hover:text-text-secondary transition-colors w-full text-left"
              >
                ──{" "}
                {builtinExpanded
                  ? t("hideBuiltin")
                  : t("showBuiltin", {
                      skip: memoryStatus?.skipRules?.builtin?.length ?? 0,
                      guard: memoryStatus?.guardRules?.builtin?.length ?? 0,
                    })}{" "}
                ──
              </button>
              {builtinExpanded && (
                <div className="mt-1 space-y-1">
                  <div className="flex flex-wrap gap-0.5">
                    {(memoryStatus?.skipRules?.builtin ?? []).map((r, i) => (
                      <span
                        key={`s-${i}`}
                        className="px-1 py-0 rounded text-[8px] text-text-tertiary bg-surface-code/40"
                      >
                        ⏭️ {r.mode}: "{r.pattern}"
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {(memoryStatus?.guardRules?.builtin ?? []).map((r, i) => (
                      <span
                        key={`g-${i}`}
                        className="px-1 py-0 rounded text-[8px] text-status-success/60 bg-status-success/5"
                      >
                        ✅ {r.mode}: "{r.pattern}"
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Empty state */}
            {(memoryStatus?.skipRules?.custom?.length ?? 0) === 0 &&
              (memoryStatus?.guardRules?.custom?.length ?? 0) === 0 &&
              (memoryStatus?.excludeKeywords?.length ?? 0) === 0 && (
                <div className="py-2 text-center text-[10px] text-text-tertiary">
                  {t("noCustomRules")}
                </div>
              )}
          </div>
        )}
      </div>

      {/* Search History */}
      <div className="border-b border-border-secondary dark:border-surface-code/50">
        <SectionHeader
          collapsed={collapsedSections.has("history")}
          onToggle={() => toggleSection("history")}
          icon={History}
          iconCls="text-text-tertiary"
          label={t("searchHistory")}
          badge={memoryStatus?.recentQueries?.length}
        />
        {!collapsedSections.has("history") && (
          <div className="px-2.5 pb-1.5 space-y-1">
            {(memoryStatus?.recentQueries?.length ?? 0) > 0 ? (
              [...(memoryStatus?.recentQueries ?? [])].reverse().map((q, i) => {
                const layerColors: Record<string, string> = {
                  llm: "text-status-info",
                  auto: "text-status-success",
                  skip: "text-text-tertiary",
                };
                const layerIcons: Record<string, string> = { llm: "🔍", auto: "⚡", skip: "⏭️" };
                return (
                  <div
                    key={i}
                    className="px-1.5 py-1 rounded hover:bg-surface-hover/30 dark:hover:bg-surface-code/30"
                  >
                    <div className="text-[10px] text-text-primary truncate">"{q.query}"</div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-text-tertiary flex-wrap">
                      <span className={layerColors[q.skipped ? "skip" : "llm"]}>
                        {layerIcons[q.skipped ? "skip" : "llm"]} {q.skipped ? "skip" : "matched"}
                      </span>
                      <span>· {q.selected?.length ?? 0} files</span>
                      <span className="ml-auto">{relativeTimeStr(q.timestamp)}</span>
                    </div>
                    {q.guard_hits?.length > 0 && (
                      <div className="text-[9px] text-status-success mt-0.5">
                        ✅ guard:{" "}
                        {q.guard_hits
                          .map((h: string | { pattern?: string; mode?: string }) =>
                            typeof h === "string" ? h : (h.pattern ?? JSON.stringify(h)),
                          )
                          .join(", ")}
                      </div>
                    )}
                    {q.skip_hits?.length > 0 && (
                      <div className="text-[9px] text-status-warning mt-0.5">
                        ⏭️ skip: {q.skip_hits.join(", ")}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="py-2 text-center text-[10px] text-text-tertiary">
                {t("noSearchHistory")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-b border-border-secondary dark:border-surface-code/50 last:border-b-0">
        <SectionHeader
          collapsed={collapsedSections.has("operations")}
          onToggle={() => toggleSection("operations")}
          icon={Brain}
          iconCls="text-text-tertiary"
          label={t("recentOperations")}
          badge={events.length}
        />
        {!collapsedSections.has("operations") &&
          (hasEvents ? (
            <div className="px-2.5 pb-1.5 space-y-0.5">
              {last10Events.map((event) => {
                const config = getEventIcon(event.customType);
                const Icon = config.icon;
                const label = getEventLabel(event.customType, event.data);
                const detailEl = getEventDetail(event.customType, event.data);
                const timeStr = new Date(event.timestamp).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <div
                    key={event.id}
                    className={`flex items-center gap-1.5 py-0.5 px-1 rounded transition-colors ${config.pulse ? "bg-semantic-memory/5" : "hover:bg-surface-hover/50 dark:hover:bg-surface-code/40"}`}
                  >
                    <Icon
                      className={`w-3 h-3 shrink-0 ${config.color} ${config.pulse ? "animate-spin" : ""}`}
                    />
                    <span className={`text-[10px] font-medium ${config.color}`}>{label}</span>
                    {detailEl}
                    <span className="ml-auto text-[9px] text-text-tertiary shrink-0">
                      {timeStr}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-2.5 pb-2 py-2 text-center">
              <Brain className="w-4 h-4 mx-auto mb-1 text-text-tertiary" />
              <p className="text-[10px] text-text-tertiary">{t("noOperations")}</p>
            </div>
          ))}
      </div>
    </div>
  );
}

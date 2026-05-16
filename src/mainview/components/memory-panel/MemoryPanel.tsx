import { useState, useEffect, useCallback } from "react";
import { Brain, Search, FileText, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMemoryStore } from "../../stores/use-memory-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useShallow } from "zustand/react/shallow";
import { apiClient } from "../../lib/api-client";
import { ALL_MEMORY_TYPES, getMemorySummary } from "../chat/memory-config";
import type { MemoryTypeConfig } from "../chat/memory-config";

const TYPE_BADGES: Record<string, { labelKey: string; cls: string }> = {
  project: { labelKey: "typeProject", cls: "bg-emerald-400/15 text-emerald-400" },
  user: { labelKey: "typeUser", cls: "bg-indigo-400/15 text-indigo-400" },
  feedback: { labelKey: "typeFeedback", cls: "bg-amber-400/15 text-amber-400" },
  reference: { labelKey: "typeReference", cls: "bg-sky-400/15 text-sky-400" },
};

const EVENT_FALLBACK: MemoryTypeConfig = { icon: Brain, label: "", color: "text-gray-400" };

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
      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-800/30 transition-colors"
    >
      {collapsed ? (
        <ChevronRight className="w-3 h-3 shrink-0" />
      ) : (
        <ChevronDown className="w-3 h-3 shrink-0" />
      )}
      <Icon className={`w-3 h-3 shrink-0 ${iconCls ?? ""}`} />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto text-[9px] text-gray-600">{badge}</span>
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
        console.warn("[MemoryPanel] load failed:", err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (loading) {
    return (
      <div className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-600">{t("loading")}</div>
    );
  }
  if (!content) {
    return (
      <div className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-600">
        {t("cannotRead")}
      </div>
    );
  }
  return (
    <pre className="mx-2 mb-1.5 p-2 rounded bg-gray-100 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800 text-[10px] text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
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

  useEffect(() => {
    if (!sessionId) return;
    const tab = projectTabs.find((tab) => tab.id === activeProjectId);
    if (!tab) return;
    loadFiles(tab.path, sessionId);
  }, [sessionId, activeProjectId, projectTabs]);

  if (!sessionId) {
    return (
      <div className="p-3 text-xs text-gray-500 dark:text-gray-500">{t("noActiveSession")}</div>
    );
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
              className="text-[9px] text-green-400/70 truncate max-w-[160px]"
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
        <span className="text-[9px] text-gray-500 truncate max-w-[120px]">
          {fileList.map((f) => f.filename).join(", ")}
        </span>
      ) : null;
    }
    if (customType === "memory_prefetch_result") {
      const d = data as { durationMs?: number } | undefined;
      return d?.durationMs != null ? (
        <span className="text-[9px] text-gray-500">{d.durationMs}ms</span>
      ) : null;
    }
    if (customType === "memory_irrelevant_marked") {
      const d = data as { selectedFiles?: string[] } | undefined;
      const files = d?.selectedFiles ?? [];
      return files.length > 0 ? (
        <span className="text-[9px] text-orange-400/70 truncate max-w-[120px]">
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
        <div className="border-b border-gray-200 dark:border-gray-800/50">
          <SectionHeader
            collapsed={collapsedSections.has("injected")}
            onToggle={() => toggleSection("injected")}
            icon={Search}
            iconCls="text-blue-400"
            label={t("thisInjection")}
            badge={injected.length}
          />
          {!collapsedSections.has("injected") && (
            <div className="px-2.5 pb-1.5 space-y-1">
              {injected.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-1.5 px-1.5 py-1 rounded bg-blue-400/5 border border-blue-400/10"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                  <span className="text-[10px] text-blue-300/80 leading-tight">{item.summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="border-b border-gray-200 dark:border-gray-800/50">
        <SectionHeader
          collapsed={collapsedSections.has("files")}
          onToggle={() => toggleSection("files")}
          icon={FileText}
          iconCls="text-gray-400"
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
                      className="w-full flex items-center gap-1.5 py-1 px-1 rounded hover:bg-gray-200/50 dark:hover:bg-gray-800/40 transition-colors text-left"
                    >
                      {badge ? (
                        <span
                          className={`px-1 py-0 rounded text-[8px] font-medium shrink-0 ${badge.cls}`}
                        >
                          {getBadgeLabel(f.type ?? "")}
                        </span>
                      ) : (
                        <span className="px-1 py-0 rounded text-[8px] font-medium shrink-0 bg-gray-400/15 text-gray-400">
                          {t("typeOther")}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-700 dark:text-gray-300 truncate flex-1">
                        {f.description ?? f.filename}
                      </span>
                      <span className="text-[9px] text-gray-400 dark:text-gray-600 shrink-0">
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
              <FileText className="w-4 h-4 mx-auto mb-1 text-gray-400 dark:text-gray-600" />
              <p className="text-[10px] text-gray-500">{t("noMemoryFiles")}</p>
              <p className="text-[9px] text-gray-400 dark:text-gray-600 mt-0.5">
                {t("autoExtract")}
              </p>
            </div>
          ))}
      </div>

      {hasEntrypoint && (
        <div className="border-b border-gray-200 dark:border-gray-800/50">
          <SectionHeader
            collapsed={collapsedSections.has("entrypoint")}
            onToggle={() => toggleSection("entrypoint")}
            icon={FileText}
            iconCls="text-yellow-400"
            label={t("memoryIndex")}
          />
          {!collapsedSections.has("entrypoint") && (
            <div className="px-2.5 pb-1.5">
              <pre className="p-2 rounded bg-gray-100 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800 text-[10px] text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {(entrypoint || "").length > 2000
                  ? (entrypoint || "").slice(0, 2000) + "..."
                  : entrypoint}
              </pre>
            </div>
          )}
        </div>
      )}

      <div className="border-b border-gray-200 dark:border-gray-800/50 last:border-b-0">
        <SectionHeader
          collapsed={collapsedSections.has("operations")}
          onToggle={() => toggleSection("operations")}
          icon={Brain}
          iconCls="text-gray-400"
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
                    className={`flex items-center gap-1.5 py-0.5 px-1 rounded transition-colors ${config.pulse ? "bg-teal-400/5" : "hover:bg-gray-200/50 dark:hover:bg-gray-800/40"}`}
                  >
                    <Icon
                      className={`w-3 h-3 shrink-0 ${config.color} ${config.pulse ? "animate-spin" : ""}`}
                    />
                    <span className={`text-[10px] font-medium ${config.color}`}>{label}</span>
                    {detailEl}
                    <span className="ml-auto text-[9px] text-gray-400 dark:text-gray-600 shrink-0">
                      {timeStr}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-2.5 pb-2 py-2 text-center">
              <Brain className="w-4 h-4 mx-auto mb-1 text-gray-400 dark:text-gray-600" />
              <p className="text-[10px] text-gray-500">{t("noOperations")}</p>
            </div>
          ))}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Archive,
  Brain,
  Check,
  ChevronRight,
  FileText,
  Maximize2,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { SectionHeader } from "../primitives";
import { useLearningStore } from "../../stores/use-learning-store";
import { useMemoryStore } from "../../stores/use-memory-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useChatOverlayStore } from "../../stores/use-chat-overlay-store";
import { apiClient } from "../../lib/api-client";
import { getMemorySummary } from "../chat/memory-config";
import type {
  LearningCandidate,
  LearningConfig,
  LearningCuratorMode,
  LearningFileRef,
  LearningMemorySummary,
  LearningSkillSummary,
} from "../../../shared/modules/learning";
import type { MemoryStatusResult, PrefetchHistoryEntry } from "../../../shared/modules/memory";
import type { TreeNode } from "../../types";

type LearningTab = "memory" | "skills" | "candidates" | "curator" | "settings";
type LearningMemoryEvent = { id: string; customType: string; data: unknown; timestamp: number };

const TABS: Array<{ id: LearningTab; label: string; icon: ComponentType<{ className?: string }> }> =
  [
    { id: "memory", label: "记忆", icon: Brain },
    { id: "skills", label: "技能", icon: Wrench },
    { id: "candidates", label: "候选", icon: Sparkles },
    { id: "curator", label: "整理", icon: Archive },
    { id: "settings", label: "设置", icon: Settings2 },
  ];

const MODE_LABELS: Record<string, string> = {
  off: "关闭",
  pending: "先确认",
  auto: "自动",
  "dry-run": "预演",
};

const MEMORY_TYPE_BADGES: Record<
  string,
  { label: string; tone: "muted" | "accent" | "success" | "info" | "warning" }
> = {
  project: { label: "项目", tone: "success" },
  user: { label: "用户", tone: "accent" },
  feedback: { label: "反馈", tone: "warning" },
  reference: { label: "引用", tone: "info" },
  bookmark: { label: "收藏", tone: "info" },
};

function relativeTime(ms: number | null | undefined): string {
  if (!ms) return "从未";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h前`;
  return `${Math.floor(hours / 24)}d前`;
}

interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  title: string | null;
  body: string;
  indexItems: Array<{ label: string; target: string; description: string | null }>;
}

function parseMarkdown(content: string): ParsedMarkdown {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let frontmatter: Record<string, string> = {};
  let body = normalized.trim();

  if (normalized.startsWith("---\n")) {
    const endIndex = normalized.indexOf("\n---", 4);
    if (endIndex !== -1) {
      const yaml = normalized.slice(4, endIndex);
      frontmatter = Object.fromEntries(
        yaml
          .split("\n")
          .map((line) => {
            const colon = line.indexOf(":");
            if (colon === -1) return null;
            const key = line.slice(0, colon).trim();
            const value = line
              .slice(colon + 1)
              .trim()
              .replace(/^["']|["']$/g, "");
            return key ? [key, value] : null;
          })
          .filter((entry): entry is [string, string] => Boolean(entry)),
      );
      body = normalized.slice(endIndex + 4).trim();
    }
  }

  const lines = body.split("\n");
  const titleLine = lines.find((line) => /^#\s+/.test(line.trim()));
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : null;
  const indexItems = lines
    .map((line) => {
      const match = line.match(/^\s*-\s+\[([^\]]+)]\(([^)]+)\)(?:\s*-\s*(.*))?\s*$/);
      if (!match) return null;
      return {
        label: match[1] ?? "",
        target: match[2] ?? "",
        description: match[3]?.trim() || null,
      };
    })
    .filter((item): item is { label: string; target: string; description: string | null } =>
      Boolean(item),
    );

  return { frontmatter, title, body, indexItems };
}

function bodyPreviewLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, 8);
}

function slugifyFileName(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || fallback;
}

function joinLearningPath(baseDir: string, ...segments: string[]): string {
  return [baseDir.replace(/[/\\]+$/, ""), ...segments].join("/");
}

function joinMemoryPath(baseDir: string, filePath: string): string {
  if (filePath.startsWith("/")) return filePath;
  return [baseDir.replace(/[/\\]+$/, ""), filePath.replace(/^[/\\]+/, "")].join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function ruleLabel(rule: { pattern: string; mode: string }): string {
  return `${rule.mode}: ${rule.pattern}`;
}

function memoryRuntimeEventLabel(customType: string): string {
  const labels: Record<string, string> = {
    memory_prefetch: "预取开始",
    memory_prefetch_result: "预取结果",
    memory_dream: "整理开始",
    memory_dream_result: "整理结果",
  };
  return labels[customType] ?? customType;
}

function memoryRuntimeSelectedFiles(data: unknown): string[] {
  if (!isRecord(data)) return [];
  return stringArray(data.selectedFiles);
}

function memoryRuntimeFileRef(path: string, memoryDir: string): LearningFileRef {
  const resolvedPath = joinMemoryPath(memoryDir, path);
  return {
    path: resolvedPath,
    label: resolvedPath.split("/").pop() ?? resolvedPath,
    kind: "memory",
    exists: true,
  };
}

function FileLink({ file }: { file: LearningFileRef }) {
  const openFile = useExplorerStore((s) => s.openFile);
  const handleOpen = useCallback(() => {
    if (!file.exists) return;
    const node: TreeNode = {
      name: file.label.split("/").pop() ?? file.label,
      path: file.path,
      type: "file",
      size: file.size,
    };
    void openFile(node, false);
  }, [file, openFile]);

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={!file.exists}
      title={file.path}
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded px-1 py-0.5 text-[9px] text-text-tertiary transition-colors hover:bg-surface-hover/40 hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
    >
      <FileText className="h-3 w-3 shrink-0" />
      <span className="truncate">{file.label}</span>
    </button>
  );
}

function MemoryMarkdownPreview({ filePath, index = false }: { filePath: string; index?: boolean }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openExpand = useChatOverlayStore((s) => s.openExpand);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .call("memory.readFile", { filePath })
      .then((result) => {
        if (cancelled) return;
        setContent((result as { content: string }).content);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const handleExpand = useCallback(() => {
    if (!content) return;
    const fileName = filePath.split("/").pop() ?? filePath;
    openExpand(
      fileName,
      <pre className="h-full overflow-auto bg-surface-code p-4 font-mono text-xs whitespace-pre-wrap text-text-primary">
        {content}
      </pre>,
    );
  }, [content, filePath, openExpand]);

  if (loading) {
    return (
      <div className="mt-1 flex items-center gap-1.5 rounded border border-border-secondary/60 bg-surface-code/40 px-2 py-1.5 text-[10px] text-text-tertiary">
        <div className="h-3 w-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        正在读取
      </div>
    );
  }

  if (!content) {
    return (
      <div className="mt-1 rounded border border-border-secondary/60 bg-surface-code/40 px-2 py-1.5 text-[10px] text-text-tertiary">
        {error ? `无法读取: ${error}` : "无法读取"}
      </div>
    );
  }

  const parsed = parseMarkdown(content);
  const type = parsed.frontmatter.type ?? (index ? "index" : "memory");
  const typeBadge = MEMORY_TYPE_BADGES[type] ?? {
    label: index ? "索引" : type,
    tone: "muted" as const,
  };
  const title =
    parsed.frontmatter.description ??
    parsed.frontmatter.name ??
    parsed.title ??
    (index ? "Project Memory" : filePath.split("/").pop());
  const previewLines = bodyPreviewLines(parsed.body);

  return (
    <div className="relative mt-1 min-w-0 overflow-hidden rounded border border-border-secondary/60 bg-bg-primary/60 p-2 dark:bg-surface-code/30">
      <button
        type="button"
        onClick={handleExpand}
        title="展开原文"
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-surface-hover/60 hover:text-text-primary"
      >
        <Maximize2 className="h-3 w-3" />
      </button>
      <div className="min-w-0 pr-7">
        <div className="flex min-w-0 items-center gap-1.5">
          <ToneBadge tone={typeBadge.tone}>{typeBadge.label}</ToneBadge>
          <span className="truncate text-[10px] font-medium text-text-primary">{title}</span>
        </div>
        {(parsed.frontmatter.createdAt || parsed.frontmatter.sourceSession) && (
          <div className="mt-1 flex min-w-0 flex-wrap gap-1">
            {parsed.frontmatter.createdAt && (
              <ToneBadge>{new Date(parsed.frontmatter.createdAt).toLocaleDateString()}</ToneBadge>
            )}
            {parsed.frontmatter.sourceSession && (
              <ToneBadge>session {parsed.frontmatter.sourceSession.slice(0, 8)}</ToneBadge>
            )}
          </div>
        )}
        {index && parsed.indexItems.length > 0 ? (
          <div className="mt-1.5 min-w-0 space-y-1">
            {parsed.indexItems.slice(0, 6).map((item) => (
              <div
                key={`${item.target}:${item.label}`}
                className="min-w-0 break-words text-[10px] leading-snug"
              >
                <span className="text-text-secondary">{item.label}</span>
                <span className="ml-1 break-all text-text-tertiary" title={item.target}>
                  {item.target}
                </span>
                {item.description && (
                  <span className="ml-1 break-words text-text-tertiary">- {item.description}</span>
                )}
              </div>
            ))}
          </div>
        ) : previewLines.length > 0 ? (
          <div className="mt-1.5 space-y-1">
            {previewLines.map((line, index) => (
              <p
                key={`${index}:${line}`}
                className="line-clamp-2 break-words text-[10px] leading-snug text-text-secondary"
              >
                {line.replace(/^[-*]\s+/, "")}
              </p>
            ))}
          </div>
        ) : (
          <div className="mt-1.5 text-[10px] text-text-tertiary">
            {index ? "暂无索引条目" : "暂无正文内容"}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: T[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-surface-hover/30 p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`h-6 rounded px-2 text-[10px] transition-colors ${
            value === option
              ? "bg-bg-primary text-text-primary shadow-sm"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          {MODE_LABELS[option] ?? option}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="px-2.5 py-4 text-center text-[10px] text-text-tertiary">
      <FileText className="mx-auto mb-1 h-4 w-4 opacity-70" />
      {label}
    </div>
  );
}

function ToneBadge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "success" | "info" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "bg-status-success/10 text-status-success"
      : tone === "info"
        ? "bg-status-info/10 text-status-info"
        : tone === "warning"
          ? "bg-status-warning/10 text-status-warning"
          : tone === "accent"
            ? "bg-accent/10 text-accent"
            : "bg-text-tertiary/10 text-text-tertiary";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] leading-none ${toneClass}`}>
      {children}
    </span>
  );
}

function SettingSection({
  icon: Icon,
  title,
  sectionKey,
  collapsedSections,
  toggleSection,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  sectionKey: string;
  collapsedSections: Set<string>;
  toggleSection: (section: string) => void;
  children: ReactNode;
}) {
  const collapsed = collapsedSections.has(sectionKey);
  return (
    <div className="border-b border-border-secondary dark:border-surface-code/50">
      <SectionHeader
        collapsed={collapsed}
        onToggle={() => toggleSection(sectionKey)}
        icon={Icon}
        iconCls="text-text-tertiary"
        label={title}
      />
      {!collapsed && <div className="px-2.5 pb-1.5">{children}</div>}
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 min-w-0 items-center justify-between gap-2 border-t border-border-secondary/50 py-1 first:border-t-0">
      <span className="min-w-0 text-[11px] text-text-secondary">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function MemoryRow({
  file,
  expanded,
  onToggle,
  onDelete,
  deleting,
}: {
  file: LearningMemorySummary;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting?: boolean;
}) {
  const typeBadge = MEMORY_TYPE_BADGES[file.type ?? ""] ?? {
    label: file.type ?? "记忆",
    tone: "muted" as const,
  };
  return (
    <div className="group min-w-0 overflow-hidden rounded px-1 py-1 transition-colors hover:bg-surface-hover/50 dark:hover:bg-surface-code/40">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-text-tertiary transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <ToneBadge tone={typeBadge.tone}>{typeBadge.label}</ToneBadge>
          <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-text-secondary">
            {file.description ?? file.filename}
          </span>
          <span className="shrink-0 text-[9px] text-text-tertiary">
            {relativeTime(file.mtimeMs)}
          </span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          title="删除记忆"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-tertiary opacity-0 transition-colors hover:bg-status-error/10 hover:text-status-error group-hover:opacity-100 focus:opacity-100 disabled:cursor-wait disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-0.5 min-w-0 pl-4">
        <FileLink
          file={{
            path: file.filePath,
            label: file.filename,
            kind: "memory",
            exists: true,
            size: file.size,
            mtimeMs: file.mtimeMs,
          }}
        />
      </div>
      {expanded && (
        <div className="min-w-0 pl-4">
          <MemoryMarkdownPreview filePath={file.filePath} />
        </div>
      )}
    </div>
  );
}

function RuntimeMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded border border-border-secondary/60 bg-bg-primary/45 px-2 py-1 dark:bg-surface-code/25">
      <div className="text-[9px] text-text-tertiary">{label}</div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-text-primary">{value}</div>
    </div>
  );
}

function RuntimeSubsection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 overflow-hidden">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-text-secondary">
        <span>{title}</span>
        {typeof count === "number" && <ToneBadge>{count}</ToneBadge>}
      </div>
      {children}
    </div>
  );
}

function MemoryRuntimeEventRow({
  event,
  memoryDir,
}: {
  event: LearningMemoryEvent;
  memoryDir: string;
}) {
  const data = isRecord(event.data) ? event.data : {};
  const selectedFiles = memoryRuntimeSelectedFiles(data);
  const summary = getMemorySummary(event.customType, data);
  const layer = typeof data.layer === "string" ? data.layer : null;
  const durationMs = typeof data.durationMs === "number" ? data.durationMs : null;
  const query =
    typeof data._prefetchQuery === "string"
      ? data._prefetchQuery
      : typeof data.query === "string"
        ? data.query
        : null;
  const meta = [
    layer,
    selectedFiles.length ? `${selectedFiles.length} 文件` : null,
    durationMs != null ? `${durationMs}ms` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-w-0 overflow-hidden rounded px-1 py-1 transition-colors hover:bg-surface-hover/40 dark:hover:bg-surface-code/30">
      <div className="flex items-center gap-1.5">
        <ToneBadge tone={event.customType.includes("dream") ? "accent" : "info"}>
          {memoryRuntimeEventLabel(event.customType)}
        </ToneBadge>
        <span className="min-w-0 flex-1 truncate text-[10px] text-text-secondary">
          {summary ?? query ?? (meta || "无详情")}
        </span>
        <span
          className="shrink-0 text-[9px] text-text-tertiary"
          title={new Date(event.timestamp).toLocaleString()}
        >
          {relativeTime(event.timestamp)}
        </span>
      </div>
      {(meta || query) && (
        <div className="mt-0.5 truncate pl-1 text-[9px] text-text-tertiary">
          {[query ? `query: ${query}` : null, meta].filter(Boolean).join(" · ")}
        </div>
      )}
      {selectedFiles.length > 0 && (
        <div className="mt-1 flex min-w-0 flex-wrap gap-1 pl-1">
          {selectedFiles.slice(0, 4).map((file) => (
            <FileLink key={file} file={memoryRuntimeFileRef(file, memoryDir)} />
          ))}
          {selectedFiles.length > 4 && (
            <span className="px-1.5 py-0.5 text-[10px] text-text-tertiary">
              +{selectedFiles.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function QueryHistoryRow({ query, memoryDir }: { query: PrefetchHistoryEntry; memoryDir: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded px-1 py-1 transition-colors hover:bg-surface-hover/40 dark:hover:bg-surface-code/30">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] text-text-primary">
          {query.query || "(empty query)"}
        </span>
        <ToneBadge tone={query.skipped ? "warning" : "success"}>
          {query.skipped ? "skip" : "matched"}
        </ToneBadge>
        <span
          className="shrink-0 text-[9px] text-text-tertiary"
          title={new Date(query.timestamp).toLocaleString()}
        >
          {relativeTime(query.timestamp)}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-1 text-[9px] text-text-tertiary">
        <span>{query.selected.length} 文件</span>
        {query.guard_hits.length > 0 && (
          <span className="text-status-success">guard {query.guard_hits.length}</span>
        )}
        {query.skip_hits.length > 0 && (
          <span className="text-status-warning">skip {query.skip_hits.length}</span>
        )}
      </div>
      {query.selected.length > 0 && (
        <div className="mt-1 flex min-w-0 flex-wrap gap-1 pl-1">
          {query.selected.slice(0, 4).map((file) => (
            <FileLink key={file} file={memoryRuntimeFileRef(file, memoryDir)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryRuntime({
  status,
  events,
  memoryDir,
}: {
  status: MemoryStatusResult | null | undefined;
  events: LearningMemoryEvent[];
  memoryDir: string;
}) {
  const autoEvents = events
    .filter((event) =>
      ["memory_prefetch", "memory_prefetch_result", "memory_dream", "memory_dream_result"].includes(
        event.customType,
      ),
    )
    .slice(-6)
    .reverse();
  const recentQueries = [...(status?.recentQueries ?? [])].slice(-5).reverse();
  const customSkip = status?.skipRules?.custom ?? [];
  const customGuard = status?.guardRules?.custom ?? [];
  const builtinSkipCount = status?.skipRules?.builtin?.length ?? 0;
  const builtinGuardCount = status?.guardRules?.builtin?.length ?? 0;
  const excludeKeywords = status?.excludeKeywords ?? [];

  return (
    <div className="min-w-0 space-y-2 overflow-hidden">
      <div className="grid min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-1">
        <RuntimeMetric label="最近查询" value={status?.recentQueries?.length ?? 0} />
        <RuntimeMetric label="预取事件" value={autoEvents.length} />
        <RuntimeMetric label="上次整理" value={relativeTime(status?.dream?.lastRunAt)} />
      </div>

      <RuntimeSubsection title="最近预取" count={autoEvents.length}>
        {autoEvents.length > 0 ? (
          <div className="space-y-0.5">
            {autoEvents.map((event) => (
              <MemoryRuntimeEventRow key={event.id} event={event} memoryDir={memoryDir} />
            ))}
          </div>
        ) : (
          <div className="rounded bg-bg-primary/35 px-2 py-2 text-center text-[10px] text-text-tertiary dark:bg-surface-code/20">
            暂无 prefetch / dream 事件
          </div>
        )}
      </RuntimeSubsection>

      <RuntimeSubsection title="查询记录" count={recentQueries.length}>
        {recentQueries.length > 0 ? (
          <div className="space-y-0.5">
            {recentQueries.map((query, index) => (
              <QueryHistoryRow
                key={`${query.timestamp}:${index}`}
                query={query}
                memoryDir={memoryDir}
              />
            ))}
          </div>
        ) : (
          <div className="rounded bg-bg-primary/35 px-2 py-2 text-center text-[10px] text-text-tertiary dark:bg-surface-code/20">
            暂无查询记录
          </div>
        )}
      </RuntimeSubsection>

      <RuntimeSubsection
        title="规则"
        count={customSkip.length + customGuard.length + excludeKeywords.length}
      >
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1 text-[9px] text-text-tertiary">
            <ToneBadge>内置 skip {builtinSkipCount}</ToneBadge>
            <ToneBadge>内置 guard {builtinGuardCount}</ToneBadge>
          </div>
          {excludeKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {excludeKeywords.slice(0, 8).map((keyword) => (
                <ToneBadge key={keyword} tone="warning">
                  exclude {keyword}
                </ToneBadge>
              ))}
            </div>
          )}
          {customSkip.length > 0 || customGuard.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {customSkip.map((rule, index) => (
                <ToneBadge key={`skip:${rule.pattern}:${index}`} tone="warning">
                  skip {ruleLabel(rule)}
                </ToneBadge>
              ))}
              {customGuard.map((rule, index) => (
                <ToneBadge key={`guard:${rule.pattern}:${index}`} tone="success">
                  guard {ruleLabel(rule)}
                </ToneBadge>
              ))}
            </div>
          ) : (
            <div className="rounded bg-bg-primary/35 px-2 py-2 text-center text-[10px] text-text-tertiary dark:bg-surface-code/20">
              暂无自定义规则
            </div>
          )}
        </div>
      </RuntimeSubsection>
    </div>
  );
}

function SkillRow({ skill }: { skill: LearningSkillSummary }) {
  const visibleFiles = skill.files.slice(0, 6);
  return (
    <div className="min-w-0 overflow-hidden rounded px-1 py-1 transition-colors hover:bg-surface-hover/50 dark:hover:bg-surface-code/40">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-text-primary">
          {skill.name}
        </span>
        <ToneBadge tone={skill.state === "active" ? "success" : "muted"}>{skill.state}</ToneBadge>
      </div>
      {skill.description && (
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-text-tertiary">
          {skill.description}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px] text-text-tertiary">
        <span>使用 {skill.usageCount}</span>
        <span>Patch {skill.patchCount}</span>
        <span>{skill.pinned ? "Pinned" : "Unpinned"}</span>
        <span>{relativeTime(skill.lastUsedAt)}</span>
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap gap-1">
        {visibleFiles.map((file) => (
          <FileLink key={file.path} file={file} />
        ))}
        {skill.files.length > visibleFiles.length && (
          <span className="px-1.5 py-0.5 text-[10px] text-text-tertiary">
            +{skill.files.length - visibleFiles.length}
          </span>
        )}
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  learningDir,
  onApprove,
  onReject,
}: {
  candidate: LearningCandidate;
  learningDir: string;
  onApprove: (candidateId: string) => void;
  onReject: (candidateId: string) => void;
}) {
  const payloadName =
    candidate.payload.type === "memory"
      ? candidate.payload.filename
      : candidate.payload.type === "skill"
        ? candidate.payload.name
        : candidate.payload.domain;
  const candidateRecord: LearningFileRef = {
    path: joinLearningPath(
      learningDir,
      "candidates",
      `${slugifyFileName(candidate.id, "candidate")}.json`,
    ),
    label: `${candidate.id}.json`,
    kind: "candidate",
    exists: true,
  };
  const relatedFiles = [candidateRecord, ...candidate.fileRefs];
  return (
    <div className="min-w-0 overflow-hidden rounded px-1 py-1 transition-colors hover:bg-surface-hover/50 dark:hover:bg-surface-code/40">
      <div className="flex items-center gap-1.5">
        <ToneBadge tone="info">{candidate.domain}</ToneBadge>
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-text-primary">
          {candidate.title}
        </span>
        <span
          className="shrink-0 text-[9px] text-text-tertiary"
          title={new Date(candidate.createdAt).toLocaleString()}
        >
          {relativeTime(candidate.createdAt)}
        </span>
        <span className="shrink-0 text-[9px] text-text-tertiary">{candidate.confidence}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-text-tertiary">
        {candidate.summary}
      </p>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-[9px] text-text-tertiary">
        <span className="truncate">{candidate.action}</span>
        <span className="truncate">{payloadName}</span>
        {candidate.sourceSessionId && (
          <span className="truncate">source {candidate.sourceSessionId.slice(0, 8)}</span>
        )}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap gap-1">
        {relatedFiles.map((file) => (
          <FileLink key={file.path} file={file} />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => onApprove(candidate.id)}
          title="批准"
          className="inline-flex h-6 items-center gap-1 rounded bg-status-success/10 px-1.5 text-[10px] text-status-success transition-colors hover:bg-status-success/15"
        >
          <Check className="h-3 w-3" />
          批准
        </button>
        <button
          type="button"
          onClick={() => onReject(candidate.id)}
          title="删除候选"
          className="inline-flex h-6 items-center gap-1 rounded bg-surface-hover/35 px-1.5 text-[10px] text-text-tertiary transition-colors hover:bg-status-error/10 hover:text-status-error"
        >
          <X className="h-3 w-3" />
          删除
        </button>
      </div>
    </div>
  );
}

export function LearningPanel() {
  const [expandedMemoryPath, setExpandedMemoryPath] = useState<string | null>(null);
  const [deletingMemoryPath, setDeletingMemoryPath] = useState<string | null>(null);
  const [pendingDeleteMemory, setPendingDeleteMemory] = useState<LearningMemorySummary | null>(
    null,
  );
  const [deleteMemoryError, setDeleteMemoryError] = useState<string | null>(null);
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const activeProjectTab = projectTabs.find((tab) => tab.id === activeProjectId) ?? null;
  const projectPath = activeProjectTab?.path ?? "";

  const snapshot = useLearningStore((s) => (sessionId ? s.snapshotsBySession[sessionId] : null));
  const displayProjectPath = activeProjectTab?.remote
    ? `${activeProjectTab.remote.host}:${activeProjectTab.remote.remotePath}`
    : (snapshot?.projectRoot ?? projectPath);
  const loading = useLearningStore((s) => (sessionId ? s.loadingBySession[sessionId] : false));
  const error = useLearningStore((s) => (sessionId ? s.errorBySession[sessionId] : null));
  const activeTab = useLearningStore((s) =>
    sessionId ? (s.activeTabBySession[sessionId] ?? "memory") : "memory",
  );
  const collapsedSections = useLearningStore((s) => s.collapsedSections);
  const loadSnapshot = useLearningStore((s) => s.loadSnapshot);
  const setActiveTab = useLearningStore((s) => s.setActiveTab);
  const setConfig = useLearningStore((s) => s.setConfig);
  const approveCandidate = useLearningStore((s) => s.approveCandidate);
  const rejectCandidate = useLearningStore((s) => s.rejectCandidate);
  const runCurator = useLearningStore((s) => s.runCurator);
  const toggleSection = useLearningStore((s) => s.toggleSection);

  const memoryEvents = useMemoryStore(
    useShallow((s) => (sessionId ? (s.eventsBySession[sessionId] ?? []) : [])),
  );
  const memoryStatus = useMemoryStore(
    useShallow((s) => (sessionId ? s.statusBySession[sessionId] : null)),
  );
  const loadMemoryStatus = useMemoryStore((s) => s.loadStatus);

  useEffect(() => {
    if (!sessionId || !projectPath) return;
    void loadSnapshot(projectPath, sessionId);
    void loadMemoryStatus(sessionId);
  }, [sessionId, projectPath, loadSnapshot, loadMemoryStatus]);

  if (!sessionId) {
    return <div className="p-3 text-xs text-text-tertiary">无活动会话</div>;
  }

  if (!projectPath) {
    return <div className="p-3 text-xs text-text-tertiary">未选择项目</div>;
  }

  const config = snapshot?.config;

  const patchConfig = (patch: Partial<LearningConfig>) => {
    if (!config) return;
    void setConfig(projectPath, sessionId, patch);
  };

  const requestDeleteMemoryFile = (file: LearningMemorySummary) => {
    setDeleteMemoryError(null);
    setPendingDeleteMemory(file);
  };

  const confirmDeleteMemoryFile = () => {
    if (!pendingDeleteMemory) return;
    const file = pendingDeleteMemory;
    setDeleteMemoryError(null);
    apiClient
      .call("memory.deleteFile", { filePath: file.filePath })
      .then(() => {
        setExpandedMemoryPath((current) => (current === file.filePath ? null : current));
        setPendingDeleteMemory(null);
        void loadSnapshot(projectPath, sessionId);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setDeleteMemoryError(`删除失败: ${message}`);
      })
      .finally(() => setDeletingMemoryPath(null));
    setDeletingMemoryPath(file.filePath);
  };

  const diagnostics = [
    ...(snapshot?.memory.diagnostics ?? []),
    ...(snapshot?.skills.diagnostics ?? []),
    ...memoryEvents
      .slice(-5)
      .map((event) => `${event.customType} · ${relativeTime(event.timestamp)}`),
  ];

  return (
    <div
      data-testid="learning-panel"
      className="flex h-full min-w-0 flex-col overflow-x-hidden bg-bg-secondary text-text-primary"
    >
      <div className="min-w-0 shrink-0 overflow-hidden border-b border-border-secondary dark:border-surface-code/50">
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <Brain className="h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="truncate text-[11px] font-medium text-text-secondary">Learning</div>
            <div className="truncate text-[9px] text-text-tertiary">{displayProjectPath}</div>
          </div>
          {snapshot && (
            <div className="flex min-w-0 shrink-0 items-center gap-1 text-[9px] text-text-tertiary">
              <span>{snapshot.overview.memoryFiles} 记忆</span>
              <span>·</span>
              <span>{snapshot.overview.activeSkills} 技能</span>
              <span>·</span>
              <span>{snapshot.overview.pendingCandidates} 候选</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void loadSnapshot(projectPath, sessionId)}
            title="刷新"
            className="flex h-7 w-7 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-surface-hover/60 hover:text-text-secondary"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex min-w-0 shrink-0 overflow-x-auto border-b border-border-secondary bg-bg-secondary scrollbar-none dark:border-surface-code/50">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(sessionId, tab.id)}
              className={`flex h-7 items-center gap-1 border-b px-2 text-[11px] font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-accent text-accent"
                  : "border-transparent text-text-tertiary hover:bg-surface-hover/40 hover:text-text-secondary"
              }`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="border-b border-status-error/30 px-2.5 py-1.5 text-[10px] text-status-error">
          {error}
        </div>
      )}

      <div
        data-testid="learning-panel-scroll"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden py-1"
      >
        {!snapshot ? (
          <EmptyState label={loading ? "加载中" : "暂无 Learning 快照"} />
        ) : activeTab === "memory" ? (
          <div className="min-w-0 overflow-x-hidden">
            {snapshot.memory.entrypoint && (
              <div className="min-w-0 overflow-hidden border-b border-border-secondary dark:border-surface-code/50">
                <SectionHeader
                  collapsed={collapsedSections.has("memory-entrypoint")}
                  onToggle={() => toggleSection("memory-entrypoint")}
                  icon={FileText}
                  iconCls="text-status-warning"
                  label="入口文件"
                />
                {!collapsedSections.has("memory-entrypoint") && (
                  <div className="min-w-0 px-2.5 pb-1.5">
                    <FileLink file={snapshot.memory.entrypoint} />
                    <MemoryMarkdownPreview filePath={snapshot.memory.entrypoint.path} index />
                  </div>
                )}
              </div>
            )}
            <div className="min-w-0 overflow-hidden border-b border-border-secondary dark:border-surface-code/50">
              <SectionHeader
                collapsed={collapsedSections.has("memory-files")}
                onToggle={() => toggleSection("memory-files")}
                icon={Brain}
                iconCls="text-accent"
                label="记忆条目"
                badge={snapshot.memory.files.length}
              />
              {!collapsedSections.has("memory-files") &&
                (snapshot.memory.files.length > 0 ? (
                  <div className="min-w-0 space-y-1 px-2.5 pb-1.5">
                    {pendingDeleteMemory && (
                      <div className="min-w-0 overflow-hidden rounded border border-status-error/30 bg-status-error/5 px-2 py-1.5">
                        <div className="text-[10px] font-medium text-status-error">
                          删除记忆「
                          {pendingDeleteMemory.description ?? pendingDeleteMemory.filename}」？
                        </div>
                        <div className="mt-0.5 text-[9px] text-text-tertiary">
                          会删除对应 markdown 文件，并从 MEMORY.md 索引中移除引用。
                        </div>
                        {deleteMemoryError && (
                          <div className="mt-1 text-[9px] text-status-error">
                            {deleteMemoryError}
                          </div>
                        )}
                        <div className="mt-1.5 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={confirmDeleteMemoryFile}
                            disabled={deletingMemoryPath === pendingDeleteMemory.filePath}
                            className="h-6 rounded bg-status-error/10 px-2 text-[10px] text-status-error transition-colors hover:bg-status-error/15 disabled:cursor-wait disabled:opacity-60"
                          >
                            确认删除
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDeleteMemory(null);
                              setDeleteMemoryError(null);
                            }}
                            disabled={Boolean(deletingMemoryPath)}
                            className="h-6 rounded bg-surface-hover/35 px-2 text-[10px] text-text-tertiary transition-colors hover:bg-surface-hover/70 disabled:opacity-60"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                    {snapshot.memory.files.map((file) => (
                      <MemoryRow
                        key={file.filePath}
                        file={file}
                        expanded={expandedMemoryPath === file.filePath}
                        onToggle={() =>
                          setExpandedMemoryPath((current) =>
                            current === file.filePath ? null : file.filePath,
                          )
                        }
                        onDelete={() => requestDeleteMemoryFile(file)}
                        deleting={deletingMemoryPath === file.filePath}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState label="暂无沉淀条目" />
                ))}
            </div>
            <div className="min-w-0 overflow-hidden border-b border-border-secondary dark:border-surface-code/50">
              <SectionHeader
                collapsed={collapsedSections.has("memory-runtime")}
                onToggle={() => toggleSection("memory-runtime")}
                icon={SlidersHorizontal}
                iconCls="text-status-info"
                label="Memory Runtime"
                badge={(memoryStatus?.recentQueries?.length ?? 0) + memoryEvents.length}
              />
              {!collapsedSections.has("memory-runtime") && (
                <div className="min-w-0 px-2.5 pb-1.5">
                  <MemoryRuntime
                    status={memoryStatus}
                    events={memoryEvents}
                    memoryDir={snapshot.dirs.memoryDir}
                  />
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "skills" ? (
          <div className="border-b border-border-secondary dark:border-surface-code/50">
            <SectionHeader
              collapsed={collapsedSections.has("skills-list")}
              onToggle={() => toggleSection("skills-list")}
              icon={Wrench}
              iconCls="text-text-tertiary"
              label="项目技能"
              badge={snapshot.skills.items.length}
            />
            {!collapsedSections.has("skills-list") &&
              (snapshot.skills.items.length > 0 ? (
                <div className="px-2.5 pb-1.5 space-y-0.5">
                  {snapshot.skills.items.map((skill) => (
                    <SkillRow key={skill.baseDir} skill={skill} />
                  ))}
                </div>
              ) : (
                <EmptyState label="暂无项目技能" />
              ))}
          </div>
        ) : activeTab === "candidates" ? (
          <div className="border-b border-border-secondary dark:border-surface-code/50">
            <SectionHeader
              collapsed={collapsedSections.has("candidate-list")}
              onToggle={() => toggleSection("candidate-list")}
              icon={Sparkles}
              iconCls="text-status-info"
              label="待确认候选"
              badge={snapshot.candidates.length}
            />
            {!collapsedSections.has("candidate-list") &&
              (snapshot.candidates.length > 0 ? (
                <div className="px-2.5 pb-1.5 space-y-0.5">
                  {snapshot.candidates.map((candidate) => (
                    <CandidateRow
                      key={candidate.id}
                      candidate={candidate}
                      learningDir={snapshot.dirs.learningDir}
                      onApprove={(candidateId) =>
                        void approveCandidate(projectPath, sessionId, candidateId)
                      }
                      onReject={(candidateId) =>
                        void rejectCandidate(projectPath, sessionId, candidateId)
                      }
                    />
                  ))}
                </div>
              ) : (
                <EmptyState label="暂无待确认候选" />
              ))}
          </div>
        ) : activeTab === "curator" ? (
          <div>
            <div className="border-b border-border-secondary dark:border-surface-code/50">
              <SectionHeader
                collapsed={collapsedSections.has("skill-curator")}
                onToggle={() => toggleSection("skill-curator")}
                icon={Archive}
                iconCls="text-text-tertiary"
                label="技能整理"
              />
              {!collapsedSections.has("skill-curator") && (
                <div className="px-2.5 pb-1.5 flex flex-wrap gap-1.5">
                  {(["dry-run", "pending", "auto"] as LearningCuratorMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => void runCurator(projectPath, sessionId, "skill", mode)}
                      className="h-6 rounded bg-surface-hover/35 px-1.5 text-[10px] text-text-secondary transition-colors hover:bg-surface-hover/70"
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-b border-border-secondary dark:border-surface-code/50">
              <SectionHeader
                collapsed={collapsedSections.has("memory-curator")}
                onToggle={() => toggleSection("memory-curator")}
                icon={Brain}
                iconCls="text-accent"
                label="记忆整理"
              />
              {!collapsedSections.has("memory-curator") && (
                <div className="px-2.5 pb-1.5 flex flex-wrap gap-1.5">
                  {(["dry-run", "pending", "auto"] as LearningCuratorMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => void runCurator(projectPath, sessionId, "memory", mode)}
                      className="h-6 rounded bg-surface-hover/35 px-1.5 text-[10px] text-text-secondary transition-colors hover:bg-surface-hover/70"
                    >
                      {MODE_LABELS[mode]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-b border-border-secondary dark:border-surface-code/50">
              <SectionHeader
                collapsed={collapsedSections.has("curator-runs")}
                onToggle={() => toggleSection("curator-runs")}
                icon={FileText}
                iconCls="text-text-tertiary"
                label="最近记录"
                badge={snapshot.runs.length}
              />
              {!collapsedSections.has("curator-runs") &&
                (snapshot.runs.length > 0 ? (
                  <div className="px-2.5 pb-1.5 space-y-0.5">
                    {snapshot.runs.slice(0, 8).map((run) => (
                      <div
                        key={run.id}
                        className="rounded px-1 py-1 transition-colors hover:bg-surface-hover/50 dark:hover:bg-surface-code/40"
                      >
                        <div className="flex items-center gap-1.5">
                          <ToneBadge tone={run.status === "failed" ? "warning" : "muted"}>
                            {run.domain}
                          </ToneBadge>
                          <span className="min-w-0 flex-1 truncate text-[10px] text-text-primary">
                            {run.summary}
                          </span>
                          <span className="shrink-0 text-[9px] text-text-tertiary">
                            {relativeTime(run.completedAt ?? run.startedAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState label="暂无整理记录" />
                ))}
            </div>
          </div>
        ) : (
          <div>
            {config && (
              <>
                <SettingSection
                  icon={Brain}
                  title="记忆"
                  sectionKey="settings-memory"
                  collapsedSections={collapsedSections}
                  toggleSection={toggleSection}
                >
                  <div>
                    <SettingRow label="回忆注入">
                      <input
                        type="checkbox"
                        aria-label="回忆注入"
                        checked={config.memory.recallEnabled}
                        onChange={(e) =>
                          patchConfig({
                            memory: { ...config.memory, recallEnabled: e.target.checked },
                          })
                        }
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                    </SettingRow>
                    <SettingRow label="总结沉淀">
                      <ModeControl
                        value={config.memory.extractMode}
                        options={["off", "pending", "auto"]}
                        onChange={(value) =>
                          patchConfig({ memory: { ...config.memory, extractMode: value } })
                        }
                      />
                    </SettingRow>
                    <SettingRow label="整理模式">
                      <ModeControl
                        value={config.memory.curatorMode}
                        options={["dry-run", "pending", "auto"]}
                        onChange={(value) =>
                          patchConfig({ memory: { ...config.memory, curatorMode: value } })
                        }
                      />
                    </SettingRow>
                    <SettingRow label="定时整理">
                      <input
                        type="checkbox"
                        aria-label="定时整理"
                        checked={config.memory.curatorSchedule.enabled}
                        onChange={(e) =>
                          patchConfig({
                            memory: {
                              ...config.memory,
                              curatorSchedule: {
                                ...config.memory.curatorSchedule,
                                enabled: e.target.checked,
                              },
                            },
                          })
                        }
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                    </SettingRow>
                    <SettingRow label="间隔分钟">
                      <input
                        type="number"
                        aria-label="间隔分钟"
                        min={1}
                        value={config.memory.curatorSchedule.intervalMinutes}
                        onChange={(e) =>
                          patchConfig({
                            memory: {
                              ...config.memory,
                              curatorSchedule: {
                                ...config.memory.curatorSchedule,
                                intervalMinutes: Math.max(1, Number(e.target.value) || 1),
                              },
                            },
                          })
                        }
                        className="h-7 w-20 rounded-md border border-border-secondary/70 bg-bg-primary/40 px-2 text-right text-[11px] text-text-primary outline-none focus:border-border-focus"
                      />
                    </SettingRow>
                  </div>
                </SettingSection>
                <SettingSection
                  icon={Wrench}
                  title="技能"
                  sectionKey="settings-skills"
                  collapsedSections={collapsedSections}
                  toggleSection={toggleSection}
                >
                  <div>
                    <SettingRow label="技能沉淀">
                      <ModeControl
                        value={config.skills.distillMode}
                        options={["off", "pending", "auto"]}
                        onChange={(value) =>
                          patchConfig({ skills: { ...config.skills, distillMode: value } })
                        }
                      />
                    </SettingRow>
                    <SettingRow label="整理模式">
                      <ModeControl
                        value={config.skills.curatorMode}
                        options={["dry-run", "pending", "auto"]}
                        onChange={(value) =>
                          patchConfig({ skills: { ...config.skills, curatorMode: value } })
                        }
                      />
                    </SettingRow>
                    <SettingRow label="定时整理">
                      <input
                        type="checkbox"
                        aria-label="定时整理"
                        checked={config.skills.curatorSchedule.enabled}
                        onChange={(e) =>
                          patchConfig({
                            skills: {
                              ...config.skills,
                              curatorSchedule: {
                                ...config.skills.curatorSchedule,
                                enabled: e.target.checked,
                              },
                            },
                          })
                        }
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                    </SettingRow>
                    <SettingRow label="间隔分钟">
                      <input
                        type="number"
                        aria-label="间隔分钟"
                        min={1}
                        value={config.skills.curatorSchedule.intervalMinutes}
                        onChange={(e) =>
                          patchConfig({
                            skills: {
                              ...config.skills,
                              curatorSchedule: {
                                ...config.skills.curatorSchedule,
                                intervalMinutes: Math.max(1, Number(e.target.value) || 1),
                              },
                            },
                          })
                        }
                        className="h-7 w-20 rounded-md border border-border-secondary/70 bg-bg-primary/40 px-2 text-right text-[11px] text-text-primary outline-none focus:border-border-focus"
                      />
                    </SettingRow>
                  </div>
                </SettingSection>
              </>
            )}
            <div className="border-b border-border-secondary/70">
              <SectionHeader
                collapsed={collapsedSections.has("diagnostics")}
                onToggle={() => toggleSection("diagnostics")}
                icon={SlidersHorizontal}
                iconCls="text-text-tertiary"
                label="诊断"
                badge={diagnostics.length}
              />
              {!collapsedSections.has("diagnostics") && (
                <div className="px-2.5 pb-2">
                  <div className="space-y-1 text-[10px] text-text-tertiary">
                    <div className="truncate" title={snapshot.dirs.learningDir}>
                      learning: {snapshot.dirs.learningDir}
                    </div>
                    <div className="truncate" title={snapshot.dirs.memoryDir}>
                      memory: {snapshot.dirs.memoryDir}
                    </div>
                    <div className="truncate" title={snapshot.dirs.skillsDir}>
                      skills: {snapshot.dirs.skillsDir}
                    </div>
                    {diagnostics.map((item, index) => (
                      <div key={`${item}-${index}`} className="truncate" title={item}>
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

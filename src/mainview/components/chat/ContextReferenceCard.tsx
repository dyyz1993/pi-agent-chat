import { memo, useCallback } from "react";
import {
  BookOpen,
  Brain,
  ChevronRight,
  ExternalLink,
  FileCode,
  FileText,
  Link,
  Shield,
  Zap,
} from "lucide-react";

import type { TreeNode } from "../../types";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { formatFilePath } from "../../lib/format-path";
import { parseAttrs } from "./special-block-parser";
import type { SpecialBlock } from "./special-block-parser";

export type ContextReferenceKind = "rule" | "lsp" | "memory" | "skill" | "file" | "url";

export interface ContextReference {
  id: string;
  kind: ContextReferenceKind;
  title: string;
  subtitle?: string;
  path?: string;
  url?: string;
  line?: number;
  status?: "loaded" | "used" | "warning" | "error" | "already_loaded" | "reloaded";
  detail?: string;
}

export type ContextReferenceSegment =
  | { type: "text"; text: string }
  | { type: "references"; references: ContextReference[] };

const CONTEXT_TAG_REGEX =
  /<((?:skill)|(?:lsp)|(?:system-reminder)|(?:memory(?:-[\w-]+)?))((?:\s+[\w-]+="[^"]*")*)\s*>([\s\S]*?)<\/\1>/g;

const KIND_META = {
  rule: { label: "Rules", rowLabel: "Rule", Icon: Shield, color: "text-accent" },
  lsp: { label: "LSP", rowLabel: "LSP", Icon: FileCode, color: "text-status-warning" },
  memory: { label: "Memory", rowLabel: "Memory", Icon: Brain, color: "text-status-info" },
  skill: { label: "Skills", rowLabel: "Skill", Icon: BookOpen, color: "text-semantic-tool" },
  file: { label: "Files", rowLabel: "File", Icon: FileText, color: "text-text-secondary" },
  url: { label: "Links", rowLabel: "Link", Icon: Link, color: "text-status-info" },
} as const;

function basename(path: string): string {
  const clean = path.replace(/\/+$/, "");
  return clean.split("/").pop() || clean;
}

function normalizeMaybeAbsolutePath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed.startsWith("Users/")) return `/${trimmed}`;
  return trimmed;
}

function firstMeaningfulLine(body: string): string {
  return (
    body
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function extractSkillSummary(body: string): string {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("References are relative to"));
  const heading = lines.find((line) => line.startsWith("# "));
  return (heading ? heading.replace(/^#+\s*/, "") : (lines[0] ?? "")).slice(0, 140);
}

function extractMemoryPaths(body: string): string[] {
  const matches = body.match(
    /\/?Users\/[^\s<>"']*\/(?:\.pi\/agent\/memory|\.codex\/memories)\/[^\s<>"']+/g,
  );
  if (!matches) return [];
  return Array.from(new Set(matches.map(normalizeMaybeAbsolutePath)));
}

function referenceFromTag(
  tag: string,
  attrs: Record<string, string>,
  body: string,
  index: number,
): ContextReference[] {
  if (tag === "skill") {
    const name = attrs.name || attrs.title || "Skill";
    const location = attrs.location || attrs.path;
    return [
      {
        id: `skill:${location || name}:${index}`,
        kind: "skill",
        title: name,
        subtitle: extractSkillSummary(body) || undefined,
        path: location ? normalizeMaybeAbsolutePath(location) : undefined,
        status: "used",
        detail: body,
      },
    ];
  }

  if (tag === "lsp") {
    const title = firstMeaningfulLine(body) || attrs.title || "Diagnostics";
    return [
      {
        id: `lsp:${title}:${index}`,
        kind: "lsp",
        title,
        subtitle: attrs.path ? formatFilePath(attrs.path) : undefined,
        path: attrs.path ? normalizeMaybeAbsolutePath(attrs.path) : undefined,
        status: /error/i.test(title) ? "error" : "warning",
        detail: body,
      },
    ];
  }

  const memoryPaths = extractMemoryPaths(body);
  const isFailure = /fail|error/i.test(tag);
  const isSuccess = /success|created|updated|extract-result|dream-result/i.test(tag);
  const memoryStatus = isFailure ? "error" : isSuccess ? "loaded" : "used";
  if (memoryPaths.length > 0) {
    return memoryPaths.map((path, i) => ({
      id: `memory:${path}:${index}:${i}`,
      kind: "memory" as const,
      title: basename(path),
      subtitle: formatFilePath(path),
      path,
      status: memoryStatus,
      detail: body,
    }));
  }

  const summary = firstMeaningfulLine(body);
  return [
    {
      id: `memory:${tag}:${index}`,
      kind: "memory",
      title: isFailure ? "Memory failed" : isSuccess ? "Memory updated" : "Memory reference",
      subtitle: tag === "system-reminder" && summary ? summary.slice(0, 120) : undefined,
      status: memoryStatus,
      detail: body,
    },
  ];
}

export function extractContextReferenceSegments(text: string): ContextReferenceSegment[] {
  const segments: ContextReferenceSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  CONTEXT_TAG_REGEX.lastIndex = 0;

  while ((match = CONTEXT_TAG_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    segments.push({
      type: "references",
      references: referenceFromTag(match[1], parseAttrs(match[2]), match[3].trim(), index),
    });

    lastIndex = match.index + match[0].length;
    index += 1;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments.filter((segment) => segment.type === "references" || segment.text.length > 0);
}

export function stripContextReferenceTags(text: string): string {
  return extractContextReferenceSegments(text)
    .filter(
      (segment): segment is Extract<ContextReferenceSegment, { type: "text" }> =>
        segment.type === "text",
    )
    .map((segment) => segment.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function referencesFromSpecialBlock(block: SpecialBlock): ContextReference[] {
  return referenceFromTag(block.tag, block.attrs, block.body, 0);
}

function countByKind(references: ContextReference[]): string {
  const parts: string[] = [];
  for (const kind of ["rule", "lsp", "memory", "skill", "file", "url"] as const) {
    const count = references.filter((ref) => ref.kind === kind).length;
    if (count > 0) parts.push(`${KIND_META[kind].label} ${count}`);
  }
  return parts.join(" · ");
}

function statusLabel(status: ContextReference["status"]): string | null {
  switch (status) {
    case "already_loaded":
      return "loaded";
    case "reloaded":
      return "reloaded";
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "used":
      return "used";
    case "loaded":
      return "loaded";
    default:
      return null;
  }
}

function ContextReferenceRow({ reference }: { reference: ContextReference }) {
  const openFile = useExplorerStore((s) => s.openFile);
  const meta = KIND_META[reference.kind];
  const Icon = meta.Icon;
  const canOpen = !!reference.path || !!reference.url;

  const handleOpen = useCallback(() => {
    if (reference.url) {
      window.open(reference.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!reference.path) return;
    const node: TreeNode = {
      name: basename(reference.path),
      path: reference.path,
      type: "file",
    };
    void openFile(node, false);
  }, [openFile, reference.path, reference.url]);

  const status = statusLabel(reference.status);

  return (
    <button
      type="button"
      onClick={canOpen ? handleOpen : undefined}
      disabled={!canOpen}
      title={reference.path || reference.url || reference.detail || reference.title}
      className="flex w-full min-w-0 items-center gap-1.5 border-b border-border-secondary/20 px-3 py-1 text-left text-[11px] last:border-b-0 enabled:hover:bg-surface-hover/40 disabled:cursor-default"
    >
      <Icon className={`h-3 w-3 shrink-0 ${meta.color}`} />
      <span
        className={`shrink-0 rounded bg-surface-hover/60 px-1 py-px text-[9px] font-medium ${meta.color}`}
      >
        {meta.rowLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-secondary">
        <span className="text-text-primary">{reference.title}</span>
        {reference.subtitle && <span className="text-text-tertiary"> · {reference.subtitle}</span>}
        {reference.line != null && <span className="text-text-tertiary">:{reference.line}</span>}
      </span>
      {status && <span className="shrink-0 text-[10px] text-text-tertiary">{status}</span>}
      {canOpen && <ExternalLink className="h-3 w-3 shrink-0 text-text-tertiary" />}
    </button>
  );
}

export const ContextReferenceCard = memo(function ContextReferenceCard({
  references,
  defaultOpen = false,
}: {
  references: ContextReference[];
  defaultOpen?: boolean;
}) {
  if (references.length === 0) return null;
  return (
    <details
      className="group my-1 border-y border-border-secondary/30 bg-surface-dim/60"
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="flex min-h-7 cursor-pointer select-none items-center gap-1.5 px-3 py-1 text-[11px] text-text-secondary hover:bg-surface-hover/30 list-none">
        <ChevronRight className="h-3 w-3 shrink-0 text-text-tertiary transition-transform group-open:rotate-90" />
        <Zap className="h-3 w-3 shrink-0 text-accent" />
        <span className="font-medium text-text-primary">Context</span>
        <span className="min-w-0 truncate text-text-tertiary">{countByKind(references)}</span>
      </summary>
      <div className="border-t border-border-secondary/25">
        {references.map((reference) => (
          <ContextReferenceRow key={reference.id} reference={reference} />
        ))}
      </div>
    </details>
  );
});

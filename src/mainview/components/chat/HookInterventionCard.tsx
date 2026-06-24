import { memo, useMemo } from "react";
import {
  AlertTriangle,
  ChevronRight,
  FileCode,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Terminal,
} from "lucide-react";

import { parseAttrs } from "./special-block-parser";
import type { SpecialBlock } from "./special-block-parser";

export type HookInterventionStatus = "blocked" | "warning" | "ask" | "allowed" | "failed";

export interface HookIntervention {
  id?: string;
  status: HookInterventionStatus;
  title?: string;
  eventName?: string;
  source?: string;
  hookType?: string;
  toolName?: string;
  matcher?: string;
  command?: string;
  hookCommand?: string;
  reason?: string;
  error?: string;
  detail?: string;
}

const STATUS_META: Record<
  HookInterventionStatus,
  {
    label: string;
    Icon: typeof ShieldAlert;
    shellClass: string;
    iconClass: string;
    pillClass: string;
  }
> = {
  blocked: {
    label: "Hook blocked",
    Icon: ShieldAlert,
    shellClass: "border-status-error/30 bg-status-error/[0.06]",
    iconClass: "text-status-error",
    pillClass: "bg-status-error/15 text-status-error",
  },
  failed: {
    label: "Hook failed",
    Icon: AlertTriangle,
    shellClass: "border-status-error/30 bg-status-error/[0.06]",
    iconClass: "text-status-error",
    pillClass: "bg-status-error/15 text-status-error",
  },
  warning: {
    label: "Hook warning",
    Icon: ShieldAlert,
    shellClass: "border-status-warning/30 bg-status-warning/[0.06]",
    iconClass: "text-status-warning",
    pillClass: "bg-status-warning/15 text-status-warning",
  },
  ask: {
    label: "Hook approval",
    Icon: ShieldQuestion,
    shellClass: "border-status-warning/30 bg-status-warning/[0.06]",
    iconClass: "text-status-warning",
    pillClass: "bg-status-warning/15 text-status-warning",
  },
  allowed: {
    label: "Hook allowed",
    Icon: ShieldCheck,
    shellClass: "border-border-secondary/30 bg-surface-dim/60",
    iconClass: "text-text-tertiary",
    pillClass: "bg-surface-hover/60 text-text-tertiary",
  },
};

function firstLine(text: string | undefined): string {
  return (
    text
      ?.split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function normalizeStatus(value: string | undefined, body: string): HookInterventionStatus {
  const raw = `${value ?? ""} ${body}`.toLowerCase();
  if (raw.includes("block") || raw.includes("deny") || raw.includes("denied")) return "blocked";
  if (raw.includes("fail") || raw.includes("error")) return "failed";
  if (raw.includes("ask") || raw.includes("approval") || raw.includes("confirm")) return "ask";
  if (raw.includes("allow") || raw.includes("success")) return "allowed";
  return "warning";
}

export function interventionFromHookBlock(block: SpecialBlock): HookIntervention {
  const attrs = block.attrs;
  const body = block.body.trim();
  return {
    status: normalizeStatus(attrs.status ?? attrs.decision, body),
    title: attrs.title || attrs.from || attrs.name || "Hook intervention",
    eventName: attrs.eventName ?? attrs.event,
    source: attrs.source ?? attrs.from,
    hookType: attrs.hookType ?? attrs.type,
    toolName: attrs.toolName ?? attrs.tool,
    matcher: attrs.matcher,
    command: attrs.command,
    hookCommand: attrs.hookCommand,
    reason: attrs.reason || firstLine(body),
    error: attrs.error,
    detail: body,
  };
}

export function extractHookInterventionSegments(
  text: string,
): Array<{ type: "text"; text: string } | { type: "hook"; intervention: HookIntervention }> | null {
  const regex = /<hook((?:\s+[\w-]+="[^"]*")*)\s*>([\s\S]*?)<\/hook>/g;
  const segments: Array<
    { type: "text"; text: string } | { type: "hook"; intervention: HookIntervention }
  > = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let found = false;
  regex.lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    found = true;
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: "hook",
      intervention: interventionFromHookBlock({
        type: "special-block",
        tag: "hook",
        attrs: parseAttrs(match[1]),
        body: match[2].trim(),
        raw: match[0],
      }),
    });
    lastIndex = match.index + match[0].length;
  }

  if (!found) return null;
  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }
  return segments.filter((segment) => segment.type === "hook" || segment.text.length > 0);
}

export function stripHookInterventionTags(text: string): string {
  const segments = extractHookInterventionSegments(text);
  if (!segments) return text;
  return segments
    .filter((segment): segment is { type: "text"; text: string } => segment.type === "text")
    .map((segment) => segment.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-[11px]">
      <span className="text-text-tertiary">{label}</span>
      <span
        className={`min-w-0 break-words text-text-secondary ${mono ? "font-mono text-[10px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

export const HookInterventionCard = memo(function HookInterventionCard({
  intervention,
  defaultOpen = false,
}: {
  intervention: HookIntervention;
  defaultOpen?: boolean;
}) {
  const meta = STATUS_META[intervention.status];
  const Icon = meta.Icon;
  const summary = useMemo(() => {
    return (
      intervention.reason ||
      intervention.error ||
      intervention.matcher ||
      intervention.command ||
      intervention.title ||
      meta.label
    );
  }, [intervention, meta.label]);

  const target = [intervention.eventName, intervention.toolName].filter(Boolean).join(" · ");

  return (
    <details
      className={`group my-1 border-y ${meta.shellClass}`}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="flex min-h-7 cursor-pointer select-none items-center gap-1.5 px-3 py-1 text-[11px] list-none">
        <ChevronRight className="h-3 w-3 shrink-0 text-text-tertiary transition-transform group-open:rotate-90" />
        <Icon className={`h-3.5 w-3.5 shrink-0 ${meta.iconClass}`} />
        <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${meta.pillClass}`}>
          {meta.label}
        </span>
        {target && <span className="shrink-0 text-text-tertiary">{target}</span>}
        <span className="min-w-0 truncate text-text-secondary">{summary}</span>
      </summary>
      <div className="space-y-1 border-t border-border-secondary/20 px-3 py-2">
        <DetailRow label="Hook" value={intervention.title} />
        <DetailRow label="Event" value={intervention.eventName} />
        <DetailRow label="Target" value={intervention.toolName} />
        <DetailRow label="Matcher" value={intervention.matcher} mono />
        <DetailRow label="Source" value={intervention.source} />
        <DetailRow label="Reason" value={intervention.reason} />
        <DetailRow label="Error" value={intervention.error} />
        <DetailRow label="Command" value={intervention.command} mono />
        <DetailRow label="Hook Rule" value={intervention.hookCommand} mono />
      </div>
    </details>
  );
});

export function HookInterventionInlinePreview({
  status = "blocked",
  label = "blocked by hook",
}: {
  status?: HookInterventionStatus;
  label?: string;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] ${meta.pillClass}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function HookInterventionTargetIcon({ toolName }: { toolName?: string }) {
  if (toolName?.toLowerCase() === "bash") return <Terminal className="h-3 w-3" />;
  return <FileCode className="h-3 w-3" />;
}

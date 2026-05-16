import { useState, useCallback, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Bot,
  Wrench,
  Shield,
  FileText,
  Cpu,
  Eye,
  EyeOff,
  Copy,
  Check,
  Lock,
  Unlock,
  Info,
  RefreshCw,
  Settings2,
  Variable,
  Sparkles,
} from "lucide-react";
import { useAgentStore, type AgentDetail, type AgentToolInfo } from "../../stores/use-agent-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { copyToClipboard } from "../../utils/clipboard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  red: { bg: "bg-red-500/15", text: "text-red-400", dot: "bg-red-400" },
  blue: { bg: "bg-blue-500/15", text: "text-blue-400", dot: "bg-blue-400" },
  green: { bg: "bg-green-500/15", text: "text-green-400", dot: "bg-green-400" },
  yellow: { bg: "bg-yellow-500/15", text: "text-yellow-400", dot: "bg-yellow-400" },
  purple: { bg: "bg-purple-500/15", text: "text-purple-400", dot: "bg-purple-400" },
  orange: { bg: "bg-orange-500/15", text: "text-orange-400", dot: "bg-orange-400" },
};

function fieldValue(value: unknown): string {
  if (value === undefined || value === null) return "\u2014";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "\u2014";
  if (typeof value === "string") return value.trim() || "\u2014";
  return String(value);
}

function getSourceLabel(source: string): string {
  const map: Record<string, string> = {
    builtin: "Built-in",
    user: "User",
    project: "Project",
    plugin: "Plugin",
    flag: "Flag",
    policy: "Policy",
  };
  return map[source] ?? source;
}

function getModeLabel(mode?: string): string {
  if (!mode) return "Primary";
  const map: Record<string, string> = {
    primary: "Primary",
    subagent: "Sub-agent",
    all: "All",
  };
  return map[mode] ?? mode;
}

function FieldRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-[var(--color-text-secondary)] min-w-[80px]">{label}:</span>
      <span
        className={`text-[var(--color-text-primary)] ${mono ? "font-mono" : ""} ${
          value === "\u2014" ? "opacity-50" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper (collapsible)
// ---------------------------------------------------------------------------

function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--color-border-primary)]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 opacity-50" />
        )}
        <Icon className="w-3.5 h-3.5 opacity-60" />
        <span>{title}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool List
// ---------------------------------------------------------------------------

function ToolList({ agent, allTools }: { agent: AgentDetail; allTools: AgentToolInfo[] }) {
  const allowedSet = new Set(agent.tools ?? []);
  const disallowedSet = new Set(agent.disallowedTools ?? []);
  const tools = allTools ?? [];

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {tools.map((tool) => {
          const isAllowed = allowedSet.size === 0 || allowedSet.has(tool.name);
          const isDisallowed = disallowedSet.has(tool.name);
          return (
            <div
              key={tool.name}
              className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded ${
                isDisallowed
                  ? "bg-red-500/10 text-red-400"
                  : isAllowed
                    ? "text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] opacity-50"
              }`}
            >
              {isDisallowed ? (
                <Lock className="w-3 h-3 flex-shrink-0" />
              ) : isAllowed ? (
                <Unlock className="w-3 h-3 flex-shrink-0 text-green-400" />
              ) : (
                <Lock className="w-3 h-3 flex-shrink-0 opacity-30" />
              )}
              <span className="font-mono">{tool.name}</span>
              {tool.description && (
                <span className="text-[var(--color-text-secondary)] truncate ml-auto max-w-[60%]">
                  {tool.description}
                </span>
              )}
            </div>
          );
        })}
        {allTools.length === 0 && (
          <div className="text-xs text-[var(--color-text-secondary)] italic">No tools loaded</div>
        )}
      </div>
      <div className="pt-1 border-t border-[var(--color-border-primary)] space-y-1">
        <FieldRow
          label="Allowed filter"
          value={agent.tools && agent.tools.length > 0 ? agent.tools.join(", ") : "\u5168\u90e8"}
          mono
        />
        <FieldRow label="Blocked" value={fieldValue(agent.disallowedTools)} mono />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hooks List
// ---------------------------------------------------------------------------

function HooksList({ agent }: { agent: AgentDetail }) {
  const hooks = agent.hooks;
  if (!hooks || Object.keys(hooks).length === 0) {
    return <div className="text-xs text-[var(--color-text-secondary)] opacity-50">{"\u2014"}</div>;
  }

  return (
    <div className="space-y-2">
      {Object.entries(hooks).map(([event, items]) => (
        <div key={event}>
          <div className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">{event}</div>
          {items.map((hook, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] rounded px-2 py-1 mb-0.5"
            >
              <span className="font-mono text-[var(--color-accent)]">{hook.type}</span>
              <span className="truncate">
                {hook.type === "command" ? hook.command : hook.prompt}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Prompt Viewer
// ---------------------------------------------------------------------------

function PromptViewer({ agent }: { agent: AgentDetail }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copyToClipboard(agent.systemPrompt).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  }, [agent.systemPrompt]);

  if (!agent.systemPrompt) {
    return <div className="text-xs text-[var(--color-text-secondary)] opacity-50">{"\u2014"}</div>;
  }

  const preview = agent.systemPrompt.slice(0, 120);
  const isLong = agent.systemPrompt.length > 120;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors ml-auto"
          >
            {expanded ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{expanded ? "Collapse" : "Expand"}</span>
          </button>
        )}
      </div>
      <pre
        className={`text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words bg-[var(--color-bg-elevated)] rounded p-2 font-mono leading-relaxed ${
          expanded ? "max-h-[400px] overflow-y-auto" : "max-h-[80px] overflow-hidden relative"
        }`}
      >
        {expanded ? agent.systemPrompt : preview}
        {!expanded && isLong && <span className="text-[var(--color-text-secondary)]">...</span>}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variables Section
// ---------------------------------------------------------------------------

function VariablesSection({ agent }: { agent: AgentDetail }) {
  const vars = agent.variables;
  if (!vars || Object.keys(vars).length === 0) {
    return <div className="text-xs text-[var(--color-text-secondary)] opacity-50">{"\u2014"}</div>;
  }

  return (
    <div className="space-y-1">
      {Object.entries(vars).map(([key, value]) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="text-[var(--color-accent)] font-mono">{key}</span>
          <span className="text-[var(--color-text-secondary)]">=</span>
          <span className="text-[var(--color-text-primary)] truncate">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Initial Prompt Viewer
// ---------------------------------------------------------------------------

function InitialPromptViewer({ value }: { value: string | undefined }) {
  const [expanded, setExpanded] = useState(false);

  if (!value) {
    return <span className="text-xs text-[var(--color-text-primary)] opacity-50">{"\u2014"}</span>;
  }

  if (value.length <= 80) {
    return <span className="text-xs text-[var(--color-text-primary)] font-mono">{value}</span>;
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-[var(--color-accent)] hover:underline"
      >
        {expanded ? "Collapse" : `${value.length} chars \u2014 Expand`}
      </button>
      {expanded && (
        <pre className="text-xs text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] rounded p-2 font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto">
          {value}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AgentPanel
// ---------------------------------------------------------------------------

export function AgentPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const agentDetailBySession = useAgentStore((s) => s.agentDetailBySession);
  const allToolsBySession = useAgentStore((s) => s.allToolsBySession);
  const liveSystemPromptBySession = useAgentStore((s) => s.liveSystemPromptBySession);
  const loadingDetail = useAgentStore((s) => s.loadingDetail);
  const fetchAgentDetail = useAgentStore((s) => s.fetchAgentDetail);
  const fetchAllTools = useAgentStore((s) => s.fetchAllTools);
  const fetchSystemPrompt = useAgentStore((s) => s.fetchSystemPrompt);
  const currentAgentBySession = useAgentStore((s) => s.currentAgentBySession);

  const sessionId = activeSessionId ?? "";
  const agent = sessionId ? agentDetailBySession[sessionId] : undefined;
  const allTools = sessionId ? (allToolsBySession[sessionId] ?? []) : [];
  const currentAgentName = sessionId ? currentAgentBySession[sessionId] : undefined;

  const handleRefresh = useCallback(() => {
    if (sessionId) {
      fetchAgentDetail(sessionId);
      fetchAllTools(sessionId);
      fetchSystemPrompt(sessionId);
    }
  }, [sessionId, fetchAgentDetail, fetchAllTools, fetchSystemPrompt]);

  const activePanelTab = useLayoutStore((s) => s.activePanelTab);

  // Auto-load when tab becomes active
  useEffect(() => {
    if (activePanelTab === "agent" && sessionId && currentAgentName) {
      fetchAgentDetail(sessionId);
      fetchAllTools(sessionId);
      fetchSystemPrompt(sessionId);
    }
  }, [activePanelTab, sessionId, currentAgentName]);

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-secondary)]">
        No active session
      </div>
    );
  }

  if (!agent && !loadingDetail) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-sm text-[var(--color-text-secondary)]">
        <Bot className="w-8 h-8 opacity-30" />
        <span>{currentAgentName ? `Loading "${currentAgentName}"...` : "No agent selected"}</span>
        <button
          onClick={handleRefresh}
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          Refresh
        </button>
      </div>
    );
  }

  if (loadingDetail && !agent) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-secondary)]">
        Loading agent details...
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-sm text-[var(--color-text-secondary)]">
        <Bot className="w-8 h-8 opacity-30" />
        <span>No agent detail available</span>
        <button
          onClick={handleRefresh}
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          Load
        </button>
      </div>
    );
  }

  const colorStyle = AGENT_COLORS[agent.color ?? ""] ?? null;

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-primary)]">
        <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-primary)]">
          <Bot className="w-4 h-4" />
          <span>Agent</span>
        </div>
        <button
          onClick={handleRefresh}
          className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Section 1: Basic Info */}
      <Section title="Basic Info" icon={Info}>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">Name:</span>
            <span
              className={`text-base font-semibold ${colorStyle ? colorStyle.text : "text-[var(--color-text-primary)]"}`}
            >
              {colorStyle && (
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${colorStyle.dot} mr-1.5`}
                />
              )}
              {agent.name}
            </span>
          </div>
          <div className="flex items-start gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">Description:</span>
            <span className="text-[var(--color-text-primary)]">
              {fieldValue(agent.description)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">Source:</span>
            <span className="text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded px-1.5 py-0.5">
              {getSourceLabel(agent.source)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">File path:</span>
            {agent.filePath ? (
              <span
                className="text-[var(--color-text-primary)] font-mono text-[11px] truncate"
                title={agent.filePath}
              >
                {agent.filePath}
              </span>
            ) : (
              <span className="text-[var(--color-text-primary)] opacity-50">{"\u2014"}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">Mode:</span>
            <span className="text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded px-1.5 py-0.5">
              {getModeLabel(agent.mode)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">Color:</span>
            {agent.color ? (
              <span className="flex items-center gap-1.5 text-[var(--color-text-primary)]">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${colorStyle?.dot ?? "bg-[var(--color-text-secondary)]"}`}
                />
                {agent.color}
              </span>
            ) : (
              <span className="text-[var(--color-text-primary)] opacity-50">{"\u2014"}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">Hidden:</span>
            <span
              className={`text-[var(--color-text-primary)] ${agent.hidden === undefined ? "opacity-50" : ""}`}
            >
              {fieldValue(agent.hidden)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">Background:</span>
            <span
              className={`text-[var(--color-text-primary)] ${agent.background === undefined ? "opacity-50" : ""}`}
            >
              {fieldValue(agent.background)}
            </span>
          </div>
        </div>
      </Section>

      {/* Section 2: Model */}
      <Section title="Model" icon={Cpu}>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">Tier:</span>
            {agent.tier ? (
              <span className="text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded px-1.5 py-0.5">
                {agent.tier}
              </span>
            ) : (
              <span className="text-[var(--color-text-primary)] opacity-50">{"\u2014"}</span>
            )}
          </div>
          <FieldRow label="Thinking" value={fieldValue(agent.thinkingLevel)} />
          <FieldRow label="Model" value={fieldValue(agent.model)} mono />
          <FieldRow label="Effort" value={fieldValue(agent.effort)} />
        </div>
      </Section>

      {/* Section 3: Tools */}
      <Section title="Tools" icon={Wrench}>
        <ToolList agent={agent} allTools={allTools} />
      </Section>

      {/* Section 4: Permissions */}
      <Section title="Permissions" icon={Shield}>
        <PermissionInfo agent={agent} />
      </Section>

      {/* Section 5: Hooks */}
      <Section title="Hooks" icon={FileText} defaultOpen={false}>
        <HooksList agent={agent} />
      </Section>

      {/* Section 6: System Prompt */}
      <Section title="System Prompt" icon={FileText} defaultOpen={false}>
        <PromptViewer agent={agent} />
      </Section>

      {/* Section 7: Variables */}
      {agent.variables && Object.keys(agent.variables).length > 0 && (
        <Section title="Variables" icon={Variable} defaultOpen={false}>
          <VariablesSection agent={agent} />
        </Section>
      )}

      {/* Section 8: Skills */}
      <Section title="Skills" icon={Sparkles} defaultOpen={false}>
        {agent.skills && agent.skills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {agent.skills.map((skill) => (
              <span
                key={skill}
                className="text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] rounded px-2 py-0.5"
              >
                {skill}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[var(--color-text-secondary)] opacity-50">{"\u2014"}</div>
        )}
      </Section>

      {/* Section 9: Other Config */}
      <Section title="Other Config" icon={Settings2} defaultOpen={false}>
        <div className="space-y-1.5">
          <FieldRow label="Max turns" value={fieldValue(agent.maxTurns)} />
          <FieldRow label="Memory" value={fieldValue(agent.memory)} />
          <FieldRow label="Isolation" value={fieldValue(agent.isolation)} />
          <div className="flex items-start gap-2 text-xs">
            <span className="text-[var(--color-text-secondary)] min-w-[80px]">Initial prompt:</span>
            <InitialPromptViewer value={agent.initialPrompt} />
          </div>
        </div>
      </Section>

      {/* Section 10: Live System Prompt */}
      <Section title="Live System Prompt" icon={Eye} defaultOpen={false}>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fetchSystemPrompt(sessionId)}
              className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>
          </div>
          <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap break-words bg-[var(--color-bg-elevated)] rounded p-2 font-mono leading-relaxed max-h-[300px] overflow-y-auto">
            {liveSystemPromptBySession[sessionId] || "Click refresh to load"}
          </pre>
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permission Info (inline helper, used by Section 4)
// ---------------------------------------------------------------------------

function PermissionInfo({ agent }: { agent: AgentDetail }) {
  const modeLabels: Record<string, string> = {
    auto: "Auto (default)",
    acceptEdits: "Accept Edits",
    plan: "Plan (read-only)",
    dontAsk: "Don't Ask",
    "always-allow": "Always Allow",
    "always-deny": "Always Deny",
  };

  return (
    <div className="space-y-1">
      <FieldRow
        label="Mode"
        value={
          agent.permissionMode
            ? (modeLabels[agent.permissionMode] ?? agent.permissionMode)
            : "\u2014"
        }
      />
      <FieldRow
        label="Allowed"
        value={agent.tools && agent.tools.length > 0 ? agent.tools.join(", ") : "\u5168\u90e8"}
        mono
      />
      <FieldRow label="Blocked" value={fieldValue(agent.disallowedTools)} mono />
    </div>
  );
}

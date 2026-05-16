import { useState, useCallback, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Bot,
  Wrench,
  Shield,
  FileText,
  Cpu,
  Globe,
  Eye,
  EyeOff,
  Copy,
  Check,
  Lock,
  Unlock,
  Info,
} from "lucide-react";
import { useAgentStore, type AgentDetail, type AgentToolInfo } from "../../stores/use-agent-store";
import { useSessionStore } from "../../stores/use-session-store";
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
// Info Card
// ---------------------------------------------------------------------------

function AgentInfoCard({ agent }: { agent: AgentDetail }) {
  const colorStyle = AGENT_COLORS[agent.color ?? ""] ?? {
    bg: "bg-[var(--color-bg-elevated)]",
    text: "text-[var(--color-text-primary)]",
    dot: "bg-[var(--color-text-secondary)]",
  };

  return (
    <div className={`rounded-lg p-3 ${colorStyle.bg} space-y-2`}>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${colorStyle.dot}`} />
        <span className={`text-base font-semibold ${colorStyle.text}`}>{agent.name}</span>
        <span className="ml-auto text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg-primary)] rounded px-1.5 py-0.5">
          {getSourceLabel(agent.source)}
        </span>
      </div>
      {agent.description && (
        <p className="text-xs text-[var(--color-text-secondary)]">{agent.description}</p>
      )}
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="bg-[var(--color-bg-primary)] rounded px-1.5 py-0.5 text-[var(--color-text-secondary)]">
          {getModeLabel(agent.mode)}
        </span>
        {agent.tier && (
          <span className="bg-[var(--color-bg-primary)] rounded px-1.5 py-0.5 text-[var(--color-text-secondary)]">
            Tier: {agent.tier}
          </span>
        )}
        {agent.thinkingLevel && (
          <span className="bg-[var(--color-bg-primary)] rounded px-1.5 py-0.5 text-[var(--color-text-secondary)]">
            Think: {agent.thinkingLevel}
          </span>
        )}
      </div>
      {agent.filePath && (
        <div className="text-xs text-[var(--color-text-secondary)] truncate" title={agent.filePath}>
          📄 {agent.filePath}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool List
// ---------------------------------------------------------------------------

function ToolList({ agent, allTools }: { agent: AgentDetail; allTools: AgentToolInfo[] }) {
  const allowedSet = new Set(agent.tools ?? []);
  const disallowedSet = new Set(agent.disallowedTools ?? []);

  return (
    <div className="space-y-1">
      {allTools.map((tool) => {
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
  );
}

// ---------------------------------------------------------------------------
// Permission Info
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
    <div className="space-y-2 text-xs">
      {agent.permissionMode && (
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[var(--color-text-secondary)]">Mode:</span>
          <span className="text-[var(--color-text-primary)] font-medium">
            {modeLabels[agent.permissionMode] ?? agent.permissionMode}
          </span>
        </div>
      )}
      {agent.tools && agent.tools.length > 0 && (
        <div className="flex items-start gap-2">
          <Unlock className="w-3.5 h-3.5 text-green-400 mt-0.5" />
          <span className="text-[var(--color-text-secondary)]">Allowed:</span>
          <span className="text-[var(--color-text-primary)] font-mono">
            {agent.tools.join(", ")}
          </span>
        </div>
      )}
      {agent.disallowedTools && agent.disallowedTools.length > 0 && (
        <div className="flex items-start gap-2">
          <Lock className="w-3.5 h-3.5 text-red-400 mt-0.5" />
          <span className="text-[var(--color-text-secondary)]">Blocked:</span>
          <span className="text-[var(--color-text-primary)] font-mono">
            {agent.disallowedTools.join(", ")}
          </span>
        </div>
      )}
      {!agent.permissionMode && !agent.tools?.length && !agent.disallowedTools?.length && (
        <div className="text-[var(--color-text-secondary)] italic">
          No restrictions (full access)
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hooks List
// ---------------------------------------------------------------------------

function HooksList({ agent }: { agent: AgentDetail }) {
  const hooks = agent.hooks;
  if (!hooks || Object.keys(hooks).length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-secondary)] italic">No hooks configured</div>
    );
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
    return (
      <div className="text-xs text-[var(--color-text-secondary)] italic">No custom prompt</div>
    );
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
// Agent Variables
// ---------------------------------------------------------------------------

function VariablesSection({ agent }: { agent: AgentDetail }) {
  const vars = agent.variables;
  if (!vars || Object.keys(vars).length === 0) return null;

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
// Main AgentPanel
// ---------------------------------------------------------------------------

export function AgentPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const agentDetailBySession = useAgentStore((s) => s.agentDetailBySession);
  const allToolsBySession = useAgentStore((s) => s.allToolsBySession);
  const loadingDetail = useAgentStore((s) => s.loadingDetail);
  const fetchAgentDetail = useAgentStore((s) => s.fetchAgentDetail);
  const fetchAllTools = useAgentStore((s) => s.fetchAllTools);
  const currentAgentBySession = useAgentStore((s) => s.currentAgentBySession);

  const sessionId = activeSessionId ?? "";
  const agent = sessionId ? agentDetailBySession[sessionId] : undefined;
  const allTools = sessionId ? allToolsBySession[sessionId] : [];
  const currentAgentName = sessionId ? currentAgentBySession[sessionId] : undefined;

  // Auto-load detail when agent changes or panel first renders
  const handleRefresh = useCallback(() => {
    if (sessionId) {
      fetchAgentDetail(sessionId);
      fetchAllTools(sessionId);
    }
  }, [sessionId, fetchAgentDetail, fetchAllTools]);

  useEffect(() => {
    if (sessionId && currentAgentName) {
      fetchAgentDetail(sessionId);
      fetchAllTools(sessionId);
    }
  }, [sessionId, currentAgentName, fetchAgentDetail, fetchAllTools]);

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

      {/* Info Card */}
      <div className="p-3">
        <AgentInfoCard agent={agent} />
      </div>

      {/* Sections */}
      <Section title="Tools" icon={Wrench}>
        <ToolList agent={agent} allTools={allTools} />
      </Section>

      <Section title="Permissions" icon={Shield}>
        <PermissionInfo agent={agent} />
      </Section>

      {agent.hooks && Object.keys(agent.hooks).length > 0 && (
        <Section title="Hooks" icon={FileText} defaultOpen={false}>
          <HooksList agent={agent} />
        </Section>
      )}

      {agent.systemPrompt && (
        <Section title="System Prompt" icon={FileText} defaultOpen={false}>
          <PromptViewer agent={agent} />
        </Section>
      )}

      {agent.variables && Object.keys(agent.variables).length > 0 && (
        <Section title="Variables" icon={Cpu} defaultOpen={false}>
          <VariablesSection agent={agent} />
        </Section>
      )}

      {/* Skills */}
      {agent.skills && agent.skills.length > 0 && (
        <Section title="Skills" icon={Globe}>
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
        </Section>
      )}

      {/* Extra config */}
      <Section title="Advanced" icon={Info} defaultOpen={false}>
        <div className="space-y-1 text-xs">
          {agent.model && (
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-secondary)]">Model:</span>
              <span className="text-[var(--color-text-primary)] font-mono">{agent.model}</span>
            </div>
          )}
          {agent.maxTurns != null && (
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-secondary)]">Max Turns:</span>
              <span className="text-[var(--color-text-primary)]">{agent.maxTurns}</span>
            </div>
          )}
          {agent.effort && (
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-secondary)]">Effort:</span>
              <span className="text-[var(--color-text-primary)]">{agent.effort}</span>
            </div>
          )}
          {agent.memory && (
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-secondary)]">Memory:</span>
              <span className="text-[var(--color-text-primary)]">{agent.memory}</span>
            </div>
          )}
          {agent.isolation && (
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-secondary)]">Isolation:</span>
              <span className="text-[var(--color-text-primary)]">{agent.isolation}</span>
            </div>
          )}
          {agent.background != null && (
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-secondary)]">Background:</span>
              <span className="text-[var(--color-text-primary)]">
                {agent.background ? "Yes" : "No"}
              </span>
            </div>
          )}
          {agent.hidden != null && (
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-secondary)]">Hidden:</span>
              <span className="text-[var(--color-text-primary)]">
                {agent.hidden ? "Yes" : "No"}
              </span>
            </div>
          )}
          {agent.initialPrompt && (
            <div className="mt-1.5">
              <span className="text-[var(--color-text-secondary)]">Initial Prompt:</span>
              <pre className="mt-1 text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] rounded p-2 font-mono text-xs whitespace-pre-wrap">
                {agent.initialPrompt}
              </pre>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

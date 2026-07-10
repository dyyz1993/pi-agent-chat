import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ListChecks,
  Shield,
  Activity,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Trash2,
  RefreshCw,
  Loader2,
  FileText,
  Power,
  PowerOff,
  SkipForward,
  ExternalLink,
} from "lucide-react";
import { useHooksStore } from "../../stores/use-hooks-store";
import { useEffectiveSessionId } from "../../hooks/use-effective-session-id";
import { useSessionStore } from "../../stores/use-session-store";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useShallow } from "zustand/react/shallow";
import { formatFilePath } from "../../lib/format-path";
import { apiClient } from "../../lib/api-client";
import { DropdownSelect, PanelHeader } from "../primitives";
import type { HookLogEntry, HookRuleStats, HookConfigSnapshot } from "../../stores/use-hooks-store";

const DECISION_STYLES: Record<string, { icon: React.ElementType; cls: string }> = {
  allow: { icon: CheckCircle2, cls: "text-status-success bg-status-success/10" },
  block: { icon: XCircle, cls: "text-status-error bg-status-error/10" },
  ask: { icon: AlertCircle, cls: "text-status-warning bg-status-warning/10" },
};

const EVENT_SHORT: Record<string, string> = {
  PreToolUse: "Pre",
  PostToolUse: "Post",
  Stop: "Stop",
  Notification: "Notify",
  SubagentStop: "SubStop",
};

const SOURCE_STYLES: Record<string, string> = {
  policy: "text-semantic-agent bg-semantic-agent/10",
  global: "text-status-info bg-status-info/10",
  project: "text-status-success bg-status-success/10",
  local: "text-semantic-notify bg-semantic-notify/10",
  unknown: "text-text-tertiary bg-text-tertiary/10",
};

function DecisionBadge({ decision }: { decision: string }) {
  const config = DECISION_STYLES[decision] ?? DECISION_STYLES.ask;
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded font-medium ${config.cls}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {decision}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function resolveOpenablePath(
  path: string,
  projectPath: string | null,
  homePath: string | null = null,
): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed.startsWith("~/")) {
    if (!homePath) return null;
    return `${homePath.replace(/\/$/, "")}/${trimmed.slice(2)}`;
  }
  if (
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith(".pi/") ||
    trimmed.startsWith(".claude/")
  ) {
    if (!projectPath) return null;
    return decodeURI(new URL(trimmed, `file://${projectPath.replace(/\/$/, "")}/`).pathname);
  }
  return null;
}

function tokenizeCommand(command: string): string[] {
  return Array.from(command.matchAll(/"([^"]*)"|'([^']*)'|[^\s]+/g)).map(
    (match) => match[1] ?? match[2] ?? match[0],
  );
}

function commandName(commandPath: string): string {
  return commandPath.split("/").pop() ?? commandPath;
}

function getHookCommandParts(command: string): { prefix: string | null; script: string } | null {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return { prefix: null, script: tokens[0] };

  const first = commandName(tokens[0]);
  if (["bash", "sh", "zsh"].includes(first) && tokens[1]) {
    return { prefix: tokens[0], script: tokens[1] };
  }
  if (
    first === "env" &&
    tokens.length >= 3 &&
    ["bash", "sh", "zsh"].includes(commandName(tokens[1]))
  ) {
    return { prefix: `${tokens[0]} ${tokens[1]}`, script: tokens[2] };
  }
  return null;
}

function inferHomePath(config: HookConfigSnapshot | undefined): string | null {
  const globalSource = config?.sources.find(
    (src) => src.scope === "global" || src.scope === "pi-global",
  );
  const match = globalSource?.path.match(/^(.*)\/(?:\.claude|\.pi\/agent)\//);
  return match?.[1] ?? null;
}

function OpenableCode({
  label,
  path,
  onOpen,
  className = "",
}: {
  label: string;
  path: string | null;
  onOpen: (path: string) => void;
  className?: string;
}) {
  if (!path) {
    return (
      <code
        data-testid="hook-command-code"
        className={`whitespace-normal break-words [overflow-wrap:anywhere] ${className}`.trim()}
      >
        {label}
      </code>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      data-testid="hook-command-code"
      className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded px-0.5 text-left whitespace-normal break-words [overflow-wrap:anywhere] text-accent/80 hover:text-accent transition-colors ${className}`}
      title={`Open ${path}`}
    >
      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
      <code className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">
        {label}
      </code>
    </button>
  );
}

function HookCommandCode({
  command,
  projectPath,
  homePath = null,
  onOpen,
  className = "",
}: {
  command: string;
  projectPath: string | null;
  homePath?: string | null;
  onOpen: (path: string) => void;
  className?: string;
}) {
  const parts = getHookCommandParts(command);
  if (!parts) return <code className={className}>{command}</code>;

  const path = resolveOpenablePath(parts.script, projectPath, homePath);
  if (!path) return <code className={className}>{command}</code>;

  if (!parts.prefix) {
    return <OpenableCode label={parts.script} path={path} onOpen={onOpen} className={className} />;
  }

  return (
    <span
      className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 whitespace-normal break-words [overflow-wrap:anywhere] ${className}`}
    >
      <code className="shrink-0 text-text-tertiary">{parts.prefix}</code>
      <OpenableCode label={parts.script} path={path} onOpen={onOpen} className="min-w-0" />
    </span>
  );
}

function EntryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: HookLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const openFile = useExplorerStore((s) => s.openFile);
  const projectPath = useSessionStore(
    useShallow((s) => s.projectTabs.find((tab) => tab.id === s.activeProjectId)?.path ?? null),
  );

  const handleOpenPath = useCallback(
    (path: string) => {
      openFile({
        name: basename(path),
        path,
        type: "file",
      });
    },
    [openFile],
  );

  return (
    <div className="border-b border-border-secondary dark:border-surface-code/50 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full text-left px-2.5 py-1.5 hover:bg-surface-hover/30 dark:hover:bg-surface-dim/20 transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? (
            <ChevronDown className="w-3 h-3 shrink-0 text-text-tertiary" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0 text-text-tertiary" />
          )}
          <span className="text-[9px] px-1 py-0.5 rounded bg-surface-code dark:bg-surface-dim/60 text-text-secondary font-medium shrink-0">
            {EVENT_SHORT[entry.event] || entry.event}
          </span>
          <span className="text-[11px] text-text-primary truncate flex-1 min-w-0">
            {entry.toolName}
          </span>
          <DecisionBadge decision={entry.decision} />
          <span className="text-[9px] text-text-tertiary shrink-0">
            {formatDuration(entry.durationMs)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 pl-6">
          <code className="text-[9px] text-accent/70 truncate min-w-0">
            {entry.matcher}
          </code>
          <span className="text-text-secondary dark:text-text-tertiary shrink-0">|</span>
          <span className="text-[9px] text-text-tertiary shrink-0">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2 pt-0.5 pl-9 space-y-1">
          {entry.reason && <div className="text-[10px] text-text-secondary">{entry.reason}</div>}
          {entry.snippet && (
            <div className="p-2 bg-surface-code dark:bg-surface-dim/50 rounded text-[10px] text-text-secondary leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">
              {entry.snippet}
            </div>
          )}
          <div className="flex items-center gap-2 text-[9px] text-text-tertiary">
            <span>{entry.hookType}</span>
            {entry.command && (
              <>
                <span>|</span>
                <HookCommandCode
                  command={entry.command}
                  projectPath={projectPath}
                  onOpen={handleOpenPath}
                  className="min-w-0"
                />
              </>
            )}
            <span>|</span>
            <span>exit: {entry.exitCode}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  stat,
  isSkipped,
  onToggleSkip,
  projectPath,
  homePath,
  onOpenPath,
}: {
  stat: HookRuleStats;
  isSkipped?: boolean;
  onToggleSkip?: () => void;
  projectPath: string | null;
  homePath: string | null;
  onOpenPath: (path: string) => void;
}) {
  const total = stat.allowCount + stat.blockCount + stat.askCount;
  const sourceCls = SOURCE_STYLES[stat.source] ?? SOURCE_STYLES.unknown;
  return (
    <div
      className={`px-2.5 py-1.5 border-b border-border-secondary dark:border-surface-code/50 last:border-b-0 ${isSkipped ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[9px] px-1 py-0.5 rounded bg-surface-code dark:bg-surface-dim/60 text-text-secondary font-medium shrink-0">
          {EVENT_SHORT[stat.event] || stat.event}
        </span>
        <span className="text-[11px] text-text-primary truncate flex-1 min-w-0">
          {stat.matcher}
        </span>
        {isSkipped && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-status-warning/10 text-status-warning font-medium shrink-0 flex items-center gap-0.5">
            <SkipForward className="w-2.5 h-2.5" />
            skipped
          </span>
        )}
        <span className={`text-[9px] px-1 py-0.5 rounded font-medium shrink-0 ${sourceCls}`}>
          {stat.source}
        </span>
        {onToggleSkip && (
          <button
            onClick={onToggleSkip}
            className="p-0.5 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors shrink-0"
            title={isSkipped ? "Unskip this rule" : "Skip this rule"}
          >
            <SkipForward className={`w-3 h-3 ${isSkipped ? "text-status-warning" : ""}`} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5 pl-5">
        <HookCommandCode
          command={stat.command}
          projectPath={projectPath}
          homePath={homePath}
          onOpen={onOpenPath}
          className="text-[9px] min-w-0 flex-1"
        />
        <div className="flex items-center gap-1.5 text-[9px] shrink-0">
          {stat.allowCount > 0 && (
            <span className="text-status-success">{stat.allowCount} allow</span>
          )}
          {stat.blockCount > 0 && (
            <span className="text-status-error">{stat.blockCount} block</span>
          )}
          {stat.askCount > 0 && <span className="text-status-warning">{stat.askCount} ask</span>}
          <span className="text-text-tertiary">({total})</span>
        </div>
      </div>
    </div>
  );
}

function ConfigSources({
  config,
  projectPath,
  homePath,
  onOpenPath,
}: {
  config: HookConfigSnapshot;
  projectPath: string | null;
  homePath: string | null;
  onOpenPath: (path: string) => void;
}) {
  if (config.sources.length === 0) return null;
  return (
    <div className="border-t border-border-secondary dark:border-surface-code/50">
      <div className="px-2.5 py-1.5 text-[10px] font-medium text-text-secondary">
        Config Sources
      </div>
      {config.sources.map((src, i) => {
        const sourcePath = src.exists ? resolveOpenablePath(src.path, projectPath, homePath) : null;
        return (
          <div
            key={`${src.path}-${i}`}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px]"
          >
            {src.exists ? (
              <FileText className="w-2.5 h-2.5 text-status-success shrink-0" />
            ) : (
              <FileText className="w-2.5 h-2.5 text-text-tertiary shrink-0" />
            )}
            <OpenableCode
              label={formatFilePath(src.path)}
              path={sourcePath}
              onOpen={onOpenPath}
              className="text-text-tertiary truncate min-w-0 flex-1"
            />
            <span className="text-[9px] px-1 py-0.5 rounded bg-surface-code dark:bg-surface-dim/60 text-text-secondary shrink-0">
              {src.scope}
            </span>
            {src.disabled && (
              <span className="text-[9px] text-status-warning shrink-0">disabled</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConfigEvents({
  config,
  projectPath,
  homePath,
  onOpenPath,
}: {
  config: HookConfigSnapshot;
  projectPath: string | null;
  homePath: string | null;
  onOpenPath: (path: string) => void;
}) {
  if (config.events.length === 0) return null;
  return (
    <div className="border-t border-border-secondary dark:border-surface-code/50">
      <div className="px-2.5 py-1.5 text-[10px] font-medium text-text-secondary">
        Configured Events
      </div>
      {config.events.map((evt) => (
        <div key={evt.name} className="px-2.5 pb-1.5">
          <div className="text-[10px] font-medium text-text-primary mb-0.5">{evt.name}</div>
          {evt.groups.map((group, gi) => (
            <div key={`${group.matcher}-${gi}`} className="pl-3 space-y-0.5">
              <div className="flex items-center gap-1 text-[9px]">
                <code className="text-accent/70 truncate">{group.matcher}</code>
                <span className="text-text-tertiary">|</span>
                <span className="text-text-tertiary">{group.source}</span>
              </div>
              {group.hooks.map((hook, hi) => (
                <div key={`${hook.type}-${hi}`} className="pl-3 text-[9px] text-text-tertiary">
                  [{hook.type}]
                  {hook.command && (
                    <HookCommandCode
                      command={hook.command}
                      projectPath={projectPath}
                      homePath={homePath}
                      onOpen={onOpenPath}
                      className="ml-1 text-[9px]"
                    />
                  )}
                  {hook.url && (
                    <code className="ml-1 text-status-info/70 whitespace-normal break-words [overflow-wrap:anywhere]">
                      {hook.url}
                    </code>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function HooksPanel() {
  const activeSessionId = useEffectiveSessionId();
  const activeProjectPath = useSessionStore(
    useShallow((s) => s.projectTabs.find((tab) => tab.id === s.activeProjectId)?.path ?? null),
  );
  const activeTab = useHooksStore((s) => s.activeTab);
  const setActiveTab = useHooksStore((s) => s.setActiveTab);
  const session = useHooksStore(useShallow((s) => s.bySession[activeSessionId ?? ""] ?? null));
  const fetchLog = useHooksStore((s) => s.fetchLog);
  const fetchConfig = useHooksStore((s) => s.fetchConfig);
  const clearLog = useHooksStore((s) => s.clearLog);
  const addEntry = useHooksStore((s) => s.addEntry);
  const setEnabled = useHooksStore((s) => s.setEnabled);
  const skipRule = useHooksStore((s) => s.skipRule);
  const unskipRule = useHooksStore((s) => s.unskipRule);

  const [expandedEntry, setExpandedEntry] = useState<number | null>(null);
  const [filterEvent, setFilterEvent] = useState<string | undefined>(undefined);

  const entries = session?.entries || [];
  const ruleStats = session?.ruleStats || [];
  const totalExecutions = session?.totalExecutions || 0;
  const configSnapshot = session?.configSnapshot;
  const loading = session?.loading || false;
  const openFile = useExplorerStore((s) => s.openFile);
  const homePath = useMemo(() => inferHomePath(configSnapshot ?? undefined), [configSnapshot]);

  const handleOpenPath = useCallback(
    (path: string) => {
      openFile({
        name: basename(path),
        path,
        type: "file",
      });
    },
    [openFile],
  );

  useEffect(() => {
    if (!activeSessionId) return;
    fetchLog(activeSessionId, 100, filterEvent);
  }, [activeSessionId, filterEvent, fetchLog]);

  useEffect(() => {
    if (!activeSessionId) return;
    fetchConfig(activeSessionId);
  }, [activeSessionId, fetchConfig]);

  useEffect(() => {
    if (!activeSessionId) return;
    let subId: string | undefined;
    let sub2Id: string | undefined;
    apiClient
      .subscribe("hooks.executed", (payload) => {
        addEntry(activeSessionId, payload as HookLogEntry);
      })
      .then((id) => {
        subId = id;
      })
      .catch(() => {});
    apiClient
      .subscribe("hooks.blocked", (payload) => {
        addEntry(activeSessionId, payload as HookLogEntry);
      })
      .then((id) => {
        sub2Id = id;
      })
      .catch(() => {});
    return () => {
      if (subId) apiClient.unsubscribe(subId);
      if (sub2Id) apiClient.unsubscribe(sub2Id);
    };
  }, [activeSessionId, addEntry]);

  const filteredEntries = filterEvent ? entries.filter((e) => e.event === filterEvent) : entries;

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        icon={ListChecks}
        title="Hooks"
        trailing={
          <>
            <span className="text-[9px] text-text-tertiary">{totalExecutions} executions</span>
            {configSnapshot && (
              <button
                onClick={() => {
                  if (activeSessionId) setEnabled(activeSessionId, !configSnapshot.runtimeEnabled);
                }}
                className={`p-1 rounded transition-colors ${
                  configSnapshot.runtimeEnabled
                    ? "text-status-success hover:bg-status-success/10"
                    : "text-status-error hover:bg-status-error/10"
                }`}
                title={
                  configSnapshot.runtimeEnabled
                    ? "Hooks enabled (click to disable)"
                    : "Hooks disabled (click to enable)"
                }
              >
                {configSnapshot.runtimeEnabled ? (
                  <Power className="w-3 h-3" />
                ) : (
                  <PowerOff className="w-3 h-3" />
                )}
              </button>
            )}
          </>
        }
      />

      <div className="flex items-center border-b border-border-secondary dark:border-surface-code shrink-0">
        <button
          onClick={() => setActiveTab("activity")}
          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors border-b-2 ${
            activeTab === "activity"
              ? "text-accent border-accent"
              : "text-text-tertiary border-transparent hover:text-text-primary"
          }`}
        >
          Activity
        </button>
        <button
          onClick={() => setActiveTab("rules")}
          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors border-b-2 ${
            activeTab === "rules"
              ? "text-accent border-accent"
              : "text-text-tertiary border-transparent hover:text-text-primary"
          }`}
        >
          Rules
        </button>
        <div className="ml-auto flex items-center gap-1 px-2">
          {activeTab === "activity" && (
            <>
              <DropdownSelect
                value={filterEvent ?? ""}
                onChange={(next) => setFilterEvent(next || undefined)}
                ariaLabel="Filter hook events"
                className="h-6 w-[7.25rem] rounded px-1.5 py-0 text-[9px] dark:bg-surface-dim/50"
                menuClassName="text-[9px]"
                options={[
                  { value: "", label: "All events" },
                  { value: "PreToolUse", label: "PreToolUse" },
                  { value: "PostToolUse", label: "PostToolUse" },
                  { value: "Stop", label: "Stop" },
                  { value: "Notification", label: "Notification" },
                ]}
              />
              <button
                onClick={() => {
                  if (activeSessionId) clearLog(activeSessionId);
                }}
                className="p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors"
                title="Clear log"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
          <button
            onClick={() => {
              if (activeSessionId) fetchLog(activeSessionId, 100, filterEvent);
            }}
            className="p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
          </div>
        ) : activeTab === "activity" ? (
          filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Activity className="w-8 h-8 text-text-secondary dark:text-text-tertiary mb-3" />
              <p className="text-xs text-text-tertiary font-medium">No hook activity</p>
              <p className="text-[10px] text-text-tertiary mt-1 max-w-[200px] leading-relaxed">
                Hook executions will appear here as the agent runs tools.
              </p>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                expanded={expandedEntry === entry.id}
                onToggle={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
              />
            ))
          )
        ) : (
          <>
            {ruleStats.length === 0 && (!configSnapshot || configSnapshot.events.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Shield className="w-8 h-8 text-text-secondary dark:text-text-tertiary mb-3" />
                <p className="text-xs text-text-tertiary font-medium">No rules configured</p>
                <p className="text-[10px] text-text-tertiary mt-1 max-w-[200px] leading-relaxed">
                  Configure hooks in your settings files to see rule stats here.
                </p>
              </div>
            ) : (
              <>
                {ruleStats.length > 0 && (
                  <div>
                    <div className="px-2.5 py-1.5 text-[10px] font-medium text-text-secondary border-b border-border-secondary dark:border-surface-code/50">
                      Rule Stats
                    </div>
                    {ruleStats.map((stat, i) => {
                      const isSkipped =
                        configSnapshot?.skippedRules?.some(
                          (r) => r.event === stat.event && r.matcher === stat.matcher,
                        ) ?? false;
                      return (
                        <RuleRow
                          key={`${stat.matcher}-${stat.event}-${i}`}
                          stat={stat}
                          isSkipped={isSkipped}
                          projectPath={activeProjectPath}
                          homePath={homePath}
                          onOpenPath={handleOpenPath}
                          onToggleSkip={
                            activeSessionId
                              ? () => {
                                  if (isSkipped) {
                                    unskipRule(activeSessionId, stat.event, stat.matcher);
                                  } else {
                                    skipRule(activeSessionId, stat.event, stat.matcher);
                                  }
                                }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                )}
                {configSnapshot && (
                  <ConfigSources
                    config={configSnapshot}
                    projectPath={activeProjectPath}
                    homePath={homePath}
                    onOpenPath={handleOpenPath}
                  />
                )}
                {configSnapshot && (
                  <ConfigEvents
                    config={configSnapshot}
                    projectPath={activeProjectPath}
                    homePath={homePath}
                    onOpenPath={handleOpenPath}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

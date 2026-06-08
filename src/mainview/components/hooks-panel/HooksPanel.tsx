import { useEffect, useState } from "react";
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
} from "lucide-react";
import { useHooksStore } from "../../stores/use-hooks-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useShallow } from "zustand/react/shallow";
import { formatFilePath } from "../../lib/format-path";
import { apiClient } from "../../lib/api-client";
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

function EntryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: HookLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
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
          <code className="text-[9px] text-semantic-accent/70 truncate min-w-0">
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
                <code className="truncate min-w-0">{entry.command}</code>
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

function RuleRow({ stat, isSkipped, onToggleSkip }: {
  stat: HookRuleStats;
  isSkipped?: boolean;
  onToggleSkip?: () => void;
}) {
  const total = stat.allowCount + stat.blockCount + stat.askCount;
  const sourceCls = SOURCE_STYLES[stat.source] ?? SOURCE_STYLES.unknown;
  return (
    <div className={`px-2.5 py-1.5 border-b border-border-secondary dark:border-surface-code/50 last:border-b-0 ${isSkipped ? "opacity-50" : ""}`}>
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
        <code className="text-[9px] text-semantic-accent/70 truncate min-w-0 flex-1">
          {stat.command}
        </code>
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

function ConfigSources({ config }: { config: HookConfigSnapshot }) {
  if (config.sources.length === 0) return null;
  return (
    <div className="border-t border-border-secondary dark:border-surface-code/50">
      <div className="px-2.5 py-1.5 text-[10px] font-medium text-text-secondary">
        Config Sources
      </div>
      {config.sources.map((src, i) => (
        <div key={`${src.path}-${i}`} className="flex items-center gap-1.5 px-2.5 py-1 text-[10px]">
          {src.exists ? (
            <FileText className="w-2.5 h-2.5 text-status-success shrink-0" />
          ) : (
            <FileText className="w-2.5 h-2.5 text-text-tertiary shrink-0" />
          )}
          <span className="text-text-tertiary truncate min-w-0 flex-1" title={src.path}>
            {formatFilePath(src.path)}
          </span>
          <span className="text-[9px] px-1 py-0.5 rounded bg-surface-code dark:bg-surface-dim/60 text-text-secondary shrink-0">
            {src.scope}
          </span>
          {src.disabled && (
            <span className="text-[9px] text-status-warning shrink-0">disabled</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ConfigEvents({ config }: { config: HookConfigSnapshot }) {
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
                <code className="text-semantic-accent/70 truncate">{group.matcher}</code>
                <span className="text-text-tertiary">|</span>
                <span className="text-text-tertiary">{group.source}</span>
              </div>
              {group.hooks.map((hook, hi) => (
                <div key={`${hook.type}-${hi}`} className="pl-3 text-[9px] text-text-tertiary">
                  [{hook.type}]
                  {hook.command && (
                    <code className="ml-1 text-semantic-accent/70 truncate">{hook.command}</code>
                  )}
                  {hook.url && (
                    <code className="ml-1 text-status-info/70 truncate">{hook.url}</code>
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
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
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
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border-secondary dark:border-surface-code shrink-0">
        <ListChecks className="w-3.5 h-3.5 text-semantic-accent" />
        <span className="text-[11px] font-medium text-text-secondary">Hooks</span>
        <span className="text-[9px] text-text-tertiary ml-auto">{totalExecutions} executions</span>
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
            title={configSnapshot.runtimeEnabled ? "Hooks enabled (click to disable)" : "Hooks disabled (click to enable)"}
          >
            {configSnapshot.runtimeEnabled ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
          </button>
        )}
      </div>

      <div className="flex items-center border-b border-border-secondary dark:border-surface-code shrink-0">
        <button
          onClick={() => setActiveTab("activity")}
          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors border-b-2 ${
            activeTab === "activity"
              ? "text-semantic-accent border-semantic-accent"
              : "text-text-tertiary border-transparent hover:text-text-primary"
          }`}
        >
          Activity
        </button>
        <button
          onClick={() => setActiveTab("rules")}
          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors border-b-2 ${
            activeTab === "rules"
              ? "text-semantic-accent border-semantic-accent"
              : "text-text-tertiary border-transparent hover:text-text-primary"
          }`}
        >
          Rules
        </button>
        <div className="ml-auto flex items-center gap-1 px-2">
          {activeTab === "activity" && (
            <>
              <select
                value={filterEvent ?? ""}
                onChange={(e) => setFilterEvent(e.target.value || undefined)}
                className="text-[9px] bg-surface-code dark:bg-surface-dim/50 text-text-secondary border border-border-secondary rounded px-1 py-0.5"
              >
                <option value="">All events</option>
                <option value="PreToolUse">PreToolUse</option>
                <option value="PostToolUse">PostToolUse</option>
                <option value="Stop">Stop</option>
                <option value="Notification">Notification</option>
              </select>
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
                      const isSkipped = configSnapshot?.skippedRules?.some(
                        (r) => r.event === stat.event && r.matcher === stat.matcher,
                      ) ?? false;
                      return (
                        <RuleRow
                          key={`${stat.matcher}-${stat.event}-${i}`}
                          stat={stat}
                          isSkipped={isSkipped}
                          onToggleSkip={activeSessionId ? () => {
                            if (isSkipped) {
                              unskipRule(activeSessionId, stat.event, stat.matcher);
                            } else {
                              skipRule(activeSessionId, stat.event, stat.matcher);
                            }
                          } : undefined}
                        />
                      );
                    })}
                  </div>
                )}
                {configSnapshot && <ConfigSources config={configSnapshot} />}
                {configSnapshot && <ConfigEvents config={configSnapshot} />}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

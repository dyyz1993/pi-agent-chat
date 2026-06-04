import { useState, useEffect } from "react";
import {
  Shield,
  ChevronDown,
  ChevronRight,
  Zap,
  Clock,
  FileCode,
  CheckCircle2,
  XCircle,
  RefreshCw,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRulesStore } from "../../stores/use-rules-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useShallow } from "zustand/react/shallow";
import { formatFilePath } from "../../lib/format-path";
import { apiClient } from "../../lib/api-client";
import type { RuleDetail, MatchRecord, LifecycleEntry } from "../../../shared/modules/rules";
import { createLogger } from "../../../shared/lib/logger";

const log = createLogger("config");

const SCOPE_KEYS: Record<string, string> = {
  user: "scopeUser",
  pi: "scopePi",
  project: "scopeProject",
  managed: "scopeSystem",
};

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

function useRuleContent(filePath: string | undefined, expanded: boolean) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded || !filePath) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const baseUrl = apiClient.getBaseUrl();
    const token = apiClient.getAuthToken();
    fetch(`${baseUrl}/file/${encodeURIComponent(filePath)}?token=${token}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
      .then((text) => {
        if (!cancelled) {
          const stripped = text.replace(/^---\r?\n[\s\S]*?\n?---\r?\n?/, "");
          setContent(stripped);
          setLoading(false);
        }
      })
      .catch((err) => {
        log.warn("rules load failed", { error: String(err) });
        if (!cancelled) {
          setContent(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, expanded]);

  return { content, loading };
}

function RuleCard({
  rule,
  isInjected,
  expanded,
  onTriggered,
  onToggle,
}: {
  rule: RuleDetail;
  isInjected: boolean;
  expanded: boolean;
  onTriggered: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("rules");
  const severityConfig: Record<string, { key: string; cls: string }> = {
    critical: { key: "severityCritical", cls: "text-status-error bg-status-error/10" },
    high: { key: "severityHigh", cls: "text-semantic-notify bg-semantic-notify/10" },
    medium: { key: "severityMedium", cls: "text-status-warning bg-status-warning/10" },
    low: { key: "severityLow", cls: "text-status-info bg-status-info/10" },
    hint: { key: "severityHint", cls: "text-text-tertiary bg-text-tertiary/10" },
  };
  const sev = severityConfig[rule.severity] || severityConfig.medium;
  const { content, loading } = useRuleContent(rule.filePath, expanded);

  return (
    <div className="border-b border-border-secondary dark:border-surface-code/50 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full text-left px-2.5 py-1.5 hover:bg-surface-hover/30 dark:hover:bg-surface-dim/20 transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isInjected ? (
            <CheckCircle2 className="w-2.5 h-2.5 text-status-success shrink-0" />
          ) : onTriggered ? (
            <Zap className="w-2.5 h-2.5 text-status-warning shrink-0" />
          ) : (
            <Clock className="w-2.5 h-2.5 text-text-tertiary shrink-0" />
          )}
          <span className="text-[11px] text-text-primary truncate flex-1 min-w-0">
            {rule.title}
          </span>
          <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${sev.cls}`}>{t(sev.key)}</span>
        </div>
        <div className="grid grid-cols-[auto_auto_1fr] items-center gap-x-1.5 gap-y-0 mt-0.5">
          <span className="text-[9px] text-text-tertiary dark:text-text-secondary truncate col-start-1">
            {rule.name}
          </span>
          <span className="text-[9px] text-text-secondary dark:text-text-tertiary col-start-2">
            |
          </span>
          <span className="text-[9px] text-text-tertiary dark:text-text-secondary truncate col-start-3 min-w-0">
            {t(SCOPE_KEYS[rule.scope] || rule.scope)}
            {!rule.isUnconditional && rule.globs.length > 0 && (
              <>
                <span className="text-text-secondary dark:text-text-tertiary mx-1">·</span>
                <code className="text-[9px] text-semantic-accent/70 truncate">
                  {rule.globs.join(", ")}
                </code>
              </>
            )}
            {rule.isUnconditional && (
              <span className="text-[9px] text-status-success/70 ml-1">{t("alwaysActive")}</span>
            )}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2 pt-0.5 space-y-1">
          {rule.description && (
            <div className="text-[10px] text-text-tertiary">{rule.description}</div>
          )}
          {rule.source && (
            <div className="text-[10px] text-text-tertiary dark:text-text-secondary">
              {t("source")}: {rule.source}
            </div>
          )}
          {!rule.isUnconditional && rule.globs.length > 0 && (
            <div className="text-[10px] text-text-tertiary dark:text-text-secondary">
              {t("globPattern")}{" "}
              <code className="text-[9px] text-semantic-accent/70">{rule.globs.join(", ")}</code>
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-text-tertiary">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              <span>{t("loading", { ns: "common" })}</span>
            </div>
          )}
          {!loading && content && (
            <div className="mt-1.5 p-2 bg-surface-code dark:bg-surface-dim/50 rounded text-[10px] text-text-secondary leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto font-mono">
              {content}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MatchRecordCard({ record }: { record: MatchRecord }) {
  const details = record.matchedRuleDetails ?? [];
  return (
    <div className="px-2.5 py-1 text-[10px] space-y-0.5">
      <div className="flex items-center gap-1.5">
        <Zap className="w-2.5 h-2.5 text-status-warning shrink-0" />
        <span className="text-text-tertiary">
          {new Date(record.timestamp).toLocaleTimeString()}
        </span>
        <span className="text-text-secondary dark:text-text-tertiary">|</span>
        <span className="text-text-tertiary truncate" title={record.filePath}>
          {formatFilePath(record.filePath)}
        </span>
        <span className="text-text-secondary dark:text-text-tertiary">&rarr;</span>
        <span className="text-text-secondary truncate">{record.toolName}</span>
      </div>
      {details.map((d) => (
        <div key={d.name} className="flex items-center gap-1 pl-5">
          <span className="text-text-tertiary truncate">{d.title || d.name}</span>
          <code className="text-[9px] text-semantic-accent/70 truncate">{d.matchedGlob}</code>
        </div>
      ))}
    </div>
  );
}

function LifecycleEntryCard({ entry }: { entry: LifecycleEntry }) {
  const iconMap: Record<string, React.ElementType> = {
    loaded: RefreshCw,
    injected: CheckCircle2,
    reloaded: RefreshCw,
    unloaded: XCircle,
    expired: Clock,
  };
  const Icon = iconMap[entry.event] || Clock;
  return (
    <div className="px-2.5 py-1 text-[10px]">
      <div className="flex items-center gap-1.5">
        <Icon className="w-2.5 h-2.5 text-text-tertiary shrink-0" />
        <span className="text-text-tertiary">{new Date(entry.timestamp).toLocaleTimeString()}</span>
        <span className="text-text-secondary">{entry.event}</span>
        {entry.ruleCount != null && (
          <span className="text-text-tertiary">({entry.ruleCount} rules)</span>
        )}
      </div>
      {entry.details?.scannedDirs && entry.details.scannedDirs.length > 0 && (
        <div className="pl-5 space-y-0.5">
          {entry.details.scannedDirs.map((d) => (
            <div key={d.dir} className="space-y-0.5">
              <div className="flex items-center gap-1 text-text-tertiary dark:text-text-secondary min-w-0">
                <FolderOpen className="w-2 h-2 shrink-0" />
                <span className="truncate min-w-0">{d.dir}</span>
                <span className="text-text-tertiary dark:text-text-secondary shrink-0">
                  ({d.fileCount})
                </span>
              </div>
              {d.ruleNames.length > 0 && (
                <div className="pl-3 text-[9px] text-semantic-accent/70 truncate">
                  {d.ruleNames.join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {entry.details?.configSource && (
        <div className="pl-5 text-text-tertiary dark:text-text-secondary truncate min-w-0">
          config: {entry.details.configSource}
        </div>
      )}
      {entry.details?.cacheHit != null && (
        <div className="pl-5 text-text-tertiary dark:text-text-secondary">
          cache: {entry.details.cacheHit ? "hit" : "miss"}
        </div>
      )}
    </div>
  );
}

export function RulesPanel() {
  const { t } = useTranslation("rules");
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const collapsedSections = useRulesStore((s) => s.collapsedSections);
  const toggleSection = useRulesStore((s) => s.toggleSection);
  const expandedRule = useRulesStore(
    useShallow((s) =>
      activeSessionId ? (s.expandedRuleBySession[activeSessionId] ?? null) : null,
    ),
  );
  const setExpandedRule = useRulesStore((s) => s.setExpandedRule);

  const session = useRulesStore(useShallow((s) => s.bySession[activeSessionId ?? ""] ?? null));

  const rules = session?.rules || [];
  const injectedRuleNames = session?.injectedRuleNames || [];
  const matchHistory = session?.matchHistory || [];
  const lifecycleLog = session?.lifecycleLog || [];
  const totalRules = session?.totalRules || 0;

  const unconditional = rules.filter((r) => r.isUnconditional);
  const conditional = rules.filter((r) => !r.isUnconditional);
  const showSource = !collapsedSections.has("source");
  const showUnconditional = !collapsedSections.has("unconditional");
  const showConditional = !collapsedSections.has("conditional");
  const showHistory = !collapsedSections.has("history");
  const showLifecycle = !collapsedSections.has("lifecycle");

  const triggeredNames = new Set(matchHistory.flatMap((h) => h.ruleNames));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border-secondary dark:border-surface-code shrink-0">
        <Shield className="w-3.5 h-3.5 text-semantic-accent" />
        <span className="text-[11px] font-medium text-text-secondary">{t("rulesEngine")}</span>
        <span className="text-[9px] text-text-tertiary ml-auto">
          {t("totalRules", { count: totalRules })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Shield className="w-8 h-8 text-text-secondary dark:text-text-tertiary mb-3" />
            <p className="text-xs text-text-tertiary font-medium">{t("noRulesLoaded")}</p>
            <p className="text-[10px] text-text-tertiary mt-1 max-w-[200px] leading-relaxed">
              {t("noRulesHint")}
            </p>
          </div>
        ) : (
          <>
            {lifecycleLog.length > 0 && (
              <>
                <SectionHeader
                  collapsed={!showSource}
                  onToggle={() => toggleSection("source")}
                  icon={FolderOpen}
                  iconCls="text-semantic-accent"
                  label={t("loadingSource")}
                  badge={lifecycleLog.length}
                />
                {showSource &&
                  lifecycleLog
                    .slice(0, 10)
                    .map((entry, i) => (
                      <LifecycleEntryCard key={`${entry.timestamp}-${i}`} entry={entry} />
                    ))}
              </>
            )}

            <SectionHeader
              collapsed={!showUnconditional}
              onToggle={() => toggleSection("unconditional")}
              icon={CheckCircle2}
              iconCls="text-status-success"
              label={t("alwaysActiveSection")}
              badge={unconditional.length}
            />
            {showUnconditional &&
              unconditional.map((rule) => (
                <RuleCard
                  key={rule.name}
                  rule={rule}
                  isInjected={injectedRuleNames.includes(rule.name)}
                  onTriggered={triggeredNames.has(rule.name)}
                  expanded={expandedRule === rule.name}
                  onToggle={() => setExpandedRule(expandedRule === rule.name ? null : rule.name)}
                />
              ))}

            <SectionHeader
              collapsed={!showConditional}
              onToggle={() => toggleSection("conditional")}
              icon={FileCode}
              iconCls="text-status-warning"
              label={t("conditionalRules")}
              badge={conditional.length}
            />
            {showConditional &&
              conditional.map((rule) => (
                <RuleCard
                  key={rule.name}
                  rule={rule}
                  isInjected={injectedRuleNames.includes(rule.name)}
                  onTriggered={triggeredNames.has(rule.name)}
                  expanded={expandedRule === rule.name}
                  onToggle={() => setExpandedRule(expandedRule === rule.name ? null : rule.name)}
                />
              ))}

            <SectionHeader
              collapsed={!showHistory}
              onToggle={() => toggleSection("history")}
              icon={Zap}
              iconCls="text-status-warning"
              label={t("triggerHistory")}
              badge={matchHistory.length}
            />
            {showHistory && matchHistory.length > 0 && (
              <div className="border-t border-border-secondary dark:border-surface-code/50">
                {matchHistory.slice(0, 30).map((record, i) => (
                  <MatchRecordCard key={`${record.timestamp}-${i}`} record={record} />
                ))}
              </div>
            )}
            {showHistory && matchHistory.length === 0 && (
              <div className="px-2.5 py-3 text-[10px] text-text-tertiary text-center">
                {t("noTriggerHistory")}
              </div>
            )}

            {lifecycleLog.length > 0 && (
              <>
                <SectionHeader
                  collapsed={!showLifecycle}
                  onToggle={() => toggleSection("lifecycle")}
                  icon={Clock}
                  iconCls="text-text-tertiary"
                  label={t("lifecycle")}
                  badge={lifecycleLog.length}
                />
                {showLifecycle &&
                  lifecycleLog.map((entry, i) => (
                    <LifecycleEntryCard key={`lc-${entry.timestamp}-${i}`} entry={entry} />
                  ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

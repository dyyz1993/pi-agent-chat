import { useEffect, useRef, useState } from "react";
import {
  Activity,
  X,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { useDiagnosticStore } from "../../stores/use-diagnostic-store";
import { useFocusTrap } from "../../hooks/use-focus-trap";
import type {
  SubscriptionSnapshot,
  DataSizeSnapshot,
  DiagnosticSnapshot,
} from "../../stores/use-diagnostic-store";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function HealthIndicator({
  current,
  previous,
  label,
}: {
  current: number;
  previous: number | undefined;
  label: string;
}) {
  if (previous === undefined) return null;
  const diff = current - previous;
  if (diff === 0) return <span className="text-text-tertiary text-[10px]">=</span>;
  const isGood = diff < 0;
  return (
    <span className={`text-[10px] ${isGood ? "text-status-success" : "text-status-error"}`}>
      {diff > 0 ? "+" : ""}
      {diff} {label}
    </span>
  );
}

function SubscriptionTable({
  subs,
  prevSubs,
}: {
  subs: SubscriptionSnapshot[];
  prevSubs: SubscriptionSnapshot[] | undefined;
}) {
  const totalNow = subs.reduce((s, c) => s + c.total, 0);
  const totalPrev = prevSubs?.reduce((s, c) => s + c.total, 0);
  const uniqueSessions = new Set(subs.flatMap((c) => c.bySession.map((s) => s.sessionId)));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-text-secondary">WebSocket Subscriptions</span>
        <div className="flex items-center gap-2">
          <HealthIndicator current={totalNow} previous={totalPrev} label="subs" />
          <span
            className={`text-xs font-mono ${totalPrev !== undefined && totalNow > totalPrev ? "text-status-error" : totalNow > 0 ? "text-status-warning" : "text-text-tertiary"}`}
          >
            {totalNow} total
          </span>
          {uniqueSessions.size > 1 && (
            <span className="text-[10px] text-status-error">({uniqueSessions.size} sessions!)</span>
          )}
        </div>
      </div>
      <div className="space-y-0.5">
        {subs.map((cat) => {
          const prev = prevSubs?.find((p) => p.category === cat.category);
          return (
            <div key={cat.category} className="flex items-center gap-2 text-[11px]">
              <span className="w-16 text-text-tertiary truncate">{cat.category}</span>
              <div className="flex-1 flex items-center gap-1">
                <div
                  className={`h-2 rounded-full ${cat.total > 0 ? "bg-status-warning/60" : "bg-text-secondary"}`}
                  style={{ minWidth: 4, width: Math.max(4, cat.total * 16) }}
                />
                <span className="font-mono text-text-secondary">{cat.total}</span>
                {cat.bySession.length > 0 && (
                  <span className="text-text-tertiary text-[10px]">
                    ({cat.bySession.map((s) => s.sessionId).join(", ")})
                  </span>
                )}
              </div>
              <HealthIndicator current={cat.total} previous={prev?.total} label="" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DataTable({
  sizes,
  prevSizes,
}: {
  sizes: DataSizeSnapshot[];
  prevSizes: DataSizeSnapshot[] | undefined;
}) {
  const totalBytes = sizes.reduce((s, d) => s + d.estimatedBytes, 0);
  const prevTotalBytes = prevSizes?.reduce((s, d) => s + d.estimatedBytes, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-text-secondary">Data Size by Store</span>
        <div className="flex items-center gap-2">
          <HealthIndicator current={totalBytes} previous={prevTotalBytes} label="" />
          <span className="text-xs font-mono text-text-secondary">{formatBytes(totalBytes)}</span>
        </div>
      </div>
      <div className="space-y-0.5">
        {sizes.map((d) => {
          const prev = prevSizes?.find((p) => p.store === d.store);
          return (
            <div key={d.store} className="flex items-center gap-2 text-[11px]">
              <span className="w-44 text-text-tertiary truncate">{d.store}</span>
              <span className="font-mono text-text-secondary w-16 text-right">
                {d.totalItems} items
              </span>
              <span className="font-mono text-text-tertiary w-20 text-right">
                {formatBytes(d.estimatedBytes)}
              </span>
              <span className="text-text-tertiary text-[10px]">{d.sessionsWithData} sessions</span>
              <HealthIndicator
                current={d.estimatedBytes}
                previous={prev?.estimatedBytes}
                label=""
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeakDetector({ snap }: { snap: DiagnosticSnapshot }) {
  const issues: Array<{ severity: "error" | "warn"; message: string }> = [];

  const totalSubs = snap.subscriptions.reduce((s, c) => s + c.total, 0);
  const subSessions = new Set(
    snap.subscriptions.flatMap((c) => c.bySession.map((s) => s.sessionId)),
  );

  if (subSessions.size > 1) {
    issues.push({
      severity: "error",
      message: `${subSessions.size} sessions have active subscriptions (should be 1)`,
    });
  }

  if (totalSubs > 16) {
    issues.push({
      severity: "warn",
      message: `${totalSubs} total subscriptions (baseline ~16 per session)`,
    });
  }

  const msgStore = snap.dataSizes.find((d) => d.store === "chat.messagesBySession");
  if (msgStore && msgStore.sessionsWithData > 1) {
    issues.push({
      severity: "warn",
      message: `${msgStore.sessionsWithData} sessions with message data loaded`,
    });
  }

  if (snap.rpcDebugEntries > 400) {
    issues.push({
      severity: "warn",
      message: `RPC debug store has ${snap.rpcDebugEntries} entries (max 500)`,
    });
  }

  if (snap.toolCallNameMapSize > 200) {
    issues.push({
      severity: "warn",
      message: `toolCallNameMap has ${snap.toolCallNameMapSize} entries (never cleaned)`,
    });
  }

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-status-success bg-status-success/10 rounded px-2 py-1.5">
        <CheckCircle className="w-3 h-3" />
        No leaks detected
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {issues.map((issue, i) => (
        <div
          key={i}
          className={`flex items-start gap-1.5 text-[11px] rounded px-2 py-1 ${
            issue.severity === "error"
              ? "text-status-error bg-status-error/10"
              : "text-status-warning bg-status-warning/10"
          }`}
        >
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          {issue.message}
        </div>
      ))}
    </div>
  );
}

function TrendChart({ history }: { history: DiagnosticSnapshot[] }) {
  if (history.length < 2) {
    return (
      <div className="text-[10px] text-text-tertiary px-1">
        Collecting data... ({history.length} samples)
      </div>
    );
  }

  const first = history[0];
  const last = history[history.length - 1];

  const totalSubsFirst = first.subscriptions.reduce((s, c) => s + c.total, 0);
  const totalSubsLast = last.subscriptions.reduce((s, c) => s + c.total, 0);
  const totalBytesFirst = first.dataSizes.reduce((s, d) => s + d.estimatedBytes, 0);
  const totalBytesLast = last.dataSizes.reduce((s, d) => s + d.estimatedBytes, 0);

  const subTrend = totalSubsLast - totalSubsFirst;
  const byteTrend = totalBytesLast - totalBytesFirst;

  const subBars = history.map((h) => h.subscriptions.reduce((s, c) => s + c.total, 0));
  const maxSubs = Math.max(...subBars, 1);

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-text-tertiary">
        Trend: {formatTime(first.timestamp)} → {formatTime(last.timestamp)} ({history.length}{" "}
        samples)
      </div>
      <div className="flex items-end gap-px h-8">
        {subBars.map((v, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t-sm ${i === subBars.length - 1 ? "bg-semantic-accent" : "bg-text-secondary"}`}
            style={{ height: `${(v / maxSubs) * 100}%` }}
            title={`${v} subs`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px]">
        <span
          className={
            subTrend > 0
              ? "text-status-error"
              : subTrend < 0
                ? "text-status-success"
                : "text-text-tertiary"
          }
        >
          Subs: {totalSubsFirst} → {totalSubsLast} ({subTrend > 0 ? "+" : ""}
          {subTrend})
        </span>
        <span
          className={
            byteTrend > 0
              ? "text-status-error"
              : byteTrend < 0
                ? "text-status-success"
                : "text-text-tertiary"
          }
        >
          Data: {formatBytes(totalBytesFirst)} → {formatBytes(totalBytesLast)} (
          {byteTrend > 0 ? "+" : ""}
          {formatBytes(byteTrend)})
        </span>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border-t border-border-secondary dark:border-surface-code">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-text-secondary dark:text-text-secondary hover:bg-surface-hover/50 dark:hover:bg-surface-dim/50"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

export function DiagnosticPanel() {
  const open = useDiagnosticStore((s) => s.open);
  const snapshot = useDiagnosticStore((s) => s.snapshot);
  const history = useDiagnosticStore((s) => s.history);
  const autoRefresh = useDiagnosticStore((s) => s.autoRefresh);
  const refreshIntervalMs = useDiagnosticStore((s) => s.refreshIntervalMs);
  const toggle = useDiagnosticStore((s) => s.toggle);
  const takeSnapshot = useDiagnosticStore((s) => s.takeSnapshot);
  const setAutoRefresh = useDiagnosticStore((s) => s.setAutoRefresh);
  const clearHistory = useDiagnosticStore((s) => s.clearHistory);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, { onEscape: toggle });

  useEffect(() => {
    if (!open || !autoRefresh) return;
    takeSnapshot();
    const timer = setInterval(takeSnapshot, refreshIntervalMs);
    return () => clearInterval(timer);
  }, [open, autoRefresh, refreshIntervalMs, takeSnapshot]);

  if (!open) return null;

  const prev = history.length > 1 ? history[history.length - 2] : undefined;

  return (
    <div
      ref={panelRef}
      className="fixed top-10 right-2 w-[420px] max-sm:right-1 max-sm:w-[calc(100vw-16px)] max-h-[85vh] bg-bg-elevated dark:bg-surface-code border border-border-secondary dark:border-border-secondary rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 bg-surface-dim dark:bg-surface-dim border-b border-border-secondary dark:border-border-secondary flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-semantic-accent">
          <Activity className="w-3.5 h-3.5" />
          Session Diagnostic
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-[10px] px-1.5 py-0.5 rounded ${autoRefresh ? "bg-status-success/30 text-status-success" : "bg-surface-hover dark:bg-surface-hover text-text-tertiary dark:text-text-tertiary"}`}
          >
            {autoRefresh ? "AUTO" : "MANUAL"}
          </button>
          <button
            onClick={takeSnapshot}
            className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary hover:text-text-secondary dark:hover:text-text-primary"
            title="Take snapshot"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            onClick={clearHistory}
            className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary hover:text-text-secondary dark:hover:text-text-primary"
            title="Clear history"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <button
            onClick={toggle}
            className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary hover:text-text-secondary dark:hover:text-text-primary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {snapshot ? (
          <div className="text-[11px]">
            <div className="px-3 py-1.5 bg-surface-code dark:bg-surface-dim/50 flex items-center justify-between text-[10px] text-text-tertiary dark:text-text-tertiary">
              <span>
                Active: {snapshot.activeSessionId ?? "none"} | Tabs: {snapshot.projectTabs} |
                Sessions: {snapshot.totalSessions}
              </span>
              <span>{formatTime(snapshot.timestamp)}</span>
            </div>

            <div className="px-3 py-2">
              <LeakDetector snap={snapshot} />
            </div>

            <div className="px-3 py-2">
              <Section title="Subscriptions">
                <SubscriptionTable subs={snapshot.subscriptions} prevSubs={prev?.subscriptions} />
              </Section>
            </div>

            <div className="px-3 py-2">
              <Section title="Data Size">
                <DataTable sizes={snapshot.dataSizes} prevSizes={prev?.dataSizes} />
              </Section>
            </div>

            <div className="px-3 py-2">
              <Section title="Trend">
                <TrendChart history={history} />
              </Section>
            </div>

            {snapshot.jsHeapUsed != null && snapshot.jsHeapTotal != null && (
              <div className="px-3 py-2 border-t border-border-secondary dark:border-surface-code">
                <div className="text-[11px] font-medium text-text-secondary dark:text-text-secondary mb-1">
                  JS Heap
                </div>
                <div className="text-[11px] text-text-tertiary dark:text-text-tertiary">
                  Used: {formatBytes(snapshot.jsHeapUsed)} / Total:{" "}
                  {formatBytes(snapshot.jsHeapTotal)}
                </div>
                <div className="h-1.5 bg-surface-hover dark:bg-surface-hover rounded mt-1">
                  <div
                    className="h-full bg-semantic-accent rounded"
                    style={{ width: `${(snapshot.jsHeapUsed / snapshot.jsHeapTotal) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="px-3 py-2 border-t border-border-secondary dark:border-surface-code text-[10px] text-text-tertiary dark:text-text-tertiary">
              RPC debug entries: {snapshot.rpcDebugEntries} | toolCallNameMap:{" "}
              {snapshot.toolCallNameMapSize}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-text-tertiary text-xs">
            Loading...
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 bg-surface-code dark:bg-surface-dim border-t border-border-secondary dark:border-border-secondary text-[10px] text-text-tertiary flex items-center justify-between flex-shrink-0">
        <span>Ctrl+Shift+D to toggle | History: {history.length}/60</span>
      </div>
    </div>
  );
}

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
  if (diff === 0) return <span className="text-gray-500 text-[10px]">=</span>;
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
        <span className="text-[11px] font-medium text-gray-300">WebSocket Subscriptions</span>
        <div className="flex items-center gap-2">
          <HealthIndicator current={totalNow} previous={totalPrev} label="subs" />
          <span
            className={`text-xs font-mono ${totalPrev !== undefined && totalNow > totalPrev ? "text-status-error" : totalNow > 0 ? "text-status-warning" : "text-gray-500"}`}
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
              <span className="w-16 text-gray-400 truncate">{cat.category}</span>
              <div className="flex-1 flex items-center gap-1">
                <div
                  className={`h-2 rounded-full ${cat.total > 0 ? "bg-status-warning/60" : "bg-gray-700"}`}
                  style={{ minWidth: 4, width: Math.max(4, cat.total * 16) }}
                />
                <span className="font-mono text-gray-300">{cat.total}</span>
                {cat.bySession.length > 0 && (
                  <span className="text-gray-500 text-[10px]">
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
        <span className="text-[11px] font-medium text-gray-300">Data Size by Store</span>
        <div className="flex items-center gap-2">
          <HealthIndicator current={totalBytes} previous={prevTotalBytes} label="" />
          <span className="text-xs font-mono text-gray-300">{formatBytes(totalBytes)}</span>
        </div>
      </div>
      <div className="space-y-0.5">
        {sizes.map((d) => {
          const prev = prevSizes?.find((p) => p.store === d.store);
          return (
            <div key={d.store} className="flex items-center gap-2 text-[11px]">
              <span className="w-44 text-gray-400 truncate">{d.store}</span>
              <span className="font-mono text-gray-300 w-16 text-right">{d.totalItems} items</span>
              <span className="font-mono text-gray-400 w-20 text-right">
                {formatBytes(d.estimatedBytes)}
              </span>
              <span className="text-gray-500 text-[10px]">{d.sessionsWithData} sessions</span>
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
      <div className="text-[10px] text-gray-500 px-1">
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
      <div className="text-[10px] text-gray-500">
        Trend: {formatTime(first.timestamp)} → {formatTime(last.timestamp)} ({history.length}{" "}
        samples)
      </div>
      <div className="flex items-end gap-px h-8">
        {subBars.map((v, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t-sm ${i === subBars.length - 1 ? "bg-semantic-accent" : "bg-gray-600"}`}
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
                : "text-gray-500"
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
                : "text-gray-500"
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
    <div className="border-t border-gray-200 dark:border-gray-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
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
      className="fixed top-10 right-2 w-[420px] max-sm:right-1 max-sm:w-[calc(100vw-16px)] max-h-[85vh] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-850 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-semantic-accent">
          <Activity className="w-3.5 h-3.5" />
          Session Diagnostic
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-[10px] px-1.5 py-0.5 rounded ${autoRefresh ? "bg-status-success/30 text-status-success" : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}
          >
            {autoRefresh ? "AUTO" : "MANUAL"}
          </button>
          <button
            onClick={takeSnapshot}
            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="Take snapshot"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            onClick={clearHistory}
            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="Clear history"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <button
            onClick={toggle}
            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {snapshot ? (
          <div className="text-[11px]">
            <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800/50 flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
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
              <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-800">
                <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1">
                  JS Heap
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  Used: {formatBytes(snapshot.jsHeapUsed)} / Total:{" "}
                  {formatBytes(snapshot.jsHeapTotal)}
                </div>
                <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded mt-1">
                  <div
                    className="h-full bg-semantic-accent rounded"
                    style={{ width: `${(snapshot.jsHeapUsed / snapshot.jsHeapTotal) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-800 text-[10px] text-gray-400 dark:text-gray-500">
              RPC debug entries: {snapshot.rpcDebugEntries} | toolCallNameMap:{" "}
              {snapshot.toolCallNameMapSize}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-gray-500 text-xs">
            Loading...
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 flex items-center justify-between flex-shrink-0">
        <span>Ctrl+Shift+D to toggle | History: {history.length}/60</span>
      </div>
    </div>
  );
}

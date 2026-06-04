import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  ArrowDownToLine,
  X,
  Trash2,
  Loader2,
  Send,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSessionStore } from "../../stores/use-session-store";
import { useBashStore } from "../../stores/use-bash-store";
import type { BashProcess } from "../../../shared/modules/bash";
import { apiClient } from "../../lib/api-client";
import { useFocusTrap } from "../../hooks/use-focus-trap";
import { createLogger } from "../../../shared/lib/logger";

const log = createLogger("bash");

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h${remM}m` : `${h}h`;
}

function BashProcessCard({
  process: p,
  onOpenLog,
}: {
  process: BashProcess;
  onOpenLog: () => void;
}) {
  const { t } = useTranslation("chat");
  const [elapsed, setElapsed] = useState(Date.now() - p.startedAt);

  useEffect(() => {
    if (p.status !== "running" && p.status !== "background") return;
    setElapsed(Date.now() - p.startedAt);
    const id = setInterval(() => setElapsed(Date.now() - p.startedAt), 1000);
    return () => clearInterval(id);
  }, [p.status, p.startedAt]);

  async function sendAction(action: "kill" | "background") {
    const sid = useSessionStore.getState().activeSessionId;
    if (!sid) return;
    await apiClient.call("bash.command", {
      sessionId: sid,
      action,
      toolCallId: p.toolCallId,
    });
  }

  const isRunning = p.status === "running";
  const isBackground = p.status === "background";
  const isActive = isRunning || isBackground;
  const isEnded = p.status === "done" || p.status === "error" || p.status === "terminated";

  const statusColor = isBackground
    ? "text-status-warning"
    : p.status === "done"
      ? "text-status-success"
      : p.status === "error" || p.status === "terminated"
        ? "text-status-error"
        : "text-status-info";

  const statusText = isBackground
    ? t("backgroundRunning")
    : p.status === "done"
      ? t("completed")
      : p.status === "error"
        ? t("error")
        : p.status === "terminated"
          ? t("cancelled")
          : t("executing");

  return (
    <div className="rounded-lg bg-surface-code border border-border-secondary/30 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className="text-[11px] font-medium text-text-primary truncate font-mono flex-1"
          title={p.command}
        >
          {p.command}
        </span>
      </div>
      <div className="flex items-center gap-3 text-[9px] text-text-tertiary">
        <span className={statusColor}>{statusText}</span>
        {isActive ? (
          <span>
            {t("runtime")}: {formatDuration(elapsed)}
          </span>
        ) : (
          p.endedAt && (
            <span>
              {t("duration")}: {formatDuration(p.endedAt - p.startedAt)}
            </span>
          )
        )}
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          onClick={onOpenLog}
          className="flex items-center justify-center w-8 h-7 rounded border border-border-secondary/50 text-text-tertiary hover:text-text-primary hover:border-border-secondary transition-colors shrink-0"
          title={t("viewLog")}
        >
          <Terminal className="w-3.5 h-3.5" />
        </button>

        {isActive && (
          <button
            onClick={() => sendAction("kill")}
            className="flex items-center justify-center w-8 h-7 rounded border border-status-error/30 text-status-error hover:bg-status-error/10 transition-colors shrink-0"
            title={isRunning ? t("cancelExecution") : t("terminateProcess")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {isRunning && !isBackground && elapsed > 5000 && (
          <button
            onClick={() => sendAction("background")}
            className="flex items-center justify-center w-auto px-2 h-7 rounded border border-status-warning/40 text-[10px] text-status-warning hover:bg-status-warning/15 transition-colors shrink-0"
            title={t("toBackground")}
          >
            <ArrowDownToLine className="w-3 h-3 mr-1" />
            <span>{t("background")}</span>
          </button>
        )}

        {isEnded && (
          <button
            onClick={() =>
              useBashStore
                .getState()
                .removeProcess(useSessionStore.getState().activeSessionId ?? "", p.toolCallId)
            }
            className="flex items-center justify-center w-8 h-7 rounded border border-border-secondary/50 text-text-tertiary hover:text-text-secondary hover:border-border-secondary transition-colors shrink-0"
            title={t("removeFromList")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

const LINE_HEIGHT = 20;

function LogViewer({
  logPath,
  toolCallId,
  onClose,
}: {
  logPath: string;
  toolCallId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("chat");
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalLines, setTotalLines] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [stdinInput, setStdinInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const offsetRef = useRef(0);
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const initTag = useRef(0);
  const subIdRef = useRef<string | null>(null);
  const autoScrollRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(overlayRef, { onEscape: onClose });

  // Sync state → ref for use in callbacks/effects
  autoScrollRef.current = autoScroll;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 20,
  });

  const scrollToBottom = useCallback(() => {
    if (lines.length === 0) return;
    isProgrammaticScrollRef.current = true;
    virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
  }, [virtualizer, lines.length]);

  // --- Auto-scroll on new lines ---
  // Uses autoScrollRef (not state) to avoid stale closure issues,
  // and isProgrammaticScrollRef to prevent the scroll event from
  // incorrectly disabling autoScroll.
  const prevLinesLengthRef = useRef(0);
  useEffect(() => {
    if (lines.length === 0) return;
    if (lines.length === prevLinesLengthRef.current) return;
    prevLinesLengthRef.current = lines.length;

    if (!autoScrollRef.current) return;
    scrollToBottom();
  }, [lines, scrollToBottom]);

  // --- Initialization: subscribe, load, watch ---
  useEffect(() => {
    const tag = ++initTag.current;
    mountedRef.current = true;
    offsetRef.current = 0;
    loadingRef.current = false;
    autoScrollRef.current = true;
    setAutoScroll(true);
    setLoading(true);
    setLines([]);
    setTotalLines(0);
    setHasMore(false);
    subIdRef.current = null;

    let cancelled = false;

    (async () => {
      try {
        const sid = useSessionStore.getState().activeSessionId;
        const id = await apiClient.subscribe(
          "bash.logUpdate",
          (payload: { logPath: string; newLines: string[] }) => {
            if (payload.logPath !== logPath || initTag.current !== tag) return;
            if (payload.newLines.length === 0) return;
            setLines((prev) => [...prev, ...payload.newLines]);
            setTotalLines((prev) => prev + payload.newLines.length);
          },
          sid ? { sessionId: sid } : undefined,
        );
        if (cancelled) {
          apiClient.unsubscribe(id);
          return;
        }
        subIdRef.current = id;

        if (loadingRef.current || cancelled) return;
        loadingRef.current = true;
        try {
          const result = (await apiClient.call("bash.readLog", {
            logPath,
            offset: offsetRef.current,
            limit: 500,
          })) as { lines: string[]; totalLines: number; hasMore: boolean };
          if (cancelled || !mountedRef.current) return;
          setLines((prev) => (offsetRef.current === 0 ? result.lines : [...prev, ...result.lines]));
          setTotalLines(result.totalLines);
          setHasMore(result.hasMore);
          offsetRef.current += result.lines.length;
        } catch (e) {
          log.warn("Failed to read bash log", { logPath, error: String(e) });
        } finally {
          if (!cancelled && mountedRef.current) {
            setLoading(false);
            loadingRef.current = false;
          }
        }

        if (cancelled) return;
        await apiClient.call("bash.watchLog", { logPath, sessionId: sid ?? undefined });
      } catch (err) {
        log.warn("watchLog failed", { error: String(err) });
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (subIdRef.current) apiClient.unsubscribe(subIdRef.current);
      const sid = useSessionStore.getState().activeSessionId;
      apiClient.call("bash.unwatchLog", { logPath, sessionId: sid ?? undefined }).catch((err) => {
        log.warn("unwatchLog failed", { error: String(err) });
      });
    };
  }, [logPath]);

  // --- Scroll handler with programmatic scroll guard ---
  const handleScroll = useCallback(() => {
    // If this scroll was triggered programmatically (scrollToBottom),
    // skip all flag changes to avoid incorrectly disabling autoScroll.
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }

    const el = scrollRef.current;
    if (!el) return;

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

    // User scrolled up → disable auto-scroll
    if (!nearBottom) {
      if (autoScrollRef.current) {
        autoScrollRef.current = false;
        setAutoScroll(false);
      }
    } else {
      // User scrolled back to bottom → re-enable auto-scroll
      if (!autoScrollRef.current) {
        autoScrollRef.current = true;
        setAutoScroll(true);
      }
    }

    // Load more when near bottom and more pages available
    if (nearBottom && hasMore && !loadingRef.current) {
      loadingRef.current = true;
      loadMoreLines();
    }
  }, [hasMore]);

  async function loadMoreLines() {
    try {
      const tag = initTag.current;
      const result = (await apiClient.call("bash.readLog", {
        logPath,
        offset: offsetRef.current,
        limit: 500,
      })) as { lines: string[]; totalLines: number; hasMore: boolean };
      if (!mountedRef.current || initTag.current !== tag) return;
      setLines((prev) => [...prev, ...result.lines]);
      setTotalLines(result.totalLines);
      setHasMore(result.hasMore);
      offsetRef.current += result.lines.length;
    } catch (err) {
      log.warn("loadMore failed", { error: String(err) });
    } finally {
      if (mountedRef.current) loadingRef.current = false;
    }
  }

  async function sendStdin() {
    const text = stdinInput.trim();
    if (!text) return;
    const sid = useSessionStore.getState().activeSessionId;
    if (!sid || !toolCallId) return;
    await apiClient.call("bash.command", {
      sessionId: sid,
      action: "write_stdin" as const,
      toolCallId,
      data: text + "\n",
    });
    setStdinInput("");
  }

  function jumpToBottom() {
    autoScrollRef.current = true;
    setAutoScroll(true);
    isProgrammaticScrollRef.current = true;
    scrollToBottom();
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-surface-code border-t sm:border border-border-secondary sm:rounded-lg w-full sm:max-w-4xl flex flex-col h-full sm:h-[70vh] sm:max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b border-border-secondary shrink-0"
          style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top, 0px))" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
            <span className="text-xs text-text-secondary font-mono truncate">
              {logPath.split("/").pop()}
            </span>
            <span className="text-[9px] text-text-tertiary shrink-0">
              {t("lineCountShort", { count: totalLines })}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors shrink-0"
            aria-label={t("close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable log area */}
        <div className="flex-1 min-h-0 relative">
          <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-auto p-3 sm:p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
                <span className="ml-2 text-[11px] text-text-tertiary">{t("loadingDots")}</span>
              </div>
            ) : lines.length === 0 ? (
              <div className="text-[11px] text-text-tertiary italic">{t("noOutput")}</div>
            ) : (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualItems.map((virtualRow) => {
                  const line = lines[virtualRow.index];
                  return (
                    <pre
                      key={virtualRow.index}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      className="text-[11px] text-text-secondary font-mono whitespace-pre-wrap break-all leading-relaxed absolute top-0 left-0 w-full"
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {line}
                    </pre>
                  );
                })}
              </div>
            )}
          </div>

          {/* Floating "scroll to bottom" button — appears when auto-scroll is paused */}
          {!autoScroll && !loading && lines.length > 0 && (
            <button
              onClick={jumpToBottom}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-status-info text-white text-[10px] font-medium shadow-lg hover:bg-status-info/80 transition-all z-10"
            >
              <ArrowDownToLine className="w-3 h-3" />
              <span>{t("scrollToBottom")}</span>
            </button>
          )}
        </div>

        {/* Bottom bar: line count + stdin input */}
        <div
          className="flex items-center gap-2 px-3 sm:px-4 py-2 border-t border-border-secondary shrink-0"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <span className="text-[9px] text-text-tertiary shrink-0">
            {lines.length}/{totalLines}
          </span>

          {/* Auto-scroll indicator */}
          <button
            onClick={jumpToBottom}
            className={`text-[9px] shrink-0 transition-colors ${
              autoScroll ? "text-status-info" : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {t("scrollToBottom")}
          </button>

          <div className="flex-1 flex items-center gap-1.5 ml-2">
            <input
              ref={inputRef}
              value={stdinInput}
              onChange={(e) => setStdinInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendStdin();
              }}
              placeholder={t("stdinPlaceholder")}
              className="flex-1 h-7 px-2 rounded bg-surface-dim border border-border-secondary text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-secondary font-mono"
            />
            <button
              onClick={sendStdin}
              disabled={!stdinInput.trim()}
              className="h-7 w-7 flex items-center justify-center rounded bg-status-info/20 text-status-info hover:bg-status-info/30 disabled:opacity-30 disabled:hover:bg-status-info/20 transition-colors shrink-0"
              title={t("sendTitle")}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { BashProcessCard, LogViewer };

export function BashPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const allProcesses = useBashStore(useShallow((s) => s.processesBySession[activeSessionId ?? ""]));
  const backgroundedIds = useBashStore(useShallow((s) => s.backgroundedIds));
  const [collapsed, setCollapsed] = useState(false);
  const [logViewer, setLogViewer] = useState<{ logPath: string; toolCallId: string } | null>(null);

  const backgroundProcesses = allProcesses?.filter((p) => backgroundedIds.has(p.toolCallId)) ?? [];

  if (backgroundProcesses.length === 0) return null;

  return (
    <div className="px-3 py-2 space-y-2">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-1.5 text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <Terminal className="w-3 h-3" />
        <span>SHELL</span>
        <span className="ml-auto text-[9px] text-text-tertiary">{backgroundProcesses.length}</span>
      </button>

      {!collapsed && (
        <div className="space-y-2 pl-1">
          {backgroundProcesses.map((p) => (
            <BashProcessCard
              key={p.toolCallId}
              process={p}
              onOpenLog={() => setLogViewer({ logPath: p.logPath ?? "", toolCallId: p.toolCallId })}
            />
          ))}
        </div>
      )}

      {logViewer &&
        createPortal(
          <LogViewer
            logPath={logViewer.logPath}
            toolCallId={logViewer.toolCallId}
            onClose={() => setLogViewer(null)}
          />,
          document.body,
        )}
    </div>
  );
}

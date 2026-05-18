import { memo, useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ArrowDownToLine, X, Eye, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Highlight, themes } from "prism-react-renderer";
import type { ContentBlock } from "../../../types";
import { useSessionStore } from "../../../stores/use-session-store";
import { useBashStore } from "../../../stores/use-bash-store";
import { useSettingsStore } from "../../../stores/use-settings-store";
import { tryFormatAsYaml } from "../../../../shared/lib/json-to-yaml";
import { apiClient } from "../../../lib/api-client";
import { useThemeStore, isDarkGroup } from "../../../stores/use-theme-store";
import { AnsiText } from "../primitives/AnsiText";
import { LogViewer } from "../../bash-panel/BashPanel";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;
const EMPTY_PROCS: never[] = [];

interface BashDetails {
  background?: {
    pid: number;
    command: string;
    startedAt: number;
    durationMs: number;
    output?: string;
    detached: boolean;
  };
  terminated?: {
    pid?: number;
    command: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    output?: string;
  };
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h${remM}m` : `${h}h`;
}

/** Max characters to pass to prism for highlighting (prevents perf issues) */
const HIGHLIGHT_MAX_LEN = 50_000;

function detectOutputLanguage(text: string): {
  language: string | null;
  formatted: string;
} {
  const trimmed = text.trim();
  if (!trimmed) return { language: null, formatted: text };

  // JSON detection + formatting
  const firstChar = trimmed[0];
  if (firstChar === "{" || firstChar === "[") {
    try {
      const parsed = JSON.parse(trimmed);
      return { language: "json", formatted: JSON.stringify(parsed, null, 2) };
    } catch {
      /* not valid JSON */
    }
  }

  // YAML detection — heuristic: check if multiple lines match key: value
  const lines = trimmed.split("\n").filter((l) => l.trim());
  const yamlLines = lines.filter((l) => /^\s*[\w-.]+\s*:/.test(l));
  if (yamlLines.length >= 2 && yamlLines.length >= lines.length * 0.3) {
    return { language: "yaml", formatted: text };
  }

  return { language: null, formatted: text };
}

function OutputHighlighter({ content, isRunning }: { content: string; isRunning: boolean }) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const prismTheme = isDarkGroup(resolvedTheme) ? themes.nightOwl : themes.nightOwlLight;

  // During streaming: use fast AnsiText (no prism overhead)
  if (isRunning || content.length > HIGHLIGHT_MAX_LEN) {
    return <AnsiText content={content} className="text-[11px] leading-relaxed" />;
  }

  // After completion: try to detect and highlight structured data
  const { language, formatted } = detectOutputLanguage(content);
  if (!language) {
    return <AnsiText content={content} className="text-[11px] leading-relaxed" />;
  }

  return (
    <Highlight theme={prismTheme} code={formatted.trimEnd()} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className="text-[11px] leading-relaxed font-mono p-0 m-0">
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })} className="table-row">
              <span className="table-cell text-right pr-2 select-none text-text-tertiary w-6 text-[10px]">
                {i + 1}
              </span>
              <span className="table-cell whitespace-pre">
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </span>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

export const BashExecutionCard = memo(function BashExecutionCard({
  block,
  blockId,
}: {
  block: Block;
  blockId?: string;
}) {
  const sid = useSessionStore((s) => s.activeSessionId);
  const { t } = useTranslation("chat");
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const bashProcess = useBashStore((s) => {
    const procs = s.processesBySession[sid ?? ""] || EMPTY_PROCS;
    return procs.find((p) => p.toolCallId === block.toolCallId);
  });
  const blockIsRunning = block.status === "running";
  const blockIsError = block.status === "error";
  const [elapsed, setElapsed] = useState(0);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [outputOpen, setOutputOpen] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const startedAt = useRef(block.startedAt ?? Date.now());
  const outputScrollRef = useRef<HTMLDivElement>(null);

  const bashDetails = block.details as BashDetails | undefined;
  const timeout = block.timeout;
  const storeStatus = bashProcess?.status;
  const isBackground = !!bashDetails?.background || storeStatus === "background";
  const isTerminated = !!bashDetails?.terminated || storeStatus === "terminated";
  const isRunning = blockIsRunning && !isBackground && !isTerminated;
  const isError = blockIsError;

  // -- collapse logic --
  // collapsed=true: hide input/output, show title bar only
  // User can collapse even while running (shows loading dot)
  // Auto-collapse when running finishes + setting enabled
  const [collapsed, setCollapsed] = useState(false);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  useEffect(() => {
    if (isBackground) {
      setOutputOpen(false);
    }
  }, [isBackground]);

  useEffect(() => {
    if (!isRunning) return;
    if (block.startedAt) startedAt.current = block.startedAt;
    setElapsed(Date.now() - startedAt.current);
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => clearInterval(id);
  }, [isRunning, block.startedAt]);

  const showBackground = elapsed > 5000 && isRunning;

  const handleScroll = useCallback(() => {
    const el = outputScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  // Auto-scroll when new output arrives (only if user hasn't scrolled up)
  useEffect(() => {
    if (!autoScroll || !isRunning) return;
    const el = outputScrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [block.output, autoScroll, isRunning]);

  async function sendAction(action: "kill" | "background") {
    const sid = useSessionStore.getState().activeSessionId;
    if (!sid) return;
    await apiClient.call("bash.command", { sessionId: sid, action, toolCallId: block.toolCallId });
  }

  let borderBg: string;
  let statusLabel: React.ReactNode = null;

  if (isBackground) {
    borderBg = "border-status-warning/30 bg-status-warning/10 dark:bg-status-warning/20";
    statusLabel = (
      <span className="text-status-warning text-[10px]">{t("bash.backgroundRunning")}</span>
    );
  } else if (isTerminated) {
    borderBg = "border-status-error/20 bg-status-error/10 dark:bg-status-error/15";
    statusLabel = <span className="text-status-error text-[10px]">{t("common:cancelled")}</span>;
  } else if (isRunning) {
    borderBg = "border-status-info/30 bg-status-info/10 dark:bg-status-info/20";
  } else if (isError) {
    borderBg = "border-status-error/20 bg-status-error/10 dark:bg-status-error/15";
  } else {
    borderBg = "border-border-secondary/30 bg-surface-dim";
  }

  return (
    <div
      data-block-id={blockId}
      className={`rounded-none overflow-hidden border-x-0 border-t border-b ${borderBg}`}
    >
      <div
        className="px-3 py-1.5 flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-hover transition-colors select-none"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        aria-expanded={!collapsed}
      >
        {collapsed && isRunning && (
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-status-info animate-pulse" />
        )}
        <span
          className={`font-medium shrink-0 ${isBackground ? "text-status-warning" : isTerminated ? "text-status-error" : isRunning ? "text-status-info" : isError ? "text-status-error" : "text-text-primary"}`}
        >
          {block.toolName}
        </span>
        {(() => {
          let summary = block.description;
          if (!summary && block.args) {
            try {
              const parsed = JSON.parse(block.args);
              if (parsed && typeof parsed === "object" && typeof parsed.command === "string") {
                summary = parsed.command.slice(0, 120);
              }
            } catch {
              /* not JSON, use raw */
            }
            if (!summary) summary = block.args.split("\n")[0]?.trim().slice(0, 120);
          }
          return summary ? (
            <span className="flex-1 min-w-0 text-text-secondary truncate text-[11px]">
              {summary}
            </span>
          ) : (
            <span className="flex-1" />
          );
        })()}
        {isRunning && !statusLabel && (
          <span className="shrink-0 flex items-center gap-1 text-[10px] text-text-tertiary tabular-nums">
            {formatDuration(elapsed)}
            {timeout != null &&
              timeout > 0 &&
              timeout <= 86400 &&
              (() => {
                const remainingMs = timeout * 1000 - elapsed;
                const remaining = Math.max(0, remainingMs);
                const pct = (elapsed / (timeout * 1000)) * 100;
                return (
                  <span className={pct > 80 ? "text-status-error" : "text-status-warning"}>
                    / {formatDuration(remaining)}
                  </span>
                );
              })()}
          </span>
        )}
        {statusLabel}
        {bashDetails?.background && (
          <span className="text-[10px] text-text-tertiary shrink-0">
            PID: {bashDetails.background.pid}
          </span>
        )}
        {(bashDetails?.background ?? (storeStatus === "background" && bashProcess)) && (
          <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
            {formatDuration(
              bashDetails?.background?.durationMs ??
                Date.now() - (bashProcess?.startedAt ?? Date.now()),
            )}
            {timeout != null && timeout > 0 && timeout <= 86400 && (
              <span className="text-text-secondary"> / {formatDuration(timeout * 1000)}</span>
            )}
          </span>
        )}
        {(bashDetails?.terminated ?? (storeStatus === "terminated" && bashProcess)) && (
          <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
            {formatDuration(
              bashDetails?.terminated?.durationMs ??
                (bashProcess?.endedAt ?? Date.now()) - (bashProcess?.startedAt ?? Date.now()),
            )}
            {timeout != null && timeout > 0 && timeout <= 86400 && (
              <span className="text-text-secondary"> / {formatDuration(timeout * 1000)}</span>
            )}
          </span>
        )}
        {!isRunning &&
          !isBackground &&
          !isTerminated &&
          !isError &&
          timeout != null &&
          timeout > 0 &&
          timeout <= 86400 &&
          (() => {
            const durationMs =
              bashProcess?.endedAt && bashProcess?.startedAt
                ? bashProcess.endedAt - bashProcess.startedAt
                : 0;
            return (
              <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
                {formatDuration(durationMs)}
                <span className="text-text-secondary"> / {formatDuration(timeout * 1000)}</span>
              </span>
            );
          })()}
      </div>

      {collapsed ? null : (
        <>
          <details className="group">
            <summary className="px-3 py-1 text-[11px] text-text-tertiary cursor-pointer hover:text-text-secondary select-none flex items-center gap-1.5 border-t border-border-secondary/30">
              <svg
                className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M4.5 3l3 3-3 3" />
              </svg>
              <span>{t("input")}</span>
            </summary>
            <div className="px-3 pb-2">
              {block.args ? (
                <pre className="text-[11px] text-status-warning/70 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">
                  {tryFormatAsYaml(block.args)}
                </pre>
              ) : null}
            </div>
          </details>

          <details
            open={outputOpen}
            onToggle={(e) => setOutputOpen(e.currentTarget.open)}
            className="group"
          >
            <summary className="px-3 py-1 text-[11px] text-text-tertiary cursor-pointer hover:text-text-secondary select-none flex items-center gap-1.5 border-t border-border-secondary/30">
              <svg
                className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M4.5 3l3 3-3 3" />
              </svg>
              <span>{t("output")}</span>
              {isRunning && (
                <span className="ml-auto text-status-info/70 animate-pulse text-[10px]">
                  {t("streaming")}
                </span>
              )}
            </summary>
            <div className="px-3 pb-2 relative">
              {block.output ? (
                <div
                  ref={outputScrollRef}
                  onScroll={handleScroll}
                  className="overflow-y-auto max-h-36"
                >
                  <OutputHighlighter content={block.output} isRunning={isRunning} />
                </div>
              ) : isRunning ? (
                <div className="text-[11px] text-text-tertiary italic py-1">{t("waiting")}</div>
              ) : null}
              {isRunning && !autoScroll && (
                <button
                  onClick={() => {
                    setAutoScroll(true);
                    const el = outputScrollRef.current;
                    if (el) el.scrollTop = el.scrollHeight;
                  }}
                  className="absolute bottom-1 right-3 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-surface-hover/80 text-text-secondary hover:bg-surface-hover transition-colors shadow-sm"
                  title={t("scroll.scrollToBottom")}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              )}
            </div>
          </details>

          {isRunning && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border-secondary/30">
              {showBackground && (
                <button
                  onClick={() => sendAction("background")}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded border border-status-warning/40 text-[10px] text-status-warning hover:bg-status-warning/10 dark:hover:bg-status-warning/15 transition-colors"
                  title={t("bash.moveToBackground")}
                >
                  <ArrowDownToLine className="w-3 h-3" />
                  <span>{t("bash.background")}</span>
                </button>
              )}
              {!showBackground && <div className="flex-1" />}
              <button
                onClick={() => sendAction("kill")}
                className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-status-error/30 text-[10px] text-status-error hover:bg-status-error/10 dark:hover:bg-status-error/10 transition-colors"
                title={t("bash.cancelExecution")}
              >
                <X className="w-3 h-3" />
                <span>{t("common:cancel")}</span>
              </button>
            </div>
          )}
        </>
      )}

      {isBackground && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border-secondary/30">
          <div className="flex-1" />
          <button
            onClick={() => setShowLogViewer(true)}
            className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-semantic-tool/40 text-[10px] text-semantic-tool hover:bg-semantic-tool/10 dark:hover:bg-semantic-tool/15 transition-colors"
            title={t("bash.viewOutput")}
          >
            <Eye className="w-3 h-3" />
            <span>{t("bash.viewOutput")}</span>
          </button>
        </div>
      )}

      {showLogViewer &&
        bashProcess?.logPath &&
        createPortal(
          <LogViewer
            logPath={bashProcess.logPath}
            toolCallId={block.toolCallId}
            onClose={() => setShowLogViewer(false)}
          />,
          document.body,
        )}
    </div>
  );
});

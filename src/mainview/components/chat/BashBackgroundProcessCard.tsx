import { memo } from "react";
import { CircleCheck, CircleX, Clock, OctagonPause } from "lucide-react";
import {
  type BashBackgroundLogPreview,
  type BashBackgroundProcessData,
  formatBashBackgroundReason,
  formatBashBackgroundTrigger,
  normalizeBashBackgroundProcess,
} from "./bash-background-process";

interface BashBackgroundProcessCardProps {
  data: unknown;
  compact?: boolean;
}

function statusTone(data: BashBackgroundProcessData): {
  icon: typeof CircleCheck;
  iconClass: string;
  bgClass: string;
} {
  if (data.reason === "exit_zero" || data.status === "done") {
    return {
      icon: CircleCheck,
      iconClass: "text-status-success",
      bgClass: "bg-status-success/5",
    };
  }
  if (data.reason === "user_cancel" || data.reason === "system_cancel" || data.status === "terminated") {
    return {
      icon: OctagonPause,
      iconClass: "text-status-warning",
      bgClass: "bg-status-warning/5",
    };
  }
  if (data.reason === "timeout") {
    return {
      icon: Clock,
      iconClass: "text-status-warning",
      bgClass: "bg-status-warning/5",
    };
  }
  return {
    icon: CircleX,
    iconClass: "text-status-error",
    bgClass: "bg-status-error/5",
  };
}

function formatDuration(data: BashBackgroundProcessData): string | null {
  if (data.duration) return data.duration;
  if (data.durationMs == null) return null;
  const seconds = Math.floor(data.durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function formatTimestamp(value: number | undefined): string | null {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[11px] leading-relaxed">
      <span className="text-text-tertiary shrink-0">{label}</span>
      <span className="min-w-0 break-all font-mono text-text-secondary">{value}</span>
    </div>
  );
}

function LogPreview({ preview }: { preview: BashBackgroundLogPreview }) {
  return (
    <div className="rounded-sm border border-border-secondary/20 bg-surface-code/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-text-tertiary border-b border-border-secondary/20">
        <span className="font-medium text-text-secondary">日志预览</span>
        <span>{preview.totalLines} 行</span>
        <span>{formatBytes(preview.totalBytes)}</span>
        {preview.truncated && (
          <span>
            前 {preview.headLineCount} 行 + 后 {preview.tailLineCount} 行
          </span>
        )}
      </div>
      <div className="max-h-44 overflow-y-auto px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words">
        {preview.segments.map((segment, index) => {
          if (segment.kind === "omitted") {
            return (
              <div key={`omitted-${index}`} className="text-text-tertiary italic">
                ... 省略中间 {segment.lineCount} 行 ...
              </div>
            );
          }
          return (
            <div key={`line-${index}`}>
              <span>{segment.text || " "}</span>
              {segment.repeatCount && segment.repeatCount > 1 && (
                <div className="text-text-tertiary italic">
                  ... 上一行重复 {segment.repeatCount - 1} 行 ...
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const BashBackgroundProcessCard = memo(function BashBackgroundProcessCard({
  data,
  compact,
}: BashBackgroundProcessCardProps) {
  const normalized = normalizeBashBackgroundProcess(data);
  if (!normalized) return null;

  const tone = statusTone(normalized);
  const StatusIcon = tone.icon;
  const duration = formatDuration(normalized);
  const pidText = normalized.pid == null ? null : `PID ${normalized.pid}`;
  const exitText = normalized.exitCode === null ? null : `exit ${normalized.exitCode}`;
  const meta = [
    formatBashBackgroundTrigger(normalized.backgroundTrigger),
    duration,
    exitText,
    pidText,
    normalized.bashId,
  ].filter(Boolean);

  return (
    <div className={`mx-3 my-0.5 rounded-sm ${tone.bgClass} overflow-hidden`}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
        <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${tone.iconClass}`} />
        <span className="text-xs font-medium text-text-primary shrink-0">
          {formatBashBackgroundReason(normalized)}
        </span>
        {meta.length > 0 && (
          <span className="text-[10px] text-text-tertiary truncate">{meta.join(" · ")}</span>
        )}
      </div>

      {!compact && (
        <div className="border-t border-border-secondary/20 px-2.5 py-2 space-y-2">
          <div className="text-[10px] font-medium uppercase text-text-tertiary">
            命令
          </div>
          <div className="text-xs font-mono text-text-primary break-all leading-relaxed">
            {normalized.command}
          </div>
          {normalized.logPreview && <LogPreview preview={normalized.logPreview} />}
          <div className="grid gap-1 border-t border-border-secondary/20 pt-2">
            <DetailRow label="工作目录" value={normalized.cwd} />
            <DetailRow label="Bash ID" value={normalized.bashId} />
            <DetailRow label="Tool Call" value={normalized.toolCallId} />
            <DetailRow label="进程 ID" value={normalized.pid} />
            <DetailRow label="退出码" value={normalized.exitCode} />
            <DetailRow label="开始时间" value={formatTimestamp(normalized.startedAt)} />
            <DetailRow label="结束时间" value={formatTimestamp(normalized.endedAt)} />
            <DetailRow label="日志" value={normalized.logPath} />
          </div>
          {normalized.error && (
            <div className="rounded border border-status-error/20 bg-status-error/10 px-2 py-1.5 text-[11px] text-status-error break-words">
              {normalized.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

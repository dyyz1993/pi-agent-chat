export const BASH_BACKGROUND_PROCESS_CUSTOM_TYPE = "bash_background_process";
export const BASH_BACKGROUND_PROCESS_LEGACY_TYPE = "bash_background_exit";

const BASH_BACKGROUND_PROCESS_TYPES = new Set([
  BASH_BACKGROUND_PROCESS_CUSTOM_TYPE,
  BASH_BACKGROUND_PROCESS_LEGACY_TYPE,
]);

export type BashBackgroundReason =
  | "exit_zero"
  | "exit_nonzero"
  | "user_cancel"
  | "system_cancel"
  | "timeout"
  | "crash"
  | "unknown";

export type BashBackgroundStatus = "done" | "error" | "terminated" | "unknown";

export type BashBackgroundTrigger = "auto" | "manual" | "unknown";

export type BashBackgroundLogPreviewSegment =
  | { kind: "line"; text: string; repeatCount?: number }
  | { kind: "omitted"; lineCount: number };

export interface BashBackgroundLogPreview {
  totalLines: number;
  totalBytes: number;
  truncated: boolean;
  headLineCount: number;
  tailLineCount: number;
  segments: BashBackgroundLogPreviewSegment[];
}

export interface BashBackgroundProcessData {
  bashId?: string;
  toolCallId?: string;
  command: string;
  cwd?: string;
  pid?: number;
  status: BashBackgroundStatus;
  reason: BashBackgroundReason;
  backgroundTrigger: BashBackgroundTrigger;
  exitCode: number | null;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  duration?: string;
  logPath?: string;
  logPreview?: BashBackgroundLogPreview;
  error?: string;
  body?: string;
}

export function isBashBackgroundProcessType(customType: string): boolean {
  return BASH_BACKGROUND_PROCESS_TYPES.has(customType);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readExitCode(source: Record<string, unknown>): number | null {
  const value = source.exitCode ?? source.exit_code;
  if (value === null || value === undefined || value === "unknown") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readLogPreview(source: Record<string, unknown>): BashBackgroundLogPreview | undefined {
  const value = source.logPreview ?? source.log_preview;
  const preview = asRecord(value);
  const rawSegments = Array.isArray(preview.segments) ? preview.segments : [];
  const segments: BashBackgroundLogPreviewSegment[] = rawSegments.flatMap(
    (segment: unknown): BashBackgroundLogPreviewSegment[] => {
      const item = asRecord(segment);
      if (item.kind === "omitted") {
        const lineCount = readNumber(item, "lineCount") ?? readNumber(item, "line_count") ?? 0;
        return lineCount > 0 ? [{ kind: "omitted" as const, lineCount }] : [];
      }
      if (item.kind === "line" && typeof item.text === "string") {
        const repeatCount = readNumber(item, "repeatCount") ?? readNumber(item, "repeat_count");
        return [
          {
            kind: "line" as const,
            text: item.text,
            ...(repeatCount && repeatCount > 1 ? { repeatCount } : {}),
          },
        ];
      }
      return [];
    },
  );
  if (segments.length === 0) return undefined;

  return {
    totalLines: readNumber(preview, "totalLines") ?? readNumber(preview, "total_lines") ?? 0,
    totalBytes: readNumber(preview, "totalBytes") ?? readNumber(preview, "total_bytes") ?? 0,
    truncated: preview.truncated === true,
    headLineCount: readNumber(preview, "headLineCount") ?? readNumber(preview, "head_line_count") ?? 0,
    tailLineCount: readNumber(preview, "tailLineCount") ?? readNumber(preview, "tail_line_count") ?? 0,
    segments,
  };
}

function normalizeReason(
  source: Record<string, unknown>,
  exitCode: number | null,
): BashBackgroundReason {
  const reason = readString(source, "reason");
  if (
    reason === "exit_zero" ||
    reason === "exit_nonzero" ||
    reason === "user_cancel" ||
    reason === "system_cancel" ||
    reason === "timeout" ||
    reason === "crash"
  ) {
    return reason;
  }
  const status = readString(source, "status");
  if (status === "terminated") return "user_cancel";
  if (status === "done" || exitCode === 0) return "exit_zero";
  if (status === "error" || (exitCode !== null && exitCode !== 0)) return "exit_nonzero";
  return "unknown";
}

function normalizeStatus(
  source: Record<string, unknown>,
  reason: BashBackgroundReason,
): BashBackgroundStatus {
  const status = readString(source, "status");
  if (status === "done" || status === "error" || status === "terminated") return status;
  if (reason === "exit_zero") return "done";
  if (reason === "user_cancel" || reason === "system_cancel") return "terminated";
  if (reason !== "unknown") return "error";
  return "unknown";
}

function normalizeTrigger(source: Record<string, unknown>): BashBackgroundTrigger {
  const trigger = readString(source, "backgroundTrigger") ?? readString(source, "trigger");
  if (trigger === "auto" || trigger === "manual") return trigger;
  return "unknown";
}

export function normalizeBashBackgroundProcess(
  value: unknown,
): BashBackgroundProcessData | null {
  const source = asRecord(value);
  const exitCode = readExitCode(source);
  const reason = normalizeReason(source, exitCode);
  const status = normalizeStatus(source, reason);
  const command = readString(source, "command") ?? "(unknown command)";

  return {
    bashId: readString(source, "bashId") ?? readString(source, "bash_id"),
    toolCallId: readString(source, "toolCallId") ?? readString(source, "tool_call_id"),
    command,
    cwd: readString(source, "cwd"),
    pid: readNumber(source, "pid"),
    status,
    reason,
    backgroundTrigger: normalizeTrigger(source),
    exitCode,
    startedAt: readNumber(source, "startedAt"),
    endedAt: readNumber(source, "endedAt"),
    durationMs: readNumber(source, "durationMs") ?? readNumber(source, "duration_ms"),
    duration: readString(source, "duration"),
    logPath: readString(source, "logPath") ?? readString(source, "log_path"),
    logPreview: readLogPreview(source),
    error: readString(source, "error"),
    body: readString(source, "body"),
  };
}

export function formatBashBackgroundReason(data: BashBackgroundProcessData): string {
  switch (data.reason) {
    case "exit_zero":
      return "正常退出";
    case "exit_nonzero":
      return data.exitCode === null ? "异常退出" : `异常退出 ${data.exitCode}`;
    case "user_cancel":
      return "用户取消";
    case "system_cancel":
      return "系统取消";
    case "timeout":
      return "超时退出";
    case "crash":
      return "崩溃退出";
    default:
      return "后台进程";
  }
}

export function formatBashBackgroundTrigger(trigger: BashBackgroundTrigger): string {
  if (trigger === "manual") return "手动后台";
  if (trigger === "auto") return "自动后台";
  return "后台";
}

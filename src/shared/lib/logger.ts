export type LogModule =
  | "server"
  | "gateway"
  | "system"
  | "chat"
  | "chat-store"
  | "event-handler"
  | "session"
  | "session-perf"
  | "file"
  | "timer"
  | "git"
  | "agent"
  | "bash"
  | "config"
  | "snapshot"
  | "subagent"
  | "linked-projects"
  | "mcp"
  | "tier"
  | "settings"
  | "proxy-register"
  | "supervisor"
  | "lsp"
  | "memory"
  | "fork-dialog"
  | "tab-bar"
  | "project"
  | "sandbox-mgr"
  | "sandbox-rpc"
  | "sandbox-local"
  | "sandbox-box"
  | "sandbox-cf"
  | "change-review"
  | "sandbox-channel"
  | "project-config"
  | "render-cache";
type LogLevel = "debug" | "info" | "warn" | "error";

const VALID_LOG_LEVELS: Readonly<LogLevel[]> = ["debug", "info", "warn", "error"] as const;

/** 检查值是否为合法的 LogLevel */
function isValidLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && VALID_LOG_LEVELS.includes(value as LogLevel);
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Global minimum log level state (wrapped in object to allow mutation). */
const _logLevelState: { level: LogLevel } = {
  level: (() => {
    const envLevel = process.env.LOG_LEVEL;
    if (!envLevel) return "info";
    if (isValidLogLevel(envLevel)) return envLevel;
    console.warn(
      `[logger] Invalid LOG_LEVEL value: "${envLevel}". ` +
      `Valid values: ${VALID_LOG_LEVELS.join(", ")}. ` +
      `Falling back to "info".`
    );
    return "info";
  })(),
};

/** Returns true if the given level should be logged. */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[_logLevelState.level];
}

/** Change minimum log level at runtime. */
export function setMinLogLevel(level: LogLevel): void {
  _logLevelState.level = level;
}

/** Get current minimum log level. */
export function getMinLogLevel(): LogLevel {
  return _logLevelState.level;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: LogModule;
  message: string;
  data?: Record<string, unknown>;
}

export type LogSink = (line: string) => void;

let _sink: LogSink | null = null;

export function setLogSink(sink: LogSink): void {
  _sink = sink;
}

export function configureLogDir(_dir: string): void {}

function formatLine(entry: LogEntry): string {
  const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}`;
  return entry.data ? `${base} ${JSON.stringify(entry.data)}` : base;
}

export class Logger {
  private readonly module: LogModule;

  constructor(module: LogModule) {
    this.module = module;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write("error", message, data);
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      ...(data ? { data } : {}),
    };

    const line = formatLine(entry);

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }

    if (_sink) {
      _sink(line);
    }
  }
}

export function createLogger(module: LogModule): Logger {
  return new Logger(module);
}

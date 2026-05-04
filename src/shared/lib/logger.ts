export type LogModule = "server" | "gateway" | "system" | "chat" | "chat-store" | "event-handler" | "session" | "file" | "timer" | "git" | "agent" | "bash";
type LogLevel = "debug" | "info" | "warn" | "error";

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

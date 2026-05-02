import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export type LogModule = "server" | "gateway" | "system" | "chat" | "chat-store" | "event-handler" | "session" | "file" | "timer" | "git" | "agent" | "bash";
type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: LogModule;
  message: string;
  data?: Record<string, unknown>;
}

let _logDir: string | null = null;

/** Configure the log output directory (call once at startup) */
export function configureLogDir(dir: string): void {
  _logDir = dir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getLogDir(): string {
  if (!_logDir) {
    _logDir = "logs";
    if (!existsSync(_logDir)) {
      mkdirSync(_logDir, { recursive: true });
    }
  }
  return _logDir;
}

function formatLine(entry: LogEntry): string {
  const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}`;
  return entry.data ? `${base} ${JSON.stringify(entry.data)}` : base;
}

function writeToFile(line: string): void {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(getLogDir(), `${date}.log`);
    appendFileSync(filePath, `${line}\n`);
  } catch {
    // File write failure should not crash the app
  }
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

    // Console output
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }

    // File output (skip debug in production)
    if (process.env.NODE_ENV !== "production" || level !== "debug") {
      writeToFile(line);
    }
  }
}

/** Factory: create a module-scoped logger */
export function createLogger(module: LogModule): Logger {
  return new Logger(module);
}

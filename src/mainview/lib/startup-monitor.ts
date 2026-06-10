import { createLogger } from "../../shared/lib/logger";

const perfLog = createLogger("session-perf");
const MAX_STARTUP_EVENTS = 120;

export interface StartupPerfEvent {
  traceId: string;
  name: string;
  phase: string;
  kind: "mark" | "done" | "error";
  elapsedMs: number;
  deltaMs: number;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface StartupTrace {
  id: string;
  mark: (phase: string, details?: Record<string, unknown>) => void;
  done: (phase?: string, details?: Record<string, unknown>) => void;
  error: (phase: string, error: unknown, details?: Record<string, unknown>) => void;
}

let traceSeq = 0;
let startupEvents: StartupPerfEvent[] = [];

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushEvent(event: StartupPerfEvent): void {
  startupEvents = [...startupEvents.slice(-(MAX_STARTUP_EVENTS - 1)), event];
  perfLog.info(`[startup] ${event.name}:${event.phase}`, {
    traceId: event.traceId,
    kind: event.kind,
    elapsedMs: event.elapsedMs,
    deltaMs: event.deltaMs,
    ...(event.details ? { details: event.details } : {}),
  });
}

export function createStartupTrace(name: string, details?: Record<string, unknown>): StartupTrace {
  const startedAt = nowMs();
  let lastAt = startedAt;
  const id = `${Date.now().toString(36)}-${++traceSeq}`;

  const record = (
    kind: StartupPerfEvent["kind"],
    phase: string,
    eventDetails?: Record<string, unknown>,
  ) => {
    const current = nowMs();
    const elapsedMs = Math.round(current - startedAt);
    const deltaMs = Math.round(current - lastAt);
    lastAt = current;
    pushEvent({
      traceId: id,
      name,
      phase,
      kind,
      elapsedMs,
      deltaMs,
      timestamp: Date.now(),
      ...(eventDetails ? { details: eventDetails } : {}),
    });
  };

  record("mark", "begin", details);

  return {
    id,
    mark: (phase, eventDetails) => record("mark", phase, eventDetails),
    done: (phase = "done", eventDetails) => record("done", phase, eventDetails),
    error: (phase, error, eventDetails) =>
      record("error", phase, { ...eventDetails, error: normalizeError(error) }),
  };
}

export function getStartupPerfEvents(): StartupPerfEvent[] {
  return startupEvents;
}

export function clearStartupPerfEvents(): void {
  startupEvents = [];
}

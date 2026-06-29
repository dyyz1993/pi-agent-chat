export type AgentEndTerminalStatus = "completed" | "timeout" | "error" | "aborted";

export interface AgentEndOutcome {
  status: AgentEndTerminalStatus;
  exitCode: number;
  error?: string;
}

export function normalizeAgentEndReason(reason: unknown): string | undefined {
  if (typeof reason !== "string") return undefined;
  const normalized = reason.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function classifyAgentEndOutcome(reason: unknown): AgentEndOutcome {
  const normalized = normalizeAgentEndReason(reason);
  if (!normalized || normalized === "responded" || normalized === "completed") {
    return { status: "completed", exitCode: 0 };
  }

  const lower = normalized.toLowerCase();
  if (/\btimeout\b|timed out/.test(lower)) {
    return { status: "timeout", exitCode: 124, error: normalized };
  }

  if (/(abort|aborted|stop|stopped|cancel|cancelled|canceled|user_cancel|system_cancel)/.test(lower)) {
    return { status: "aborted", exitCode: 130, error: normalized };
  }

  return { status: "error", exitCode: 1, error: normalized };
}

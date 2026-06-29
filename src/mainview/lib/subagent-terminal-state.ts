import type { SubagentSessionInfo } from "../types";
import { classifyAgentEndOutcome } from "../../shared/agent/agent-end-outcome";

export function buildSubagentTerminalPatch(
  event: { reason?: unknown },
  finalText: string | undefined,
): Pick<SubagentSessionInfo, "completedAt" | "exitCode" | "finalText" | "error"> {
  const outcome = classifyAgentEndOutcome(event.reason);
  const trimmedFinalText = finalText?.trim();

  if (outcome.status === "completed") {
    return {
      completedAt: Date.now(),
      exitCode: outcome.exitCode,
      finalText:
        trimmedFinalText && trimmedFinalText.length > 0 ? trimmedFinalText : "(completed)",
      error: undefined,
    };
  }

  const fallbackFinalText =
    outcome.status === "aborted"
      ? "(stopped)"
      : outcome.status === "timeout"
        ? "(timed out)"
        : "(failed)";

  return {
    completedAt: Date.now(),
    exitCode: outcome.exitCode,
    finalText:
      trimmedFinalText && trimmedFinalText.length > 0 ? trimmedFinalText : fallbackFinalText,
    error: outcome.error,
  };
}

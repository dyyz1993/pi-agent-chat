/**
 * Retries goal.startSetup until the goal-vendor channel becomes ready
 * (the pi subprocess needs time to spawn before the channel is callable).
 *
 * Returns the last error so callers can surface it to the user instead of
 * silently failing.
 */
export interface GoalSetupBootstrapDeps {
  startSetup: (
    sessionId: string,
    objective: string,
  ) => Promise<{ started: boolean; error?: string }>;
  waitMs?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  intervalMs?: number;
}

export async function bootstrapGoalSetupWithRetry(
  sessionId: string,
  objective: string,
  deps: GoalSetupBootstrapDeps,
): Promise<{ started: boolean; error?: string }> {
  const waitMs =
    deps.waitMs ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = deps.maxAttempts ?? 5;
  const intervalMs = deps.intervalMs ?? 1000;

  let lastError: string | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await waitMs(intervalMs);
    const result = await deps.startSetup(sessionId, objective);
    if (result.started) return { started: true };
    lastError = result.error;
  }
  return { started: false, error: lastError ?? "goal.startSetup did not become ready" };
}

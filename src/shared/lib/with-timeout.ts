/**
 * Race a promise against a timeout. Rejects with an Error if the promise
 * does not settle within `ms` milliseconds.
 *
 * @param promise - The promise to race
 * @param ms      - Timeout in milliseconds
 * @param label   - Optional label included in the timeout error message
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label ?? "operation"} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

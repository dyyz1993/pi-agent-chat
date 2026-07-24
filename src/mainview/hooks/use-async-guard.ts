import { useCallback, useRef, useState } from "react";

/**
 * Guard an async handler against duplicate concurrent invocations.
 *
 * Returns a tuple of `[guardedFn, isRunning]`:
 * - `guardedFn`: wraps the given async function so that if it is called while
 *   the previous invocation is still in-flight, the call is silently skipped.
 * - `isRunning`: boolean indicating whether an invocation is currently running.
 *   Use it for `disabled={isRunning}` on buttons.
 *
 * This is the project-standard pattern for preventing double-clicks on async
 * buttons (e.g. clearGoal, deleteSession, git push). Equivalent to the manual
 * `clearingRef` / `rollingBackRef` pattern but reusable.
 *
 * @example
 * const [handleDelete, isDeleting] = useAsyncGuard(async () => {
 *   await apiClient.call("session.delete", { id });
 * });
 * <button onClick={handleDelete} disabled={isDeleting}>Delete</button>
 */
export function useAsyncGuard<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void>,
): [(...args: TArgs) => void, boolean] {
  const runningRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);

  const guarded = useCallback(
    (...args: TArgs) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setIsRunning(true);
      fn(...args)
        .catch(() => {
          // Swallow — caller is expected to handle errors inside fn
        })
        .finally(() => {
          runningRef.current = false;
          setIsRunning(false);
        });
    },
    [fn],
  );

  return [guarded, isRunning];
}

/**
 * Race a promise against an AbortSignal. Resolves/rejects with the underlying
 * promise's outcome when the signal stays intact; rejects with an
 * "Aborted" DOMException as soon as the signal fires.
 *
 * Useful when an underlying API cannot be cancelled natively (e.g. an RPC
 * framework that doesn't accept AbortSignal) but the caller wants the
 * awaiting code to stop blocking on abort.
 */
export async function raceWithAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

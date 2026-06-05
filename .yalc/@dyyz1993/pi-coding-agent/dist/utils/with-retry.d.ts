/**
 * Generic retry utility with exponential backoff.
 * Extracted from agent-session's _handleRetryableError for reuse in callLLM().
 */
/**
 * Check if an error is retryable (same logic as agent-session's _isRetryableError).
 */
export declare function isRetryableError(error: unknown): boolean;
export interface RetryOptions {
    /** Maximum number of retry attempts */
    maxRetries: number;
    /** Base delay in ms for exponential backoff (delay = baseDelayMs * 2^attempt) */
    baseDelayMs?: number;
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
    /** Called when a retry is about to happen (for UI events, logging, etc.) */
    onRetry?: (info: {
        attempt: number;
        maxAttempts: number;
        delayMs: number;
        error: unknown;
    }) => void;
}
/**
 * Execute a function with exponential backoff retry.
 * Reuses the same retry pattern as agent-session's _handleRetryableError:
 * - Same error pattern matching (isRetryableError)
 * - Same exponential backoff (baseDelayMs * 2^attempt)
 * - Same abort support via sleep()
 */
export declare function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
//# sourceMappingURL=with-retry.d.ts.map
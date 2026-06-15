import { useState, useCallback, useRef } from "react";
import { probeFileError, type FileErrorKind } from "../components/chat/preview/probe-file-error";

export { type FileErrorKind };

export interface UseMediaCardErrorResult {
  /** True when an error has occurred */
  error: boolean;
  /** The probed error kind, or null before probing completes */
  errorKind: FileErrorKind | null;
  /** Additional detail message from the probe, or null */
  errorDetail: string | null;
  /** Call on media element onError event */
  handleError: () => void;
  /** Call to reset error state and trigger a retry (increments retryKey) */
  handleRetry: () => void;
  /** Incremented on each retry — use as `key` on the media element */
  retryKey: number;
}

/**
 * Shared error-handling logic for media preview cards (Audio/Image/Video).
 *
 * Probes the `/info/` endpoint exactly once per load cycle to determine
 * the specific HTTP error reason (forbidden, not_found, server_error, network).
 * On retry, resets all state and increments `retryKey` so the consumer can
 * remount the media element.
 */
export function useMediaCardError(absolutePath: string | undefined): UseMediaCardErrorResult {
  const [error, setError] = useState(false);
  const [errorKind, setErrorKind] = useState<FileErrorKind | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const probingRef = useRef(false);

  const handleError = useCallback(() => {
    setError(true);
    if (absolutePath && !probingRef.current) {
      probingRef.current = true;
      probeFileError(absolutePath).then((result) => {
        if (!result.ok) {
          setErrorKind(result.error ?? "network");
          setErrorDetail(result.detail ?? null);
        }
      });
    }
  }, [absolutePath]);

  const handleRetry = useCallback(() => {
    setError(false);
    setErrorKind(null);
    setErrorDetail(null);
    probingRef.current = false;
    setRetryKey((k) => k + 1);
  }, []);

  return {
    error,
    errorKind,
    errorDetail,
    handleError,
    handleRetry,
    retryKey,
  };
}

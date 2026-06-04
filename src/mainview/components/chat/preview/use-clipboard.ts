import { useState, useCallback } from "react";
import { useCopyFeedback, type CopyFeedbackOptions } from "../../primitives";

export function useClipboard(
  timeout = 2000,
  options?: CopyFeedbackOptions,
): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const copyWithFeedback = useCopyFeedback({ showToast: false, ...options });

  const copy = useCallback(
    (text: string) => {
      copyWithFeedback(text).then((ok) => {
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), timeout);
        }
      });
    },
    [copyWithFeedback, timeout],
  );

  return { copied, copy };
}

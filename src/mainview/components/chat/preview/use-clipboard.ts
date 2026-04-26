import { useState, useCallback } from "react";
import { copyToClipboard } from "../../../utils/clipboard";

export function useClipboard(timeout = 2000): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    (text: string) => {
      copyToClipboard(text).then((ok) => {
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), timeout);
        }
      });
    },
    [timeout],
  );

  return { copied, copy };
}

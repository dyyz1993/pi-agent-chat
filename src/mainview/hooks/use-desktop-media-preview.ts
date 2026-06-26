import { useEffect, useState } from "react";
import { apiClient } from "../lib/api-client";

interface DesktopMediaPreviewState {
  src: string;
  loading: boolean;
  error: string | null;
}

export function useDesktopMediaPreview(
  absolutePath: string | undefined,
  mimeType: string | undefined,
  reloadKey = 0,
): DesktopMediaPreviewState {
  const isDesktop = apiClient.getTransport() === "ipc";
  const [src, setSrc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!absolutePath) {
      setSrc("");
      setLoading(false);
      setError(null);
      return;
    }

    if (!isDesktop) {
      setSrc("");
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    apiClient
      .call("file.readBinaryFile", { path: absolutePath })
      .then((result) => {
        if (cancelled) return;
        const mediaType = mimeType ?? "application/octet-stream";
        setSrc(`data:${mediaType};base64,${result.base64}`);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSrc("");
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [absolutePath, isDesktop, mimeType, reloadKey]);

  return { src, loading, error };
}

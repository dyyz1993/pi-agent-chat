import { useDesktopMediaPreview } from "./use-desktop-media-preview";
import {
  getFileHttpUrl,
  shouldUseRpcPreviewSource,
} from "../components/chat/preview/types";

interface PreviewRenderSourceState {
  src: string;
  loading: boolean;
  error: string | null;
  usesRpcPreview: boolean;
}

export function usePreviewRenderSource(
  renderableSource: string | undefined,
  mimeType: string | undefined,
  reloadKey = 0,
): PreviewRenderSourceState {
  const usesRpcPreview = shouldUseRpcPreviewSource(renderableSource);
  const rpcPreview = useDesktopMediaPreview(
    usesRpcPreview ? renderableSource : undefined,
    mimeType,
    reloadKey,
  );

  if (!renderableSource) {
    return { src: "", loading: false, error: null, usesRpcPreview: false };
  }

  if (usesRpcPreview) {
    return {
      src: rpcPreview.src,
      loading: rpcPreview.loading,
      error: rpcPreview.error,
      usesRpcPreview,
    };
  }

  return {
    src: getFileHttpUrl(renderableSource),
    loading: false,
    error: null,
    usesRpcPreview,
  };
}

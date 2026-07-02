import { memo, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ImageIcon } from "lucide-react";

import { ContentSurface } from "./ContentSurface";

interface ImageViewerOverlayProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export const ImageViewerOverlay = memo(function ImageViewerOverlay({
  src,
  alt = "preview",
  onClose,
}: ImageViewerOverlayProps) {
  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const overlay = (
    <ContentSurface
      title="Image preview"
      closeLabel="Close image preview"
      closeButtonSize="touch"
      icon={<ImageIcon className="h-4 w-4 text-accent" aria-hidden="true" />}
      onClose={onClose}
      position="fixed"
      testId="image-viewer-overlay"
      className="bg-bg-elevated"
      bodyClassName="flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      onRootClick={handleBackdropClick}
    >
      <img
        src={src}
        alt={alt}
        className="max-h-[calc(100vh-6rem)] max-w-[94vw] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </ContentSurface>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
});

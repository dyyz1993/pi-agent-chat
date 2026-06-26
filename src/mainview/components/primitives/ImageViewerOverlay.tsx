import { memo, useId, useRef, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/use-focus-trap";
import { cx } from "../../lib/classes";
import { IconButton } from "./IconButton";

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
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);

  useFocusTrap(overlayRef, { onEscape: onClose });

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const overlay = (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="image-viewer-overlay"
      className={cx(
        "fixed inset-0 z-fullscreen flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm",
        "sm:p-6",
      )}
      style={{
        paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))",
        paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
      }}
      onClick={handleBackdropClick}
    >
      <h2 id={titleId} className="sr-only">
        Image preview
      </h2>
      <img
        src={src}
        alt={alt}
        className="max-h-[calc(100vh-6rem)] max-w-[94vw] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <IconButton
        label="Close image preview"
        size="md"
        onClick={onClose}
        className="absolute right-4 h-11 w-11 rounded-full bg-white/15 text-white hover:bg-white/25 hover:text-white sm:right-6 sm:h-9 sm:w-9"
        style={{ top: "calc(1rem + env(safe-area-inset-top, 0px))" }}
      >
        <X className="w-4 h-4" />
      </IconButton>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
});

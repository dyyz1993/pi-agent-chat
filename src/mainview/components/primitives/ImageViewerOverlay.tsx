import { memo } from "react";
import { X } from "lucide-react";

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
  return (
    <div
      className="fixed inset-0 z-fullscreen bg-black/70 flex items-center justify-center p-4"
      style={{
        paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
        style={{ top: "calc(1rem + env(safe-area-inset-top, 0px))" }}
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
});

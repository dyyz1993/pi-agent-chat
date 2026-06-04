import { memo, useEffect, useRef } from "react";
import { X } from "lucide-react";

interface CodeExpandOverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const CodeExpandOverlay = memo(function CodeExpandOverlay({
  open,
  onClose,
  title,
  children,
}: CodeExpandOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-[200] flex flex-col bg-bg-elevated dark:bg-surface-code"
    >
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-dim border-b border-border-secondary flex-shrink-0">
        <span className="text-xs text-text-secondary font-medium truncate">{title}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-2 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
});

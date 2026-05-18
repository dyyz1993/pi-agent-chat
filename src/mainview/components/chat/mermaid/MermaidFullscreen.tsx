import { memo, useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMermaidStore } from "../../../stores/use-mermaid-store";
import { MermaidBlock } from "./MermaidBlock";
import { useFocusTrap } from "../../../hooks/use-focus-trap";

export const MermaidFullscreen = memo(function MermaidFullscreen() {
  const { t } = useTranslation("chat");
  const code = useMermaidStore((s) => s.code);
  const closeFullscreen = useMermaidStore((s) => s.closeFullscreen);
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, { onEscape: closeFullscreen });

  useEffect(() => {
    if (!code) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFullscreen();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [code, closeFullscreen]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) closeFullscreen();
    },
    [closeFullscreen],
  );

  if (!code) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] flex flex-col bg-bg-elevated backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="flex items-center gap-2 px-4 py-2 bg-surface-code border-b border-border-secondary flex-shrink-0"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        <span className="text-xs text-text-secondary font-medium">{t("mermaidChart")}</span>
        <div className="flex-1" />
        <button
          onClick={closeFullscreen}
          className="p-2 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
          title={t("closeEscTitle")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div
        className="flex-1 overflow-auto p-6"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="max-w-[90vw] mx-auto">
          <MermaidBlock code={code} inline={false} />
        </div>
      </div>
    </div>
  );
});

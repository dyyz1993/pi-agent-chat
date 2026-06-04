import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useMermaidStore } from "../../../stores/use-mermaid-store";
import { MermaidBlock } from "./MermaidBlock";
import { FullscreenOverlay } from "../../primitives";

export const MermaidFullscreen = memo(function MermaidFullscreen() {
  const { t } = useTranslation("chat");
  const code = useMermaidStore((s) => s.code);
  const closeFullscreen = useMermaidStore((s) => s.closeFullscreen);

  if (!code) return null;

  return (
    <FullscreenOverlay
      title={t("mermaidChart")}
      onClose={closeFullscreen}
      closeLabel={t("closeEscTitle")}
      bodyClassName="overflow-auto p-6"
      bodyStyle={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="max-w-[90vw] mx-auto">
        <MermaidBlock code={code} inline={false} />
      </div>
    </FullscreenOverlay>
  );
});

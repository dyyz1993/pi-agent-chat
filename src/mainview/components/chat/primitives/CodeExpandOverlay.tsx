import { memo } from "react";
import { useTranslation } from "react-i18next";
import { FullscreenOverlay } from "../../primitives";

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
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <FullscreenOverlay
      title={title}
      onClose={onClose}
      closeLabel={t("common:close")}
      position="absolute"
      bodyClassName="overflow-auto"
    >
      {children}
    </FullscreenOverlay>
  );
});

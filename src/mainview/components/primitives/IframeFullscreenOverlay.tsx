import { memo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ContentSurface } from "./ContentSurface";

interface IframeFullscreenOverlayProps {
  icon: ReactNode;
  title: string;
  src: string;
  onClose: () => void;
  closeLabel: string;
  actions?: ReactNode;
  iframeKey?: number;
  sandbox?: string;
}

export const IframeFullscreenOverlay = memo(function IframeFullscreenOverlay({
  icon,
  title,
  src,
  onClose,
  closeLabel,
  actions,
  iframeKey,
  sandbox,
}: IframeFullscreenOverlayProps) {
  return createPortal(
    <ContentSurface
      title={title}
      onClose={onClose}
      closeLabel={closeLabel}
      icon={icon}
      actions={actions}
      position="fixed"
      bodyClassName="overflow-hidden"
    >
      <iframe
        key={iframeKey}
        src={src}
        className="w-full h-full border-0"
        sandbox={sandbox}
        title={title}
      />
    </ContentSurface>,
    document.body,
  );
});

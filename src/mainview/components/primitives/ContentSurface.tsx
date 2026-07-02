import { memo } from "react";

import { cx } from "../../lib/classes";
import { FullscreenOverlay, type FullscreenOverlayProps } from "./FullscreenOverlay";

export type ContentSurfaceProps = Omit<FullscreenOverlayProps, "closeLabel"> & {
  closeLabel?: string;
};

export const ContentSurface = memo(function ContentSurface({
  closeLabel = "Close",
  position = "absolute",
  className,
  bodyClassName,
  ...props
}: ContentSurfaceProps) {
  return (
    <FullscreenOverlay
      closeLabel={closeLabel}
      position={position}
      className={cx("bg-bg-elevated", className)}
      bodyClassName={cx("bg-bg-secondary/60", bodyClassName)}
      {...props}
    />
  );
});

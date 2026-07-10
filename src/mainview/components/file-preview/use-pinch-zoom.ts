import { useEffect, useRef } from "react";
import { clampZoom, saveZoom } from "./zoom-utils";

type SetFontSize = (updater: (prev: number) => number) => void;

/**
 * Pinch-to-zoom for touch devices. Returns a ref to attach to the scrollable
 * content container.
 *
 * During the gesture we apply CSS `zoom` on the container for instant visual
 * feedback with zero React re-renders. On `touchend` we compute the final
 * font size, do a single `setFontSize` call, and remove the CSS zoom.
 *
 * @param fontSizeRef - a ref that always holds the latest fontSize
 * @param setFontSize - the useState setter (updater form)
 */
export function usePinchZoom(
  fontSizeRef: React.MutableRefObject<number>,
  setFontSize: SetFontSize,
) {
  const elementRef = useRef<HTMLDivElement>(null);
  const touchStateRef = useRef<{
    distance: number;
    startFontSize: number;
  } | null>(null);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Remove any stale CSS zoom from a previous interrupted gesture.
        el.style.removeProperty("zoom");

        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStateRef.current = {
          distance: Math.sqrt(dx * dx + dy * dy),
          startFontSize: fontSizeRef.current,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && touchStateRef.current) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const scale = distance / touchStateRef.current.distance;

        // Pure CSS zoom – no React state change, no re-render.
        el.style.setProperty("zoom", String(scale));
      }
    };

    const onTouchEnd = () => {
      if (!touchStateRef.current) return;

      const startFs = touchStateRef.current.startFontSize;
      let finalScale = 1;

      const currentZoom = el.style.zoom;
      if (currentZoom) {
        const parsed = parseFloat(currentZoom);
        if (!isNaN(parsed) && parsed > 0) {
          finalScale = parsed;
        }
        el.style.removeProperty("zoom");
      }

      const finalFs = clampZoom(startFs * finalScale);
      if (finalFs !== fontSizeRef.current) {
        setFontSize(() => finalFs);
      }
      saveZoom(finalFs);
      touchStateRef.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      // Clean up CSS zoom if the component unmounts mid-gesture.
      el.style.removeProperty("zoom");
    };
  }, [fontSizeRef, setFontSize]);

  return elementRef;
}

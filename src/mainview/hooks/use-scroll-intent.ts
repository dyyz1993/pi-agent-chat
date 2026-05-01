import { useRef, useCallback, useEffect } from "react";

const INTENT_WINDOW_MS = 600;
const SCROLL_INTENT_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Spacebar",
]);

export function useScrollIntent(scrollElement: HTMLElement | null) {
  const intentUntilRef = useRef(0);
  const directionRef = useRef<"up" | "down" | null>(null);

  const markIntent = useCallback((direction?: "up" | "down" | null) => {
    intentUntilRef.current = performance.now() + INTENT_WINDOW_MS;
    if (direction) {
      directionRef.current = direction;
    }
  }, []);

  const hasIntent = useCallback(() => {
    return performance.now() <= intentUntilRef.current;
  }, []);

  useEffect(() => {
    if (!scrollElement) return;

    const onWheel = (e: WheelEvent) => {
      const dir: "up" | "down" | null =
        e.deltaY < 0 ? "up" : e.deltaY > 0 ? "down" : null;
      markIntent(dir);
    };

    const onPointerDown = () => {
      markIntent(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!SCROLL_INTENT_KEYS.has(e.key)) return;
      const key = e.key;
      const dir: "up" | "down" | null =
        key === "ArrowUp" || key === "PageUp" || key === "Home"
          ? "up"
          : key === "ArrowDown" || key === "PageDown" || key === "End"
            ? "down"
            : key === " " || key === "Spacebar"
              ? e.shiftKey
                ? "up"
                : "down"
              : null;
      markIntent(dir);
    };

    scrollElement.addEventListener("wheel", onWheel, { passive: true });
    scrollElement.addEventListener("pointerdown", onPointerDown);
    scrollElement.addEventListener("touchstart", onPointerDown, {
      passive: true,
    });
    scrollElement.addEventListener("keydown", onKeyDown);

    return () => {
      scrollElement.removeEventListener("wheel", onWheel);
      scrollElement.removeEventListener("pointerdown", onPointerDown);
      scrollElement.removeEventListener("touchstart", onPointerDown);
      scrollElement.removeEventListener("keydown", onKeyDown);
    };
  }, [scrollElement, markIntent]);

  return { hasIntent, markIntent, directionRef };
}

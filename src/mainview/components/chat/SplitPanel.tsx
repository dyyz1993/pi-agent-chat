import { useCallback, useRef, useState, useEffect } from "react";

interface SplitPanelProps {
  direction?: "horizontal" | "vertical";
  defaultSizes?: number[];
  minSizes?: number[];
  persistKey?: string;
  children: React.ReactNode[];
}

function readSizes(key: string, fallback: number[]): number[] {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    const arr = JSON.parse(v);
    if (!Array.isArray(arr) || arr.length !== fallback.length) return fallback;
    return arr.map((n: number, i: number) =>
      typeof n === "number" && isFinite(n) && n > 0 ? n : fallback[i]
    );
  } catch {
    return fallback;
  }
}

function writeSizes(key: string, sizes: number[]) {
  try {
    localStorage.setItem(key, JSON.stringify(sizes));
  } catch { /* ignore */ }
}

export function SplitPanel({
  direction = "horizontal",
  defaultSizes = [50, 50],
  minSizes = [100, 100],
  persistKey,
  children,
}: SplitPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(() =>
    persistKey ? readSizes(persistKey, defaultSizes) : defaultSizes
  );
  const draggingRef = useRef(-1);

  useEffect(() => {
    if (persistKey) writeSizes(persistKey, sizes);
  }, [sizes, persistKey]);

  const isHorizontal = direction === "horizontal";

  const startDrag = useCallback(
    (index: number) => (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      draggingRef.current = index;
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const totalSize = isHorizontal ? rect.width : rect.height;
      const startPos = "touches" in e ? e.touches[0].clientX : isHorizontal ? (e as React.MouseEvent).clientX : (e as React.MouseEvent).clientY;
      const startSizes = [...sizes];

      const calcDelta = (clientX: number, clientY: number) => {
        const currentPos = isHorizontal ? clientX : clientY;
        return ((currentPos - startPos) / totalSize) * 100;
      };

      const applyMove = (delta: number) => {
        if (draggingRef.current < 0) return;
        const newSizes = [...startSizes];
        newSizes[draggingRef.current] += delta;
        newSizes[draggingRef.current + 1] -= delta;

        for (let i = 0; i < newSizes.length; i++) {
          const minPct = (minSizes[i] / totalSize) * 100;
          newSizes[i] = Math.max(
            minPct,
            Math.min(
              100 -
                minSizes.reduce(
                  (a, _, j) => (j !== i ? a + minSizes[j] : a),
                  0
                ),
              newSizes[i]
            )
          );
        }
        setSizes(newSizes);
      };

      const onMouseMove = (ev: MouseEvent) => {
        applyMove(calcDelta(ev.clientX, ev.clientY));
      };

      const onTouchMove = (ev: TouchEvent) => {
        ev.preventDefault();
        applyMove(calcDelta(ev.touches[0].clientX, ev.touches[0].clientY));
      };

      const handleUp = () => {
        draggingRef.current = -1;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", handleUp);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", handleUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", handleUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", handleUp);
    },
    [sizes, minSizes, isHorizontal]
  );

  return (
    <div
      ref={containerRef}
      className={`flex ${isHorizontal ? "flex-row" : "flex-col"} w-full h-full overflow-hidden`}
    >
      {children.map((child, i) => (
        <div
          key={i}
          style={{ flex: `0 0 ${sizes[i]}%`, overflow: "hidden" }}
        >
          {child}
          {i < children.length - 1 && (
            <div
              className={`${isHorizontal ? "w-1 cursor-col-resize hover:bg-indigo-500/40" : "h-1 cursor-row-resize hover:bg-indigo-500/40"} bg-gray-700/30 shrink-0 transition-colors touch-none select-none`}
              onMouseDown={startDrag(i)}
              onTouchStart={startDrag(i)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

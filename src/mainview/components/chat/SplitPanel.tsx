import { useCallback, useRef, useState } from "react";

interface SplitPanelProps {
  direction?: "horizontal" | "vertical";
  defaultSizes?: number[];
  minSizes?: number[];
  children: React.ReactNode[];
}

export function SplitPanel({
  direction = "horizontal",
  defaultSizes = [50, 50],
  minSizes = [100, 100],
  children,
}: SplitPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(defaultSizes);
  const draggingRef = useRef(-1);

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = index;
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const totalSize = isHorizontal ? rect.width : rect.height;
      const startPos = isHorizontal ? e.clientX : e.clientY;
      const startSizes = [...sizes];

      const handleMove = (ev: MouseEvent) => {
        if (draggingRef.current < 0) return;
        const currentPos = isHorizontal ? ev.clientX : ev.clientY;
        const delta = ((currentPos - startPos) / totalSize) * 100;

        const newSizes = [...startSizes];
        newSizes[draggingRef.current] += delta;
        newSizes[draggingRef.current + 1] -= delta;

        for (let i = 0; i < newSizes.length; i++) {
          const minPct = (minSizes[i] / totalSize) * 100;
          newSizes[i] = Math.max(minPct, Math.min(100 - minSizes.reduce((a, _, j) => (j !== i ? a + minSizes[j] : a), 0), newSizes[i]));
        }

        setSizes(newSizes);
      };

      const handleUp = () => {
        draggingRef.current = -1;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [sizes, minSizes, isHorizontal]
  );

  return (
    <div ref={containerRef} className={`flex ${isHorizontal ? "flex-row" : "flex-col"} w-full h-full overflow-hidden`}>
      {children.map((child, i) => (
        <div key={i} style={{ flex: `0 0 ${sizes[i]}%`, overflow: "hidden" }}>
          {child}
          {i < children.length - 1 && (
            <div
              className={`${isHorizontal ? "w-1 cursor-col-resize hover:bg-indigo-500/40" : "h-1 cursor-row-resize hover:bg-indigo-500/40"} bg-gray-700/30 shrink-0 transition-colors`}
              onMouseDown={handleMouseDown(i)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

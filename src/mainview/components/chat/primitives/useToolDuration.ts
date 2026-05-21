import { useState, useEffect, useMemo } from "react";
import { formatDuration } from "./formatDuration";

export function useToolDuration(
  startedAt: number | undefined,
  endedAt: number | undefined,
  status: string,
): string | null {
  const hasStart = typeof startedAt === "number" && startedAt > 0;
  const isRunning = status === "running";
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!hasStart || !isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasStart, isRunning]);

  return useMemo(() => {
    if (!hasStart) return null;
    const end = endedAt && endedAt > 0 ? endedAt : isRunning ? now : null;
    if (!end) return null;
    const ms = end - startedAt;
    return ms > 0 ? formatDuration(ms) : null;
  }, [hasStart, endedAt, isRunning, now, startedAt]);
}

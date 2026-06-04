import { useState, useCallback, useRef } from "react";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("chat");

const HISTORY_KEY = "pi-input-history";
const MAX_ITEMS = 10;

function getStorageKey(sessionId: string): string {
  return `${HISTORY_KEY}:${sessionId}`;
}

function readHistory(sessionId: string): string[] {
  try {
    const raw = localStorage.getItem(getStorageKey(sessionId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return (parsed as string[]).slice(0, MAX_ITEMS);
  } catch (e) {
    log.warn("Failed to read input history", { sessionId, error: String(e) });
  }
  return [];
}

function writeHistory(sessionId: string, items: string[]) {
  try {
    localStorage.setItem(getStorageKey(sessionId), JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch (e) {
    log.warn("Failed to write input history", { sessionId, error: String(e) });
  }
}

export function saveToInputHistory(sessionId: string, text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const filtered = readHistory(sessionId).filter((item) => item !== trimmed);
  const updated = [trimmed, ...filtered].slice(0, MAX_ITEMS);
  writeHistory(sessionId, updated);
  return updated;
}

export function useInputHistory(sessionId: string) {
  const historyRef = useRef<string[]>(readHistory(sessionId));
  const indexRef = useRef(-1);
  const [, forceUpdate] = useState(0);

  const hasPrev = historyRef.current.length > 0 && indexRef.current < historyRef.current.length - 1;
  const hasNext = indexRef.current > 0;

  const saveToHistory = useCallback(
    (text: string) => {
      const updated = saveToInputHistory(sessionId, text);
      if (!updated) return;
      historyRef.current = updated;
      indexRef.current = -1;
      forceUpdate((n) => n + 1);
    },
    [sessionId],
  );

  const navigatePrev = useCallback((): string | null => {
    const h = historyRef.current;
    if (h.length === 0) return null;
    const nextIdx = Math.min(indexRef.current + 1, h.length - 1);
    indexRef.current = nextIdx;
    forceUpdate((n) => n + 1);
    return h[nextIdx];
  }, []);

  const navigateNext = useCallback((): string | null => {
    const h = historyRef.current;
    if (h.length === 0) return null;
    const nextIdx = indexRef.current - 1;
    if (nextIdx < 0) {
      indexRef.current = -1;
      forceUpdate((n) => n + 1);
      return "";
    }
    indexRef.current = nextIdx;
    forceUpdate((n) => n + 1);
    return h[nextIdx];
  }, []);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    indexRef.current = -1;
    try {
      localStorage.removeItem(getStorageKey(sessionId));
    } catch (e) {
      log.warn("Failed to clear input history", { sessionId, error: String(e) });
    }
    forceUpdate((n) => n + 1);
  }, [sessionId]);

  const resetIndex = useCallback(() => {
    if (indexRef.current !== -1) {
      indexRef.current = -1;
      forceUpdate((n) => n + 1);
    }
  }, []);

  return { saveToHistory, navigatePrev, navigateNext, clearHistory, resetIndex, hasPrev, hasNext };
}

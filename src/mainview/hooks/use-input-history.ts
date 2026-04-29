import { useState, useCallback, useRef } from "react";

const HISTORY_KEY = "pi-input-history";
const MAX_ITEMS = 10;

function getStorageKey(sessionId: string): string {
  return `${HISTORY_KEY}:${sessionId}`;
}

function readHistory(sessionId: string): string[] {
  try {
    const raw = localStorage.getItem(getStorageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.slice(0, MAX_ITEMS);
  } catch { /* ignore */ }
  return [];
}

function writeHistory(sessionId: string, items: string[]) {
  try {
    localStorage.setItem(getStorageKey(sessionId), JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch { /* ignore */ }
}

export function useInputHistory(sessionId: string) {
  const historyRef = useRef<string[]>(readHistory(sessionId));
  const indexRef = useRef(-1);
  const [, forceUpdate] = useState(0);

  const hasPrev = historyRef.current.length > 0 && indexRef.current < historyRef.current.length - 1;
  const hasNext = indexRef.current > 0;

  const saveToHistory = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const h = historyRef.current;
    const filtered = h.filter((item) => item !== trimmed);
    const updated = [trimmed, ...filtered].slice(0, MAX_ITEMS);
    historyRef.current = updated;
    writeHistory(sessionId, updated);
    indexRef.current = -1;
    forceUpdate((n) => n + 1);
  }, [sessionId]);

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
    } catch { /* ignore */ }
    forceUpdate((n) => n + 1);
  }, [sessionId]);

  const resetIndex = useCallback(() => {
    indexRef.current = -1;
    forceUpdate((n) => n + 1);
  }, []);

  return { saveToHistory, navigatePrev, navigateNext, clearHistory, resetIndex, hasPrev, hasNext };
}

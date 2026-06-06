type Update = { sessionId: string; apply: () => void };

let queue: Update[] = [];
let scheduled = false;
let rafId: number | null = null;
let timerId: ReturnType<typeof setTimeout> | null = null;

const FLUSH_DELAY_MS = 16;
const FLUSH_MAX_DELAY_MS = 50;

function flushQueue() {
  const batch = queue;
  queue = [];
  for (const u of batch) u.apply();
}

function clearScheduledHandles() {
  if (rafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafId);
  }
  rafId = null;
  if (timerId !== null) {
    clearTimeout(timerId);
  }
  timerId = null;
}

function runScheduledFlush() {
  if (!scheduled) return;
  scheduled = false;
  clearScheduledHandles();
  flushQueue();
}

function canUseAnimationFrame(): boolean {
  return (
    typeof requestAnimationFrame === "function" &&
    (typeof document === "undefined" || document.visibilityState !== "hidden")
  );
}

function scheduleFlush() {
  scheduled = true;
  if (canUseAnimationFrame()) {
    rafId = requestAnimationFrame(runScheduledFlush);
    timerId = setTimeout(runScheduledFlush, FLUSH_MAX_DELAY_MS);
    return;
  }
  timerId = setTimeout(runScheduledFlush, FLUSH_DELAY_MS);
}

export function batchMessageUpdate(sessionId: string, apply: () => void) {
  queue.push({ sessionId, apply });
  if (!scheduled) scheduleFlush();
}

export function flushNow() {
  if (!scheduled && queue.length === 0) return;
  scheduled = false;
  clearScheduledHandles();
  flushQueue();
}

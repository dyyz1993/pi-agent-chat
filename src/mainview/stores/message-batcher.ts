type Update = { sessionId: string; apply: () => void };

let queue: Update[] = [];
let rafId: number | null = null;

function flush() {
  rafId = null;
  const batch = queue;
  queue = [];
  for (const u of batch) u.apply();
}

export function batchMessageUpdate(sessionId: string, apply: () => void) {
  queue.push({ sessionId, apply });
  if (!rafId) {
    rafId = requestAnimationFrame(flush);
  }
}

export function flushNow() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    flush();
  }
}

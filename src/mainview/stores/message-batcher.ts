type Update = { sessionId: string; apply: () => void };

let queue: Update[] = [];
let rafId: number | null = null;

function flush() {
  rafId = null;
  const batch = queue;
  queue = [];
  const latest = new Map<string, Update>();
  for (const u of batch) latest.set(u.sessionId, u);
  for (const u of latest.values()) u.apply();
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

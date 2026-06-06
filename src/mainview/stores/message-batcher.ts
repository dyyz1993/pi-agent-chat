type Update = { sessionId: string; apply: () => void };

let queue: Update[] = [];
let scheduled = false;

function flushQueue() {
  const batch = queue;
  queue = [];
  for (const u of batch) u.apply();
}

function runScheduledFlush() {
  if (!scheduled) return;
  scheduled = false;
  flushQueue();
}

function scheduleFlush() {
  scheduled = true;
  if (typeof queueMicrotask === "function") {
    queueMicrotask(runScheduledFlush);
    return;
  }
  Promise.resolve().then(runScheduledFlush);
}

export function batchMessageUpdate(sessionId: string, apply: () => void) {
  queue.push({ sessionId, apply });
  if (!scheduled) scheduleFlush();
}

export function flushNow() {
  if (!scheduled && queue.length === 0) return;
  scheduled = false;
  flushQueue();
}

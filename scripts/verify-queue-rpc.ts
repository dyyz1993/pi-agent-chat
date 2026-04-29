import { WebSocket } from "ws";

const WS_URL = "ws://localhost:3100/ws?token=pi-agent-chat-chat-token";
const PROJECT_PATH = "/Users/xuyingzhou/Project/temporary/pi-agent-chat";
let msgId = 0;

function nextId(): string {
  return `req-${++msgId}`;
}

const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const events: Array<{ eventType: string; payload: unknown }> = [];
let ws: WebSocket;

function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.on("open", () => {
      console.log("[✓] Connected");
      resolve();
    });
    ws.on("error", reject);
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "response" && pendingRequests.has(msg.id)) {
        const p = pendingRequests.get(msg.id)!;
        pendingRequests.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.type === "event") {
        const ev = { eventType: msg.eventType, payload: msg.payload };
        events.push(ev);
        const agentEvent = msg.payload?.event;
        if (agentEvent?.type === "queue_update") {
          console.log(`\n🔴 [EVENT] queue_update:`, JSON.stringify(agentEvent, null, 2));
        } else if (msg.eventType === "agent.event") {
          console.log(`\n🟡 [EVENT] ${agentEvent?.type || msg.eventType}`);
        }
      }
    });
  });
}

function call(method: string, params: unknown, timeout = 15000): Promise<unknown> {
  const id = nextId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingRequests.delete(id); reject(new Error(`Timeout: ${method}`)); }, timeout);
    pendingRequests.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id, type: "request", method, params }));
  });
}

function subscribe(eventType: string): void {
  const id = nextId();
  ws.send(JSON.stringify({ id, type: "subscribe", eventType, filter: {} }));
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function log(label: string, data: unknown) { console.log(`  ${label}:`, JSON.stringify(data)); }

async function main() {
  console.log("=== Queue RPC Verification ===\n");
  await connect();
  subscribe("agent.event");

  // ── 1. Find a session ──
  console.log("── 1. Scan sessions ──");
  const scan = (await call("project.scanSessions", { projectPath: PROJECT_PATH })) as { sessions: Array<{ sessionId: string; sessionPath: string }> };
  let sessionId: string | undefined;
  let sessionPath: string | undefined;
  if (scan.sessions?.length > 0) {
    sessionId = scan.sessions[0].sessionId;
    sessionPath = scan.sessions[0].sessionPath;
    log("Using existing session", { sessionId });
  } else {
    console.log("  No sessions, creating...");
    const created = (await call("session.create", { projectPath: PROJECT_PATH })) as any;
    sessionId = created?.sessionId;
    sessionPath = created?.sessionPath;
    log("Created session", { sessionId });
  }

  if (!sessionId) { console.log("[✗] No session. Exit."); process.exit(1); }

  // ── 2. Start agent ──
  console.log("\n── 2. Start agent ──");
  const startResult = await call("agent.start", { sessionId, projectPath: PROJECT_PATH, sessionPath });
  log("Start", startResult);
  await sleep(3000);

  // ── 3. Get initial state & queue ──
  console.log("\n── 3. Initial state & queue ──");
  const state0 = await call("agent.getState", { sessionId });
  log("State", state0);
  const q0 = await call("agent.getQueue", { sessionId });
  log("Queue", q0);

  // ── 4. Set modes ──
  console.log("\n── 4. Set steering/followUp modes ──");
  log("setSteeringMode(all)", await call("agent.setSteeringMode", { sessionId, mode: "all" }));
  log("setFollowUpMode(one-at-a-time)", await call("agent.setFollowUpMode", { sessionId, mode: "one-at-a-time" }));

  // ── 5. Send a message to start streaming ──
  console.log("\n── 5. Send message (start streaming) ──");
  log("Send", await call("agent.send", { sessionId, content: "Say just the word 'hello'." }));
  await sleep(2000);

  const state1 = await call("agent.getState", { sessionId });
  log("State (streaming?)", state1);

  // ── 6. Steer while streaming ──
  console.log("\n── 6. Steer while streaming ──");
  log("Steer", await call("agent.steer", { sessionId, content: "Now say 'STEERED'." }));
  await sleep(500);
  const q1 = await call("agent.getQueue", { sessionId });
  log("Queue after steer", q1);

  // ── 7. FollowUp while streaming ──
  console.log("\n── 7. FollowUp while streaming ──");
  log("FollowUp", await call("agent.followUp", { sessionId, content: "Then say 'FOLLOWED-UP'." }));
  await sleep(500);
  const q2 = await call("agent.getQueue", { sessionId });
  log("Queue after followUp", q2);

  // ── 8. Clear queue ──
  console.log("\n── 8. ClearQueue ──");
  log("ClearQueue", await call("agent.clearQueue", { sessionId }));
  const q3 = await call("agent.getQueue", { sessionId });
  log("Queue after clear", q3);

  // ── 9. Queue again and wait for delivery ──
  console.log("\n── 9. Queue steer+followUp, wait for events ──");
  log("Steer", await call("agent.steer", { sessionId, content: "Steer message A" }));
  log("FollowUp", await call("agent.followUp", { sessionId, content: "FollowUp message B" }));
  await sleep(500);
  const q4 = await call("agent.getQueue", { sessionId });
  log("Queue (should have items)", q4);

  // Wait for agent to process
  console.log("\n── 10. Waiting 15s for agent to process queue... ──");
  await sleep(15000);

  const q5 = await call("agent.getQueue", { sessionId });
  log("Queue (after processing)", q5);

  // ── Summary ──
  console.log("\n=== queue_update events received ===");
  const queueEvents = events.filter(e => e.payload?.event?.type === "queue_update");
  if (queueEvents.length === 0) {
    console.log("  [!] No queue_update events received!");
  } else {
    queueEvents.forEach((e, i) => {
      console.log(`  [${i}]`, JSON.stringify(e.payload.event, null, 2));
    });
  }

  // ── Final state ──
  console.log("\n── Final state ──");
  const stateFinal = await call("agent.getState", { sessionId });
  log("State", stateFinal);

  ws.close();
  process.exit(0);
}

main().catch((err) => { console.error("[✗]", err); ws?.close(); process.exit(1); });

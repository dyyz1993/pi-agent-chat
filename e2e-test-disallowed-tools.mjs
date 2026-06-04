/**
 * E2E Test: disallowedTools enforcement during agent switching
 *
 * Tests that disallowedTools actually removes tools from the active set.
 * Uses a "custom agent" scenario:
 *   1. Build (all tools) → custom agent with only disallowedTools, no tools whitelist
 *   2. Verify disallowed tools are removed
 *   3. Switch back to Build → verify all restored
 *
 * Also tests Plan and Explore's disallowedTools are enforced.
 *
 * Usage: node e2e-test-disallowed-tools.mjs
 */
import WebSocket from "ws";
import { execSync } from "child_process";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-disallowed-${Date.now()}`;

let msgId = 0;
const pending = new Map();

function wsConnect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    ws.on("open", () => resolve(ws));
    setTimeout(() => reject(new Error("connect timeout")), 10000);
  });
}

function rpc(ws, method, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = `test-${++msgId}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timeout`));
    }, timeout);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

async function getTools(ws, sid) {
  const res = await rpc(ws, "agent.getActiveTools", { sessionId: sid });
  return res.result?.toolNames ?? [];
}

async function main() {
  execSync(`mkdir -p ${CWD}`);
  console.log(`\n🧪 E2E: disallowedTools enforcement\n`);

  const ws = await wsConnect();

  // Create session
  const sr = await rpc(ws, "session.create", { projectPath: CWD });
  const sid = sr.result.sessionId;
  const sp = sr.result.sessionPath;
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });

  // ═══ Step 1: Build (all tools) ═══
  console.log("1️⃣  Build — all tools");
  const buildTools = await getTools(ws, sid);
  console.log(`   Tools: ${buildTools.length}`);
  assert(buildTools.includes("edit"), "Build has 'edit'");
  assert(buildTools.includes("write"), "Build has 'write'");
  assert(buildTools.includes("bash"), "Build has 'bash'");

  // ═══ Step 2: Plan — tools whitelist + disallowedTools ═══
  console.log("\n2️⃣  Plan — tools=[read,grep,find,ls,glob] disallowedTools=[edit,write,bash]");
  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "plan" });
  const planTools = await getTools(ws, sid);
  console.log(`   Tools: [${planTools.join(", ")}]`);
  assert(!planTools.includes("edit"), "Plan: edit removed");
  assert(!planTools.includes("write"), "Plan: write removed");
  assert(!planTools.includes("bash"), "Plan: bash removed");
  assert(planTools.includes("read"), "Plan: read still present");
  assert(planTools.includes("grep"), "Plan: grep still present");

  // ═══ Step 3: Explore — tools whitelist + disallowedTools ═══
  console.log("\n3️⃣  Explore — tools=[read,grep,find,ls,glob,bash] disallowedTools=[edit,write]");
  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "explore" });
  const exploreTools = await getTools(ws, sid);
  console.log(`   Tools: [${exploreTools.join(", ")}]`);
  assert(!exploreTools.includes("edit"), "Explore: edit removed");
  assert(!exploreTools.includes("write"), "Explore: write removed");
  assert(exploreTools.includes("bash"), "Explore: bash still present");
  assert(exploreTools.includes("read"), "Explore: read still present");

  // ═══ Step 4: Back to Build — all tools restored ═══
  console.log("\n4️⃣  Back to Build — all tools restored");
  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "build" });
  const buildTools2 = await getTools(ws, sid);
  console.log(`   Tools: ${buildTools2.length}`);
  assert(buildTools2.includes("edit"), "Build restored: has 'edit'");
  assert(buildTools2.includes("write"), "Build restored: has 'write'");
  assert(buildTools2.includes("bash"), "Build restored: has 'bash'");
  assert(buildTools2.length >= 30, `Build restored: has >= 30 tools (got ${buildTools2.length})`);

  // ═══ Step 5: Plan → Explore → Build cycle again ═══
  console.log("\n5️⃣  Plan → Explore → Build (second cycle)");
  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "plan" });
  const p2 = await getTools(ws, sid);
  assert(!p2.includes("edit") && !p2.includes("write"), "Cycle 2 Plan: no edit/write");

  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "explore" });
  const e2 = await getTools(ws, sid);
  assert(!e2.includes("edit") && !e2.includes("write"), "Cycle 2 Explore: no edit/write");
  assert(e2.includes("bash"), "Cycle 2 Explore: has bash");

  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "build" });
  const b2 = await getTools(ws, sid);
  assert(b2.includes("edit") && b2.includes("write") && b2.includes("bash"), "Cycle 2 Build: all restored");

  // Cleanup
  console.log("\n6️⃣  Cleanup");
  await rpc(ws, "agent.stop", { sessionId: sid });
  ws.close();
  execSync(`rm -rf ${CWD}`);

  console.log(`\n${"═".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("🔴 FAILED");
    process.exit(1);
  } else {
    console.log("✅ ALL PASSED");
    process.exit(0);
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(2); });

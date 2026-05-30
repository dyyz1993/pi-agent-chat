/**
 * E2E Test: Agent Switching (Plan → Build)
 * Verifies that switching from Plan back to Build restores all tools and system prompt.
 *
 * Usage: node e2e-test-agent-switch.mjs
 */
import WebSocket from "ws";
import { execSync } from "child_process";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-agent-switch-${Date.now()}`;

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

async function main() {
  execSync(`mkdir -p ${CWD}`);
  console.log(`\n🧪 E2E Test: Agent Switching (Plan → Build)`);
  console.log(`   Temp dir: ${CWD}\n`);

  const ws = await wsConnect();
  console.log("1️⃣  Connected to WebSocket\n");

  // Step 1: Create session + start agent
  console.log("2️⃣  Creating session + starting agent...");
  const sr = await rpc(ws, "session.create", { projectPath: CWD });
  const sid = sr.result.sessionId;
  const sp = sr.result.sessionPath;
  console.log(`   sessionId: ${sid}`);

  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
  console.log("   Agent started\n");

  // Step 2: Get initial tools + system prompt (should be Build default)
  console.log("3️⃣  Checking initial state (Build default)...");
  const initialTools = await rpc(ws, "agent.getActiveTools", { sessionId: sid });
  const initialToolNames = initialTools.result?.toolNames ?? [];
  console.log(`   Active tools: [${initialToolNames.join(", ")}]`);

  const initialPrompt = await rpc(ws, "agent.getSystemPrompt", { sessionId: sid });
  const initialPromptText = initialPrompt.result?.systemPrompt ?? "";
  const hasBuildPrompt = initialPromptText.includes("expert coding assistant") || initialPromptText.includes("coding assistant");
  console.log(`   System prompt length: ${initialPromptText.length}`);
  console.log(`   Has build-style prompt: ${hasBuildPrompt}`);

  assert(initialToolNames.includes("edit"), "Initial tools include 'edit'");
  assert(initialToolNames.includes("write"), "Initial tools include 'write'");
  assert(initialToolNames.includes("bash"), "Initial tools include 'bash'");
  assert(hasBuildPrompt, "Initial system prompt looks like Build default");
  console.log("");

  // Step 3: Switch to Plan
  console.log("4️⃣  Switching to Plan agent...");
  const switchPlanResult = await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "plan" });
  const planResponseTools = switchPlanResult.result?.tools ?? [];
  console.log(`   switchAgent response tools: [${planResponseTools.join(", ")}]`);

  // Step 4: Verify Plan's tools + system prompt
  console.log("5️⃣  Checking Plan state...");
  const planTools = await rpc(ws, "agent.getActiveTools", { sessionId: sid });
  const planToolNames = planTools.result?.toolNames ?? [];
  console.log(`   Active tools: [${planToolNames.join(", ")}]`);

  const planPrompt = await rpc(ws, "agent.getSystemPrompt", { sessionId: sid });
  const planPromptText = planPrompt.result?.systemPrompt ?? "";
  const hasPlanPrompt = planPromptText.includes("planning specialist") || planPromptText.includes("Planning mode");
  console.log(`   Has plan prompt: ${hasPlanPrompt}`);

  assert(!planToolNames.includes("edit"), "Plan does NOT have 'edit'");
  assert(!planToolNames.includes("write"), "Plan does NOT have 'write'");
  assert(!planToolNames.includes("bash"), "Plan does NOT have 'bash'");
  assert(planToolNames.includes("read"), "Plan has 'read'");
  assert(planToolNames.includes("grep"), "Plan has 'grep'");
  assert(hasPlanPrompt, "Plan system prompt contains 'planning specialist'");
  console.log("");

  // Step 5: Switch back to Build
  console.log("6️⃣  Switching back to Build agent...");
  const switchBuildResult = await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "build" });
  const buildResponseTools = switchBuildResult.result?.tools ?? [];
  console.log(`   switchAgent response tools: [${buildResponseTools.join(", ")}]`);

  // Step 6: Verify Build's tools + system prompt (THE BUG)
  console.log("7️⃣  Checking Build state after switch-back...");
  const buildTools = await rpc(ws, "agent.getActiveTools", { sessionId: sid });
  const buildToolNames = buildTools.result?.toolNames ?? [];
  console.log(`   Active tools: [${buildToolNames.join(", ")}]`);

  const buildPrompt = await rpc(ws, "agent.getSystemPrompt", { sessionId: sid });
  const buildPromptText = buildPrompt.result?.systemPrompt ?? "";
  const buildHasDefaultPrompt = buildPromptText.includes("expert coding assistant") || buildPromptText.includes("coding assistant");
  const buildStillHasPlanPrompt = buildPromptText.includes("planning specialist");
  console.log(`   System prompt length: ${buildPromptText.length}`);
  console.log(`   Has build-style prompt: ${buildHasDefaultPrompt}`);
  console.log(`   Still has plan prompt: ${buildStillHasPlanPrompt}`);

  // These are the BUG assertions
  assert(buildToolNames.includes("edit"), "🔴 BUG: Build has 'edit' after switch-back");
  assert(buildToolNames.includes("write"), "🔴 BUG: Build has 'write' after switch-back");
  assert(buildToolNames.includes("bash"), "🔴 BUG: Build has 'bash' after switch-back");
  assert(buildHasDefaultPrompt, "🔴 BUG: Build has default system prompt after switch-back");
  assert(!buildStillHasPlanPrompt, "🔴 BUG: Build does NOT still have Plan's prompt");

  // Also check the RPC response bug
  assert(buildResponseTools.length > 0, "🔴 BUG: switchAgent response shows tools for Build (not empty)");

  console.log("");

  // Cleanup
  console.log("8️⃣  Cleaning up...");
  await rpc(ws, "agent.stop", { sessionId: sid });
  ws.close();
  execSync(`rm -rf ${CWD}`);
  console.log("   Done\n");

  // Summary
  console.log("═".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("🔴 BUG CONFIRMED: applyAgentConfig does not restore tools/prompt for Build");
    process.exit(1);
  } else {
    console.log("✅ All checks passed — bug has been fixed");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});

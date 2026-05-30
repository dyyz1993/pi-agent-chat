/**
 * E2E Test: Agent Switching with Chat — full lifecycle
 * Follows the same RPC pattern as e2e-test-rollback-diff.mjs
 *
 * Flow: Build(chat) → Plan(chat) → Build(chat) → Explore → Build(chat)
 * Each chat step: send → poll messages until count grows → check response
 *
 * Usage: node e2e-test-agent-switch-chat.mjs
 */
import WebSocket from "ws";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-agent-chat-${Date.now()}`;

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

/** Poll getFullMessages until count >= minCount */
async function waitForMessages(ws, sid, sp, minCount, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const msgs = res.result?.messages || [];
    if (msgs.length >= minCount) return msgs;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`waitForMessages timeout: expected >= ${minCount}`);
}

/** Get current message count */
async function getMsgCount(ws, sid, sp) {
  const res = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
  return res.result?.messages?.length ?? 0;
}

/** Extract text from message content */
function extractText(msg) {
  const content = msg?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/** Check if message contains tool calls */
function extractToolNames(msg) {
  const content = msg?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b.type === "toolCall" || b.type === "tool_execution")
    .map((b) => b.toolName || b.name || b.type);
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
  console.log(`\n🧪 E2E: Agent Switching with Chat Lifecycle`);
  console.log(`   Dir: ${CWD}\n`);

  const ws = await wsConnect();

  // ─── Create session ───
  console.log("═══════════════════════════════════════════════════");
  console.log("1️⃣  CREATE + START SESSION");
  console.log("═══════════════════════════════════════════════════");
  const sr = await rpc(ws, "session.create", { projectPath: CWD });
  const sid = sr.result.sessionId;
  const sp = sr.result.sessionPath;
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
  console.log(`  sessionId: ${sid}\n`);

  let prevCount = 0;

  // ═══════════════════════════════════════════════════
  // STEP 2: BUILD — create a file
  // ═══════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("2️⃣  BUILD MODE — create file");
  console.log("═══════════════════════════════════════════════════");

  // Check tools before chat
  const tools1 = await rpc(ws, "agent.getActiveTools", { sessionId: sid });
  const t1 = tools1.result?.toolNames ?? [];
  console.log(`  Active tools: ${t1.length} [${t1.slice(0, 6).join(", ")}...]`);
  assert(t1.includes("write"), "Build initial: has 'write'");
  assert(t1.includes("edit"), "Build initial: has 'edit'");
  assert(t1.includes("bash"), "Build initial: has 'bash'");

  // Check prompt
  const prompt1 = await rpc(ws, "agent.getSystemPrompt", { sessionId: sid });
  const p1 = prompt1.result?.systemPrompt ?? "";
  assert(p1.includes("coding assistant"), "Build initial: prompt has 'coding assistant'");

  // Send message
  console.log(`  Sending: "用 write 工具创建 test-build.txt，内容 Hello from Build"`);
  await rpc(ws, "agent.send", { sessionId: sid, content: "用 write 工具创建 test-build.txt，内容写 Hello from Build" });
  prevCount = await getMsgCount(ws, sid, sp);
  const msgs2 = await waitForMessages(ws, sid, sp, prevCount + 1, 120000);
  const lastMsg2 = msgs2[msgs2.length - 1];
  const text2 = extractText(lastMsg2);
  console.log(`  Response: ${text2.substring(0, 150)}`);
  prevCount = msgs2.length;

  // Verify file
  const fc1 = await rpc(ws, "file.readFile", { path: `${CWD}/test-build.txt` });
  const f1 = fc1.result?.content ?? "";
  assert(f1.includes("Hello from Build"), "Build: test-build.txt created correctly");
  console.log(`  File: ${f1}\n`);

  // ═══════════════════════════════════════════════════
  // STEP 3: PLAN — read only, no write
  // ═══════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("3️⃣  SWITCH TO PLAN — analyze only");
  console.log("═══════════════════════════════════════════════════");

  const swPlan = await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "plan" });
  console.log(`  switchAgent response tools: [${swPlan.result?.tools?.join(", ")}]`);

  const tools3 = await rpc(ws, "agent.getActiveTools", { sessionId: sid });
  const t3 = tools3.result?.toolNames ?? [];
  console.log(`  Active tools: [${t3.join(", ")}]`);
  assert(!t3.includes("write"), "Plan: does NOT have 'write'");
  assert(!t3.includes("edit"), "Plan: does NOT have 'edit'");
  assert(!t3.includes("bash"), "Plan: does NOT have 'bash'");
  assert(t3.includes("read"), "Plan: has 'read'");

  const prompt3 = await rpc(ws, "agent.getSystemPrompt", { sessionId: sid });
  const p3 = prompt3.result?.systemPrompt ?? "";
  assert(p3.includes("planning specialist"), "Plan: prompt has 'planning specialist'");

  // Chat in Plan — ask to read the file (Plan can read)
  console.log(`  Sending: "读取 test-build.txt 的内容并分析"`);
  await rpc(ws, "agent.send", { sessionId: sid, content: "请读取 test-build.txt 的内容，然后分析一下这个文件" });
  const msgs3 = await waitForMessages(ws, sid, sp, prevCount + 1, 120000);
  const lastMsg3 = msgs3[msgs3.length - 1];
  const text3 = extractText(lastMsg3);
  console.log(`  Response: ${text3.substring(0, 200)}`);
  assert(text3.length > 10, "Plan: got a response");
  // Plan should NOT have tried to create/modify files
  prevCount = msgs3.length;
  console.log("");

  // ═══════════════════════════════════════════════════
  // STEP 4: BUILD again — edit the file
  // ═══════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("4️⃣  SWITCH BACK TO BUILD — edit file");
  console.log("═══════════════════════════════════════════════════");

  const swBuild2 = await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "build" });
  console.log(`  switchAgent: ${swBuild2.result?.tools?.length ?? 0} tools`);

  const tools4 = await rpc(ws, "agent.getActiveTools", { sessionId: sid });
  const t4 = tools4.result?.toolNames ?? [];
  console.log(`  Active tools: ${t4.length} [${t4.slice(0, 6).join(", ")}...]`);
  assert(t4.includes("write"), "Build after Plan: has 'write'");
  assert(t4.includes("edit"), "Build after Plan: has 'edit'");
  assert(t4.includes("bash"), "Build after Plan: has 'bash'");

  const prompt4 = await rpc(ws, "agent.getSystemPrompt", { sessionId: sid });
  const p4 = prompt4.result?.systemPrompt ?? "";
  assert(p4.includes("coding assistant"), "Build after Plan: prompt has 'coding assistant'");
  assert(!p4.includes("planning specialist"), "Build after Plan: prompt does NOT have 'planning specialist'");

  // Chat — edit the file
  console.log(`  Sending: "用 edit 工具修改 test-build.txt，追加一行 Modified after Plan"`);
  await rpc(ws, "agent.send", { sessionId: sid, content: "用 edit 工具修改 test-build.txt，在文件末尾追加一行内容：Modified after Plan" });
  const msgs4 = await waitForMessages(ws, sid, sp, prevCount + 1, 120000);
  const lastMsg4 = msgs4[msgs4.length - 1];
  const text4 = extractText(lastMsg4);
  console.log(`  Response: ${text4.substring(0, 150)}`);
  prevCount = msgs4.length;

  // Verify file was modified
  const fc2 = await rpc(ws, "file.readFile", { path: `${CWD}/test-build.txt` });
  const f2 = fc2.result?.content ?? "";
  assert(
    f2.includes("Hello from Build") && f2.includes("Modified after Plan"),
    "Build after Plan: file was modified (has both old and new content)"
  );
  console.log(`  File: ${f2}\n`);

  // ═══════════════════════════════════════════════════
  // STEP 5: EXPLORE — read only
  // ═══════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("5️⃣  SWITCH TO EXPLORE — read only");
  console.log("═══════════════════════════════════════════════════");

  const swExplore = await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "explore" });
  console.log(`  switchAgent response tools: [${swExplore.result?.tools?.join(", ")}]`);

  const tools5 = await rpc(ws, "agent.getActiveTools", { sessionId: sid });
  const t5 = tools5.result?.toolNames ?? [];
  assert(!t5.includes("write"), "Explore: does NOT have 'write'");
  assert(!t5.includes("edit"), "Explore: does NOT have 'edit'");
  assert(t5.includes("read"), "Explore: has 'read'");
  assert(t5.includes("bash"), "Explore: has 'bash'");

  const prompt5 = await rpc(ws, "agent.getSystemPrompt", { sessionId: sid });
  const p5 = prompt5.result?.systemPrompt ?? "";
  assert(p5.includes("exploration specialist"), "Explore: prompt has 'exploration specialist'");
  console.log("");

  // ═══════════════════════════════════════════════════
  // STEP 6: BUILD final — create another file
  // ═══════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("6️⃣  SWITCH BACK TO BUILD (final) — create file");
  console.log("═══════════════════════════════════════════════════");

  const swBuild3 = await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "build" });
  console.log(`  switchAgent: ${swBuild3.result?.tools?.length ?? 0} tools`);

  const tools6 = await rpc(ws, "agent.getActiveTools", { sessionId: sid });
  const t6 = tools6.result?.toolNames ?? [];
  assert(t6.includes("write"), "Build final: has 'write'");
  assert(t6.includes("edit"), "Build final: has 'edit'");
  assert(t6.includes("bash"), "Build final: has 'bash'");

  const prompt6 = await rpc(ws, "agent.getSystemPrompt", { sessionId: sid });
  const p6 = prompt6.result?.systemPrompt ?? "";
  assert(p6.includes("coding assistant"), "Build final: prompt has 'coding assistant'");
  assert(!p6.includes("exploration specialist"), "Build final: prompt does NOT have 'exploration specialist'");
  assert(!p6.includes("planning specialist"), "Build final: prompt does NOT have 'planning specialist'");

  // Chat — create another file
  console.log(`  Sending: "用 write 创建 final.txt，内容 Tools fully restored"`);
  await rpc(ws, "agent.send", { sessionId: sid, content: "用 write 工具创建文件 final.txt，内容写 Tools fully restored" });
  const msgs6 = await waitForMessages(ws, sid, sp, prevCount + 1, 120000);
  const lastMsg6 = msgs6[msgs6.length - 1];
  const text6 = extractText(lastMsg6);
  console.log(`  Response: ${text6.substring(0, 150)}`);

  const fc3 = await rpc(ws, "file.readFile", { path: `${CWD}/final.txt` });
  const f3 = fc3.result?.content ?? "";
  assert(f3.includes("Tools fully restored"), "Build final: final.txt created correctly");
  console.log(`  File: ${f3}\n`);

  // ═══════════════════════════════════════════════════
  // STEP 7: Verify JSONL agent_change entries
  // ═══════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("7️⃣  VERIFY JSONL agent_change ENTRIES");
  console.log("═══════════════════════════════════════════════════");

  const jsonl = readFileSync(sp, "utf-8");
  const agentChanges = jsonl
    .trim()
    .split("\n")
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter((e) => e?.type === "agent_change");

  console.log(`  agent_change entries: ${agentChanges.length}`);
  for (const entry of agentChanges) {
    console.log(`    → ${entry.agentName} (tools: ${entry.agentConfig?.tools?.join(",") ?? "ALL"})`);
  }

  assert(agentChanges.length >= 4, `JSONL: has >= 4 agent_change entries (got ${agentChanges.length})`);
  assert(agentChanges[agentChanges.length - 1].agentName === "build", "JSONL: last agent_change is 'build'");
  console.log("");

  // ─── Cleanup ───
  console.log("═══════════════════════════════════════════════════");
  console.log("8️⃣  CLEANUP");
  console.log("═══════════════════════════════════════════════════");
  await rpc(ws, "agent.stop", { sessionId: sid });
  ws.close();
  execSync(`rm -rf ${CWD}`);
  console.log("  Done\n");

  // ─── Summary ───
  console.log("═══════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════");
  if (failed > 0) {
    console.log("🔴 SOME CHECKS FAILED");
    process.exit(1);
  } else {
    console.log("✅ ALL PASSED — agent switching works with chat lifecycle");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});

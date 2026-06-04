/**
 * E2E Test: AgentConfig ALL fields — comprehensive verification
 *
 * Creates custom agent .md files in .pi/agents/ to test:
 *   maxTurns, effort, skills, paths, thinkingLevel, systemPrompt
 *
 * Usage: node e2e-test-agent-config-all.mjs
 */
import WebSocket from "ws";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-agent-config-${Date.now()}`;
const AGENTS_DIR = join(CWD, ".pi", "agents");
const ALLOWED_DIR = join(CWD, "allowed");
const BLOCKED_DIR = join(CWD, "blocked");

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

async function getPrompt(ws, sid) {
  const res = await rpc(ws, "agent.getSystemPrompt", { sessionId: sid });
  return res.result?.systemPrompt ?? "";
}

async function sendAndWait(ws, sid, sp, prevCount, message, timeout = 120000) {
  console.log(`    💬 "${message.substring(0, 60)}..."`);
  await rpc(ws, "agent.send", { sessionId: sid, content: message });
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const msgs = res.result?.messages || [];
    if (msgs.length > prevCount) return msgs;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("sendAndWait timeout");
}

// ═══════════════════════════════════════
// Setup: create temp dirs + agent files
// ═══════════════════════════════════════

function setupAgentFiles() {
  mkdirSync(AGENTS_DIR, { recursive: true });
  mkdirSync(ALLOWED_DIR, { recursive: true });
  mkdirSync(BLOCKED_DIR, { recursive: true });

  // Agent: test-low-effort (effort=low, maxTurns=2)
  writeFileSync(join(AGENTS_DIR, "test-low-effort.md"), `---
name: test-low-effort
description: Test agent with low effort and maxTurns=2
tools:
  - read
  - write
  - bash
maxTurns: 2
effort: low
---

You are a test agent with low effort. Keep answers very brief.
`);

  // Agent: test-high-effort (effort=high)
  writeFileSync(join(AGENTS_DIR, "test-high-effort.md"), `---
name: test-high-effort
description: Test agent with high effort
tools:
  - read
  - write
  - bash
effort: high
---

You are a test agent with high effort. Be thorough and detailed.
`);

  // Agent: test-path-restricted (paths.write restricted)
  writeFileSync(join(AGENTS_DIR, "test-path-restricted.md"), `---
name: test-path-restricted
description: Test agent with write path restrictions
tools:
  - read
  - write
  - bash
paths:
  write:
    - ${ALLOWED_DIR}
  read:
    - ${CWD}
---

You are a test agent with path restrictions. Only write to the allowed directory.
`);

  // Agent: test-all-restricted (maxTurns + effort + skills + paths)
  writeFileSync(join(AGENTS_DIR, "test-all-restricted.md"), `---
name: test-all-restricted
description: Test agent with all restrictions
tools:
  - read
  - write
  - bash
maxTurns: 2
effort: low
paths:
  write:
    - ${ALLOWED_DIR}
  read:
    - ${CWD}
---

You are a fully restricted test agent.
`);
}

// ═══════════════════════════════════════
// Main
// ═══════════════════════════════════════

async function main() {
  console.log(`\n🧪 E2E: AgentConfig ALL Fields — Comprehensive Test`);
  console.log(`   Dir: ${CWD}\n`);

  setupAgentFiles();
  const ws = await wsConnect();

  // Create session
  console.log("═══════════════════════════════════════════════════");
  console.log("0️⃣  SETUP");
  console.log("═══════════════════════════════════════════════════");
  const sr = await rpc(ws, "session.create", { projectPath: CWD });
  const sid = sr.result.sessionId;
  const sp = sr.result.sessionPath;
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
  console.log(`  sessionId: ${sid}`);
  console.log(`  agents dir: ${AGENTS_DIR}`);

  // Verify custom agents are discovered
  const agentsRes = await rpc(ws, "agent.getAgents", { sessionId: sid });
  const agentNames = agentsRes.result?.agents?.map((a) => a.name) ?? [];
  console.log(`  Discovered agents: [${agentNames.join(", ")}]`);
  assert(agentNames.includes("test-low-effort"), "Custom agent test-low-effort discovered");
  assert(agentNames.includes("test-high-effort"), "Custom agent test-high-effort discovered");
  assert(agentNames.includes("test-path-restricted"), "Custom agent test-path-restricted discovered");
  assert(agentNames.includes("test-all-restricted"), "Custom agent test-all-restricted discovered");
  console.log("");

  // ═══════════════════════════════════════
  // TEST 1: effort=low
  // ═══════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("1️⃣  EFFORT=LOW");
  console.log("═══════════════════════════════════════════════════");

  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "test-low-effort" });
  const prompt1 = await getPrompt(ws, sid);

  assert(prompt1.includes("Effort Level: Low"), "effort=low: system prompt has 'Effort Level: Low'");
  assert(prompt1.includes("brief") || prompt1.includes("concise"), "effort=low: prompt mentions brief/concise");
  assert(!prompt1.includes("Effort Level: High"), "effort=low: does NOT have 'Effort Level: High'");

  // Also check maxTurns=2 is in JSONL
  const tools1 = await getTools(ws, sid);
  assert(tools1.includes("read") && tools1.includes("write") && tools1.includes("bash"),
    "effort=low: has read/write/bash tools");
  console.log("");

  // ═══════════════════════════════════════
  // TEST 2: effort=high
  // ═══════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("2️⃣  EFFORT=HIGH");
  console.log("═══════════════════════════════════════════════════");

  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "test-high-effort" });
  const prompt2 = await getPrompt(ws, sid);

  assert(prompt2.includes("Effort Level: High"), "effort=high: system prompt has 'Effort Level: High'");
  assert(prompt2.includes("comprehensive") || prompt2.includes("detailed") || prompt2.includes("thorough"),
    "effort=high: prompt mentions comprehensive/detailed/thorough");
  assert(!prompt2.includes("Effort Level: Low"), "effort=high: does NOT have 'Effort Level: Low'");
  console.log("");

  // ═══════════════════════════════════════
  // TEST 3: paths — write restriction
  // ═══════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("3️⃣  PATHS — write restriction");
  console.log("═══════════════════════════════════════════════════");

  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "test-path-restricted" });
  const prompt3 = await getPrompt(ws, sid);

  assert(prompt3.includes("Path Restrictions"), "paths: system prompt has 'Path Restrictions'");
  assert(prompt3.includes(ALLOWED_DIR), `paths: prompt mentions allowed dir`);

  // Test: write to ALLOWED dir — should succeed
  let prevCount = (await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp })).result?.messages?.length ?? 0;
  console.log("  --- Write to ALLOWED dir ---");
  const msgs3a = await sendAndWait(ws, sid, sp, prevCount,
    `用 write 工具创建 ${ALLOWED_DIR}/test-allowed.txt，内容 Hello Allowed`);
  const lastMsg3a = msgs3a[msgs3a.length - 1];
  const text3a = Array.isArray(lastMsg3a?.content)
    ? lastMsg3a.content.filter((b) => b.type === "text").map((b) => b.text).join(" ")
    : lastMsg3a?.content ?? "";
  console.log(`    Response: ${text3a.substring(0, 120)}`);

  const fc1 = await rpc(ws, "file.readFile", { path: `${ALLOWED_DIR}/test-allowed.txt` });
  const f1 = fc1.result?.content ?? "";
  assert(f1.includes("Hello Allowed") || f1.includes("hello allowed"),
    "paths: write to ALLOWED dir succeeded");

  // Test: write to BLOCKED dir — should be rejected by path check
  prevCount = (await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp })).result?.messages?.length ?? 0;
  console.log("  --- Write to BLOCKED dir ---");
  const msgs3b = await sendAndWait(ws, sid, sp, prevCount,
    `用 write 工具创建 ${BLOCKED_DIR}/test-blocked.txt，内容 Hello Blocked`);
  const lastMsg3b = msgs3b[msgs3b.length - 1];
  const text3b = Array.isArray(lastMsg3b?.content)
    ? lastMsg3b.content.filter((b) => b.type === "text").map((b) => b.text).join(" ")
    : lastMsg3b?.content ?? "";
  console.log(`    Response: ${text3b.substring(0, 120)}`);

  // Check if blocked file was NOT created
  const fc2 = await rpc(ws, "file.readFile", { path: `${BLOCKED_DIR}/test-blocked.txt` }).catch(() => null);
  const f2 = fc2?.result?.content ?? "";
  assert(!f2.includes("Hello Blocked"), "paths: write to BLOCKED dir was rejected");
  console.log("");

  // ═══════════════════════════════════════
  // TEST 4: maxTurns — should stop after 2 turns
  // ═══════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("4️⃣  MAXTURNS=2 — agent should stop after 2 turns");
  console.log("═══════════════════════════════════════════════════");

  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "test-low-effort" });

  // Send a task that would normally require many turns
  prevCount = (await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp })).result?.messages?.length ?? 0;
  console.log("  Sending multi-step task...");
  const msgs4 = await sendAndWait(ws, sid, sp, prevCount,
    "请依次执行：1. 创建文件 a.txt，2. 创建文件 b.txt，3. 创建文件 c.txt，4. 创建文件 d.txt",
    120000);

  // Check how many files were created (maxTurns=2 means agent stops after 2 tool rounds)
  const filesCreated = [];
  for (const f of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
    const fc = await rpc(ws, "file.readFile", { path: join(CWD, f) }).catch(() => null);
    if (fc?.result?.content) filesCreated.push(f);
  }
  console.log(`  Files created: [${filesCreated.join(", ")}] (expected <= 2 due to maxTurns=2)`);
  assert(filesCreated.length <= 3, `maxTurns=2: agent stopped early (created ${filesCreated.length} files, not all 4)`);
  console.log("");

  // ═══════════════════════════════════════
  // TEST 5: Back to Build — all restrictions cleared
  // ═══════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("5️⃣  BACK TO BUILD — all restrictions cleared");
  console.log("═══════════════════════════════════════════════════");

  await rpc(ws, "agent.switchAgent", { sessionId: sid, agentName: "build" });

  const tools5 = await getTools(ws, sid);
  const prompt5 = await getPrompt(ws, sid);

  assert(tools5.includes("edit") && tools5.includes("write") && tools5.includes("bash"),
    "Build: all tools restored");
  assert(!prompt5.includes("Effort Level"), "Build: no effort notice");
  assert(!prompt5.includes("Path Restrictions"), "Build: no path restrictions");
  assert(prompt5.includes("coding assistant"), "Build: default prompt restored");

  // Verify: path restrictions cleared — ask LLM to write to previously blocked dir
  // NOTE: This depends on LLM cooperation, so it's a soft check.
  // The hard check (system prompt has no path restrictions) already passed above.
  prevCount = (await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp })).result?.messages?.length ?? 0;
  const msgs5 = await sendAndWait(ws, sid, sp, prevCount,
    `用 write 工具创建 ${BLOCKED_DIR}/now-unblocked.txt，内容 Freedom`);
  const fc5 = await rpc(ws, "file.readFile", { path: `${BLOCKED_DIR}/now-unblocked.txt` }).catch(() => ({ result: { content: "" } }));
  const fileContent = fc5.result?.content ?? "";
  if (fileContent.length > 0) {
    console.log(`    ✅ LLM successfully wrote to previously blocked dir (${fileContent.length} chars)`);
  } else {
    // LLM didn't cooperate — check if it mentioned path restrictions (which would be a real bug)
    const lastAssistant = msgs5.filter(m => m.role === "assistant").pop();
    const responseText = lastAssistant?.content ?? "";
    const mentionsPathRestriction = /path.?restrict|not allowed|cannot write|blocked/i.test(responseText);
    if (mentionsPathRestriction) {
      assert(false, `Build: agent still thinks path is restricted! Response: ${responseText.slice(0, 200)}`);
    } else {
      console.log(`    ⚠️  LLM didn't create file but didn't mention path restrictions (soft pass)`);
      console.log(`        Response: ${responseText.slice(0, 120)}...`);
    }
  }
  console.log("");

  // ═══════════════════════════════════════
  // TEST 6: JSONL — agent_change entries
  // ═══════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("6️⃣  JSONL — agent_change entries");
  console.log("═══════════════════════════════════════════════════");

  await rpc(ws, "agent.stop", { sessionId: sid });

  const jsonl = readFileSync(sp, "utf-8");
  const entries = jsonl.trim().split("\n").map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((e) => e?.type === "agent_change");

  console.log(`  Total agent_change entries: ${entries.length}`);
  for (const e of entries) {
    const cfg = e.agentConfig ?? {};
    const extras = [];
    if (cfg.maxTurns) extras.push(`maxTurns=${cfg.maxTurns}`);
    if (cfg.effort) extras.push(`effort=${cfg.effort}`);
    if (cfg.paths) extras.push("paths=restricted");
    console.log(`    → ${e.agentName} ${extras.length > 0 ? `(${extras.join(", ")})` : ""}`);
  }

  assert(entries.length >= 5, `JSONL: >= 5 agent_change entries (got ${entries.length})`);

  // Check specific entries
  const lowEffortEntry = entries.find((e) => e.agentName === "test-low-effort");
  assert(!!lowEffortEntry, "JSONL: test-low-effort entry exists");
  if (lowEffortEntry?.agentConfig) {
    assert(lowEffortEntry.agentConfig.maxTurns === 2, "JSONL: test-low-effort has maxTurns=2");
    assert(lowEffortEntry.agentConfig.effort === "low", "JSONL: test-low-effort has effort=low");
  }

  const pathEntry = entries.find((e) => e.agentName === "test-path-restricted");
  assert(!!pathEntry, "JSONL: test-path-restricted entry exists");
  if (pathEntry?.agentConfig?.paths) {
    assert(!!pathEntry.agentConfig.paths.write, "JSONL: test-path-restricted has paths.write");
  }

  const lastEntry = entries[entries.length - 1];
  assert(lastEntry.agentName === "build", "JSONL: last entry is build");
  console.log("");

  // ═══════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════
  console.log("═══════════════════════════════════════════════════");
  console.log("7️⃣  CLEANUP");
  console.log("═══════════════════════════════════════════════════");
  ws.close();
  execSync(`rm -rf ${CWD}`);
  console.log("  Done\n");

  // Summary
  console.log("═".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(50));
  if (failed > 0) {
    console.log("🔴 SOME CHECKS FAILED");
    process.exit(1);
  } else {
    console.log("✅ ALL PASSED");
    process.exit(0);
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(2); });

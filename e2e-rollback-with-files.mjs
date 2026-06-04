/**
 * E2E 验证：回滚消息 + 文件恢复
 * 
 * Case 1: 创建 A1 → 创建 V1 → 回滚 V1（带文件）→ V1 消失，A1 还在
 * Case 2: 回滚 A1（带文件）→ A1 也消失，全部清空
 */
import WebSocket from "ws";
import { execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-rollback-files-${Date.now()}`;
execSync(`mkdir -p ${CWD}`);

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
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

async function waitForMessages(ws, sid, sp, minCount, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const msgs = res.result?.messages || [];
    if (msgs.length >= minCount) return res.result;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`timeout: expected >= ${minCount} messages`);
}

function readFile(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function fileExists(path) {
  return existsSync(path);
}

function print(label, result) {
  const msgs = result?.messages || [];
  const customs = result?.customEntries || [];
  console.log(`\n=== ${label} ===`);
  console.log(`Messages (${msgs.length}):`);
  for (const m of msgs) {
    const role = m.role;
    const content = typeof m.content === "string" ? content.slice(0, 80) : `[${m.content?.length || 0} blocks]`;
    console.log(`  [${role}]`);
  }
  console.log(`Custom Entries (${customs.length}): ${customs.map(c => c.customType).join(", ")}`);
}

async function main() {
  console.log("=== E2E: 回滚消息 + 文件恢复 验证 ===\n");
  console.log(`项目目录: ${CWD}\n`);

  const ws = await wsConnect();
  console.log("✅ WebSocket 连接成功\n");

  const a1Path = join(CWD, "A1.txt");
  const v1Path = join(CWD, "V1.txt");

  // ==================== Step 1: 创建会话 ====================
  const sr = await rpc(ws, "session.create", { projectPath: CWD });
  const sid = sr.result.sessionId;
  const sp = sr.result.sessionPath;
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
  console.log("✅ 会话创建 + Agent 启动成功\n");

  // ==================== Step 2: 创建 A1.txt ====================
  console.log("📌 Step 2: 让 Agent 创建 A1.txt（内容 'hello from A1'）");
  await rpc(ws, "agent.send", { sessionId: sid, content: "帮我创建一个文件 A1.txt，内容写 hello from A1" });
  await waitForMessages(ws, sid, sp, 2);
  await new Promise(r => setTimeout(r, 8000)); // 等文件写入完成

  const resultA = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
  const msgsAfterA = resultA.result?.messages?.length || 0;
  console.log(`  消息数: ${msgsAfterA}`);
  console.log(`  A1.txt 存在: ${fileExists(a1Path)} ${fileExists(a1Path) ? `内容="${readFile(a1Path)?.trim()}"` : ""}`);

  if (!fileExists(a1Path)) {
    console.log("  ⚠️ A1.txt 还没创建，可能 Agent 还在处理...");
    await new Promise(r => setTimeout(r, 10000));
    console.log(`  A1.txt 存在: ${fileExists(a1Path)} ${fileExists(a1Path) ? `内容="${readFile(a1Path)?.trim()}"` : ""}`);
  }

  // ==================== Step 3: 创建 V1.txt ====================
  console.log("\n📌 Step 3: 让 Agent 创建 V1.txt（内容 'world from V1'）");
  await rpc(ws, "agent.send", { sessionId: sid, content: "帮我创建一个文件 V1.txt，内容写 world from V1" });
  await waitForMessages(ws, sid, sp, msgsAfterA + 2);
  await new Promise(r => setTimeout(r, 8000));

  const resultB = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
  const msgsAfterB = resultB.result?.messages?.length || 0;
  console.log(`  消息数: ${msgsAfterB}`);
  console.log(`  A1.txt 存在: ${fileExists(a1Path)} 内容="${readFile(a1Path)?.trim()}"`);
  console.log(`  V1.txt 存在: ${fileExists(v1Path)} ${fileExists(v1Path) ? `内容="${readFile(v1Path)?.trim()}"` : ""}`);

  if (!fileExists(v1Path)) {
    console.log("  ⚠️ V1.txt 还没创建，可能 Agent 还在处理...");
    await new Promise(r => setTimeout(r, 10000));
    console.log(`  V1.txt 存在: ${fileExists(v1Path)} ${fileExists(v1Path) ? `内容="${readFile(v1Path)?.trim()}"` : ""}`);
  }

  // ==================== Step 4: 停止 Agent，找 B 的 user message ====================
  console.log("\n📌 Step 4: 停止 Agent，准备回滚 V1（带文件恢复）");
  await rpc(ws, "agent.stop", { sessionId: sid });

  const jsonl = readFileSync(sp, "utf-8").trim().split("\n");
  const entries = jsonl.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const messageEntries = entries.filter(e => e.type === "message");
  const userMessages = messageEntries.filter(e => e.message?.role === "user");

  if (userMessages.length < 2) {
    console.error(`❌ 只找到 ${userMessages.length} 个 user message，需要至少 2 个`);
    ws.close();
    return;
  }

  const bUserMsg = userMessages[userMessages.length - 1]; // 最后一个 user message = B
  console.log(`  B 的 user message id: ${bUserMsg.id.slice(0, 16)}...`);
  console.log(`  内容: "${(typeof bUserMsg.message?.content === "string" ? bUserMsg.message.content : "[blocks]").slice(0, 60)}"`);

  // ==================== Step 5: 回滚 B（带文件恢复，skipFiles=false）====================
  console.log("\n📌 Step 5: 回滚 V1（消息 + 文件）...");
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
  
  const rollbackResult = await rpc(ws, "agent.navigateTree", {
    sessionId: sid,
    targetId: bUserMsg.id,
    summarize: false,
    skipFiles: false, // ← 关键：带文件恢复
  }, 60000);
  console.log(`  回滚结果: cancelled=${rollbackResult.result?.cancelled}`);
  await new Promise(r => setTimeout(r, 3000)); // 等文件恢复完成

  // ==================== Step 6: 验证回滚 V1 后的状态 ====================
  console.log("\n📌 Step 6: 验证回滚 V1 后的状态");

  const resultRollback1 = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
  const msgsAfterRollback1 = resultRollback1.result?.messages?.length || 0;
  console.log(`  消息数: ${msgsAfterRollback1}（回滚前 ${msgsAfterB}）`);

  const a1ExistsAfterV1Rollback = fileExists(a1Path);
  const v1ExistsAfterV1Rollback = fileExists(v1Path);
  const a1ContentAfterV1Rollback = readFile(a1Path)?.trim();

  console.log(`  A1.txt 存在: ${a1ExistsAfterV1Rollback} ${a1ExistsAfterV1Rollback ? `内容="${a1ContentAfterV1Rollback}"` : ""}`);
  console.log(`  V1.txt 存在: ${v1ExistsAfterV1Rollback} ${v1ExistsAfterV1Rollback ? `内容="${readFile(v1Path)?.trim()}"` : ""}`);

  let pass = true;

  // 验证消息数减少
  if (msgsAfterRollback1 < msgsAfterB) {
    console.log(`  ✅ 消息数减少: ${msgsAfterB} → ${msgsAfterRollback1}`);
  } else {
    console.log(`  ❌ 消息数未减少: ${msgsAfterB} → ${msgsAfterRollback1}`);
    pass = false;
  }

  // 验证 A1.txt 还在且内容正确
  if (a1ExistsAfterV1Rollback && a1ContentAfterV1Rollback?.includes("hello from A1")) {
    console.log(`  ✅ A1.txt 保留，内容正确: "${a1ContentAfterV1Rollback}"`);
  } else if (a1ExistsAfterV1Rollback) {
    console.log(`  ⚠️ A1.txt 保留但内容变了: "${a1ContentAfterV1Rollback}"（可能 Agent 写的内容不完全匹配）`);
  } else {
    console.log(`  ❌ A1.txt 不应该被删除！`);
    pass = false;
  }

  // 验证 V1.txt 被删除（恢复）
  if (!v1ExistsAfterV1Rollback) {
    console.log(`  ✅ V1.txt 已被恢复（删除）`);
  } else {
    console.log(`  ❌ V1.txt 应该被恢复（删除）但还是存在！内容: "${readFile(v1Path)?.trim()}"`);
    pass = false;
  }

  // ==================== Step 7: 回滚后发消息 C 验证能继续 ====================
  console.log("\n📌 Step 7: 回滚后发消息 C: '谢谢'");
  await rpc(ws, "agent.send", { sessionId: sid, content: "谢谢" });
  const resultC = await waitForMessages(ws, sid, sp, msgsAfterRollback1 + 2, 60000);
  const msgsAfterC = resultC.messages?.length || 0;
  if (msgsAfterC > msgsAfterRollback1) {
    console.log(`  ✅ 回滚后能继续对话: ${msgsAfterRollback1} → ${msgsAfterC}`);
  } else {
    console.log(`  ❌ 回滚后无法继续对话`);
    pass = false;
  }

  // ==================== Step 8: 回滚 A（带文件恢复）====================
  console.log("\n📌 Step 8: 回滚 A1（消息 + 文件）→ 全部清空");
  await rpc(ws, "agent.stop", { sessionId: sid });

  const jsonl2 = readFileSync(sp, "utf-8").trim().split("\n");
  const entries2 = jsonl2.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const messageEntries2 = entries2.filter(e => e.type === "message");
  const userMessages2 = messageEntries2.filter(e => e.message?.role === "user");
  
  // 找 A 的 user message（应该只剩下 A 了，因为 B 已经被回滚）
  // 但 JSONL 里 B 还在（只是 leaf 不指向它），所以找第一个 user message
  const aUserMsg = userMessages2[0];
  if (!aUserMsg) {
    console.log("  ⚠️ 找不到 A 的 user message");
  } else {
    console.log(`  A 的 user message id: ${aUserMsg.id.slice(0, 16)}...`);

    await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
    const rollbackResult2 = await rpc(ws, "agent.navigateTree", {
      sessionId: sid,
      targetId: aUserMsg.id,
      summarize: false,
      skipFiles: false, // 带文件恢复
    }, 60000);
    console.log(`  回滚结果: cancelled=${rollbackResult2.result?.cancelled}`);
    await new Promise(r => setTimeout(r, 3000));

    const resultRollback2 = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const msgsAfterRollback2 = resultRollback2.result?.messages?.length || 0;
    const a1ExistsAfterARollback = fileExists(a1Path);
    const v1ExistsAfterARollback = fileExists(v1Path);

    console.log(`  消息数: ${msgsAfterRollback2}（应该是 0 或很少）`);
    console.log(`  A1.txt 存在: ${a1ExistsAfterARollback}`);
    console.log(`  V1.txt 存在: ${v1ExistsAfterARollback}`);

    if (msgsAfterRollback2 === 0) {
      console.log(`  ✅ 回滚 A 后消息清空`);
    } else {
      console.log(`  ⚠️ 回滚 A 后还有 ${msgsAfterRollback2} 条消息`);
    }

    if (!a1ExistsAfterARollback) {
      console.log(`  ✅ A1.txt 已被恢复（删除）`);
    } else {
      console.log(`  ❌ A1.txt 应该被恢复（删除）但还是存在！`);
      pass = false;
    }
  }

  // ==================== 最终结果 ====================
  console.log("\n" + "=".repeat(50));
  if (pass) {
    console.log("🎉 全部验证通过！回滚消息 + 文件恢复正确");
  } else {
    console.log("❌ 验证失败，请检查上面的输出");
  }

  await rpc(ws, "agent.stop", { sessionId: sid });
  ws.close();
  console.log(`\n项目目录: ${CWD}（可手动检查或清理）`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

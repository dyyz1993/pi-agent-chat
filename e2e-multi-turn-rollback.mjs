/**
 * E2E 验证：多轮对话后回滚，验证文件恢复数量和内容正确性
 * 
 * 场景：
 * 1. 创建 file1.txt（新增）
 * 2. 创建 file2.txt（新增）
 * 3. 创建 file3.txt（新增）
 * 4. 修改 file1.txt（从 "v1" 改成 "v2"）
 * 5. 创建 file4.txt（新增）
 * 6. 回滚第 5 条（带文件）→ 只有 file4.txt 被删除
 * 7. 回滚第 4 条（带文件）→ file1.txt 从 "v2" 恢复成 "v1"
 * 8. 回滚第 3 条（带文件）→ file3.txt 被删除
 * 9. 回滚到空 → file1.txt("v1") 和 file2.txt 都被删除
 */
import WebSocket from "ws";
import { execSync } from "child_process";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-multi-rollback-${Date.now()}`;
mkdirSync(CWD, { recursive: true });

let msgId = 0;
const pending = new Map();

function wsConnect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    ws.on("open", () => resolve(ws));
    setTimeout(() => reject(new Error("connect timeout")), 10000);
  });
}

function rpc(ws, method, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = `test-${++msgId}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, timeout);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

async function waitForReply(ws, sid, sp, minMsgs, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const msgs = res.result?.messages || [];
    if (msgs.length >= minMsgs) return res.result;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`timeout: expected >= ${minMsgs} messages`);
}

function readFile(path) { try { return readFileSync(path, "utf-8").trim(); } catch { return null; } }
function fileExists(path) { return existsSync(path); }

function printFileState(label, files) {
  console.log(`\n  [${label}]`);
  for (const f of files) {
    const content = readFile(f.path);
    const exists = content !== null;
    console.log(`    ${f.name}: ${exists ? `✅ 内容="${content}"` : "❌ 不存在"}`);
  }
}

async function main() {
  console.log("=== E2E: 多轮对话回滚 — 文件恢复数量和内容验证 ===\n");
  console.log(`项目目录: ${CWD}\n`);

  const ws = await wsConnect();
  console.log("✅ 连接成功\n");

  const f1 = join(CWD, "file1.txt");
  const f2 = join(CWD, "file2.txt");
  const f3 = join(CWD, "file3.txt");
  const f4 = join(CWD, "file4.txt");

  // 创建会话
  const sr = await rpc(ws, "session.create", { projectPath: CWD });
  const sid = sr.result.sessionId;
  const sp = sr.result.sessionPath;
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });

  // ==================== 5 轮对话 ====================
  const turns = [
    { msg: "创建一个文件 file1.txt，内容写 version1", desc: "Turn 1: 创建 file1.txt (v1)", expectFile: f1, expectContent: "version1" },
    { msg: "创建一个文件 file2.txt，内容写 hello2", desc: "Turn 2: 创建 file2.txt", expectFile: f2, expectContent: "hello2" },
    { msg: "创建一个文件 file3.txt，内容写 hello3", desc: "Turn 3: 创建 file3.txt", expectFile: f3, expectContent: "hello3" },
    { msg: "把 file1.txt 的内容改成 version2", desc: "Turn 4: 修改 file1.txt (v1→v2)", expectFile: f1, expectContent: "version2" },
    { msg: "创建一个文件 file4.txt，内容写 hello4", desc: "Turn 5: 创建 file4.txt", expectFile: f4, expectContent: "hello4" },
  ];

  let currentMsgCount = 0;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    console.log(`📌 ${t.desc}`);
    await rpc(ws, "agent.send", { sessionId: sid, content: t.msg });
    currentMsgCount = (await waitForReply(ws, sid, sp, currentMsgCount + 2, 120000)).messages.length;
    // 等文件写入
    await new Promise(r => setTimeout(r, 6000));
    const content = readFile(t.expectFile);
    const ok = content?.includes(t.expectContent) ?? false;
    console.log(`  ${ok ? "✅" : "⚠️"} ${t.expectFile.split("/").pop()}: ${content !== null ? `"${content}"` : "不存在"}`);
    // 如果不 ok 再等
    if (!ok) {
      await new Promise(r => setTimeout(r, 10000));
      const content2 = readFile(t.expectFile);
      console.log(`  重试: ${content2 !== null ? `"${content2}"` : "不存在"}`);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("📊 回滚前文件状态:");
  printFileState("5 轮完成后", [
    { name: "file1.txt", path: f1 },
    { name: "file2.txt", path: f2 },
    { name: "file3.txt", path: f3 },
    { name: "file4.txt", path: f4 },
  ]);

  // 停止 Agent 准备回滚
  await rpc(ws, "agent.stop", { sessionId: sid });

  // 读 JSONL 找 user messages
  const jsonl = readFileSync(sp, "utf-8").trim().split("\n");
  const entries = jsonl.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const userMsgs = entries.filter(e => e.type === "message" && e.message?.role === "user");
  console.log(`\n找到 ${userMsgs.length} 个 user message`);

  let pass = true;

  // ==================== 回滚 Turn 5（删除 file4.txt）====================
  console.log("\n" + "=".repeat(50));
  console.log("📌 回滚 Turn 5（创建 file4.txt）→ 预期：file4.txt 被删除，其余不变");
  
  const turn5User = userMsgs[userMsgs.length - 1]; // 最后一个 user msg
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
  const rb5 = await rpc(ws, "agent.navigateTree", {
    sessionId: sid, targetId: turn5User.id, summarize: false, skipFiles: false,
  }, 60000);
  console.log(`  回滚结果: cancelled=${rb5.result?.cancelled}`);
  await new Promise(r => setTimeout(r, 5000));

  printFileState("回滚 Turn 5 后", [
    { name: "file1.txt", path: f1 },
    { name: "file2.txt", path: f2 },
    { name: "file3.txt", path: f3 },
    { name: "file4.txt", path: f4 },
  ]);

  // 验证
  const v1_f1 = readFile(f1);
  const v1_f2 = readFile(f2);
  const v1_f3 = readFile(f3);
  const v1_f4 = readFile(f4);

  if (v1_f1?.includes("version2")) { console.log("  ✅ file1.txt 保留，内容 version2"); }
  else { console.log(`  ❌ file1.txt 应该是 version2，实际: "${v1_f1}"`); pass = false; }

  if (v1_f2 !== null) { console.log("  ✅ file2.txt 保留"); }
  else { console.log("  ❌ file2.txt 不应该被删除"); pass = false; }

  if (v1_f3 !== null) { console.log("  ✅ file3.txt 保留"); }
  else { console.log("  ❌ file3.txt 不应该被删除"); pass = false; }

  if (v1_f4 === null) { console.log("  ✅ file4.txt 已被删除"); }
  else { console.log(`  ❌ file4.txt 应该被删除但还在，内容: "${v1_f4}"`); pass = false; }

  // ==================== 回滚 Turn 4（file1.txt v2→v1）====================
  console.log("\n" + "=".repeat(50));
  console.log("📌 回滚 Turn 4（修改 file1.txt）→ 预期：file1.txt 恢复成 version1");
  
  await rpc(ws, "agent.stop", { sessionId: sid });
  // 重新读 JSONL（回滚可能追加了 entries）
  const jsonl2 = readFileSync(sp, "utf-8").trim().split("\n");
  const entries2 = jsonl2.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const userMsgs2 = entries2.filter(e => e.type === "message" && e.message?.role === "user");
  
  // Turn 4 的 user msg 是倒数第 3 个（turn5 和 turn4 都在，但 turn5 被回滚了 leaf 不指向它）
  // 找到所有 user msgs，按时间顺序，turn4 是第 4 个（index 3）
  const turn4User = userMsgs2[3]; // 第 4 个 user message
  if (!turn4User) {
    console.log("  ⚠️ 找不到 Turn 4 的 user message");
  } else {
    await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
    const rb4 = await rpc(ws, "agent.navigateTree", {
      sessionId: sid, targetId: turn4User.id, summarize: false, skipFiles: false,
    }, 60000);
    console.log(`  回滚结果: cancelled=${rb4.result?.cancelled}`);
    await new Promise(r => setTimeout(r, 5000));

    printFileState("回滚 Turn 4 后", [
      { name: "file1.txt", path: f1 },
      { name: "file2.txt", path: f2 },
      { name: "file3.txt", path: f3 },
      { name: "file4.txt", path: f4 },
    ]);

    const v2_f1 = readFile(f1);
    if (v2_f1?.includes("version1")) { console.log("  ✅ file1.txt 恢复成 version1"); }
    else { console.log(`  ❌ file1.txt 应该恢复成 version1，实际: "${v2_f1}"`); pass = false; }

    if (readFile(f2) !== null) { console.log("  ✅ file2.txt 保留"); }
    else { console.log("  ❌ file2.txt 不应该被删除"); pass = false; }

    if (readFile(f3) !== null) { console.log("  ✅ file3.txt 保留"); }
    else { console.log("  ❌ file3.txt 不应该被删除"); pass = false; }
  }

  // ==================== 回滚 Turn 3（删除 file3.txt）====================
  console.log("\n" + "=".repeat(50));
  console.log("📌 回滚 Turn 3（创建 file3.txt）→ 预期：file3.txt 被删除");
  
  await rpc(ws, "agent.stop", { sessionId: sid });
  const jsonl3 = readFileSync(sp, "utf-8").trim().split("\n");
  const entries3 = jsonl3.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const userMsgs3 = entries3.filter(e => e.type === "message" && e.message?.role === "user");
  
  const turn3User = userMsgs3[2]; // 第 3 个 user message
  if (!turn3User) {
    console.log("  ⚠️ 找不到 Turn 3 的 user message");
  } else {
    await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
    const rb3 = await rpc(ws, "agent.navigateTree", {
      sessionId: sid, targetId: turn3User.id, summarize: false, skipFiles: false,
    }, 60000);
    console.log(`  回滚结果: cancelled=${rb3.result?.cancelled}`);
    await new Promise(r => setTimeout(r, 5000));

    printFileState("回滚 Turn 3 后", [
      { name: "file1.txt", path: f1 },
      { name: "file2.txt", path: f2 },
      { name: "file3.txt", path: f3 },
    ]);

    if (readFile(f3) === null) { console.log("  ✅ file3.txt 已被删除"); }
    else { console.log(`  ❌ file3.txt 应该被删除但还在`); pass = false; }

    if (readFile(f1)?.includes("version1")) { console.log("  ✅ file1.txt 仍是 version1"); }
    else { console.log("  ❌ file1.txt 应该保持 version1"); pass = false; }

    if (readFile(f2) !== null) { console.log("  ✅ file2.txt 保留"); }
    else { console.log("  ❌ file2.txt 不应该被删除"); pass = false; }
  }

  // ==================== 回滚到空（全部文件应消失）====================
  console.log("\n" + "=".repeat(50));
  console.log("📌 回滚 Turn 1（创建 file1.txt）→ 预期：所有文件消失");
  
  await rpc(ws, "agent.stop", { sessionId: sid });
  const jsonl4 = readFileSync(sp, "utf-8").trim().split("\n");
  const entries4 = jsonl4.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const userMsgs4 = entries4.filter(e => e.type === "message" && e.message?.role === "user");
  
  const turn1User = userMsgs4[0]; // 第 1 个 user message
  if (!turn1User) {
    console.log("  ⚠️ 找不到 Turn 1 的 user message");
  } else {
    await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
    const rb1 = await rpc(ws, "agent.navigateTree", {
      sessionId: sid, targetId: turn1User.id, summarize: false, skipFiles: false,
    }, 60000);
    console.log(`  回滚结果: cancelled=${rb1.result?.cancelled}`);
    await new Promise(r => setTimeout(r, 5000));

    printFileState("回滚到空后", [
      { name: "file1.txt", path: f1 },
      { name: "file2.txt", path: f2 },
    ]);

    if (!fileExists(f1) && !fileExists(f2)) {
      console.log("  ✅ 所有文件已被清理");
    } else {
      console.log("  ❌ 应该所有文件都消失");
      if (fileExists(f1)) console.log(`    file1.txt 还在: "${readFile(f1)}"`);
      if (fileExists(f2)) console.log(`    file2.txt 还在: "${readFile(f2)}"`);
      pass = false;
    }
  }

  // ==================== 最终结果 ====================
  console.log("\n" + "=".repeat(50));
  if (pass) {
    console.log("🎉 全部验证通过！多轮回滚文件恢复数量和内容正确");
  } else {
    console.log("❌ 验证失败，请检查上面的输出");
  }

  await rpc(ws, "agent.stop", { sessionId: sid });
  ws.close();
  console.log(`\n项目目录: ${CWD}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });

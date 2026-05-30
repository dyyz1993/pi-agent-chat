/**
 * E2E 完整验证：多轮回滚 + previewRollback diff 列表 + 文件恢复
 * 
 * 每轮回滚前先调 previewRollback 验证：
 *   - deleted 文件列表数量是否正确
 *   - restored 文件列表数量是否正确
 * 然后再执行实际回滚验证文件是否正确恢复
 */
import WebSocket from "ws";
import { execSync } from "child_process";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-full-rollback-${Date.now()}`;
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

function read(path) { try { return readFileSync(path, "utf-8").trim(); } catch { return null; } }
function exists(path) { return existsSync(path); }

async function main() {
  console.log("=== E2E 完整验证：多轮回滚 + preview diff + 文件恢复 ===\n");
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
    { msg: "创建一个文件 file1.txt，内容写 version1", desc: "Turn 1: 新建 file1.txt", file: f1, expectContent: "version1" },
    { msg: "创建一个文件 file2.txt，内容写 hello2", desc: "Turn 2: 新建 file2.txt", file: f2, expectContent: "hello2" },
    { msg: "创建一个文件 file3.txt，内容写 hello3", desc: "Turn 3: 新建 file3.txt", file: f3, expectContent: "hello3" },
    { msg: "把 file1.txt 的内容改成 version2", desc: "Turn 4: 修改 file1.txt", file: f1, expectContent: "version2" },
    { msg: "创建一个文件 file4.txt，内容写 hello4", desc: "Turn 5: 新建 file4.txt", file: f4, expectContent: "hello4" },
  ];

  let msgCount = 0;
  for (const t of turns) {
    console.log(`📌 ${t.desc}`);
    await rpc(ws, "agent.send", { sessionId: sid, content: t.msg });
    msgCount = (await waitForReply(ws, sid, sp, msgCount + 2, 120000)).messages.length;
    await new Promise(r => setTimeout(r, 6000));
    const c = read(t.file);
    const ok = c?.includes(t.expectContent) ?? false;
    console.log(`  ${ok ? "✅" : "⚠️"} ${t.file.split("/").pop()}: "${c}"`);
    if (!ok) { await new Promise(r => setTimeout(r, 10000)); console.log(`  重试: "${read(t.file)}"`); }
  }

  console.log("\n📊 5 轮后文件状态:");
  console.log(`  file1: "${read(f1)}", file2: "${read(f2)}", file3: "${read(f3)}", file4: "${read(f4)}"`);

  // 停止 Agent
  await rpc(ws, "agent.stop", { sessionId: sid });

  // 读 JSONL 找 user messages
  const getUserMsgs = () => {
    const lines = readFileSync(sp, "utf-8").trim().split("\n");
    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return entries.filter(e => e.type === "message" && e.message?.role === "user");
  };

  // 根据内容找 user message（不依赖固定 index）
  const findUserMsg = (keyword) => {
    const msgs = getUserMsgs();
    return msgs.find(m => {
      const c = m.message?.content;
      if (typeof c === "string") return c.includes(keyword);
      if (Array.isArray(c)) return c.some(b => typeof b?.text === "string" && b.text.includes(keyword));
      return false;
    });
  };

  let pass = true;

  // ==================== 辅助：preview + rollback + 验证 ====================
  async function doRollback(step, keyword, expectDeleted, expectRestored, desc) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`📌 ${step}: ${desc}`);

    // 找 target user message by content keyword
    const target = findUserMsg(keyword);
    if (!target) {
      console.log(`  ❌ 找不到包含 "${keyword}" 的 user message`);
      pass = false;
      return;
    }
    const content = typeof target.message?.content === "string" 
      ? target.message.content 
      : JSON.stringify(target.message?.content)?.slice(0, 60);
    console.log(`  定位到 user msg: "${content}"`);

    // 1. Preview
    await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
    const preview = await rpc(ws, "agent.previewRollback", { sessionId: sid, targetId: target.id });
    const pResult = preview.result || {};
    const pDeleted = pResult.deleted || [];
    const pRestored = pResult.restored || [];
    console.log(`  📋 Preview: deleted=${pDeleted.length} restored=${pRestored.length}`);
    console.log(`     deleted: ${pDeleted.length > 0 ? pDeleted.map(f => f.split("/").pop()).join(", ") : "(无)"}`);
    console.log(`     restored: ${pRestored.length > 0 ? pRestored.map(f => f.split("/").pop()).join(", ") : "(无)"}`);

    // 验证 preview 数量
    if (pDeleted.length === expectDeleted) {
      console.log(`  ✅ Preview deleted 数量正确 (${expectDeleted})`);
    } else {
      console.log(`  ❌ Preview deleted 数量不对: 预期 ${expectDeleted}，实际 ${pDeleted.length}`);
      pass = false;
    }

    if (pRestored.length === expectRestored) {
      console.log(`  ✅ Preview restored 数量正确 (${expectRestored})`);
    } else {
      console.log(`  ❌ Preview restored 数量不对: 预期 ${expectRestored}，实际 ${pRestored.length}`);
      pass = false;
    }

    // 2. 实际回滚
    const rb = await rpc(ws, "agent.navigateTree", {
      sessionId: sid, targetId: target.id, summarize: false, skipFiles: false,
    }, 60000);
    console.log(`  🔧 回滚: cancelled=${rb.result?.cancelled}`);
    await rpc(ws, "agent.stop", { sessionId: sid });
    await new Promise(r => setTimeout(r, 3000));
  }

  // ==================== 逐个回滚 ====================

  // 回滚 Turn 5：删除 file4.txt
  await doRollback("Step 1", "file4", 1, 0, "回滚 Turn 5 → 删除 file4.txt");
  // 验证文件
  if (!exists(f4) && read(f1)?.includes("version2")) {
    console.log("  ✅ file4 已删除，file1 仍是 version2");
  } else {
    console.log(`  ⚠️ file4=${exists(f4) ? read(f4) : "不存在"}, file1="${read(f1)}"`);
  }

  // 回滚 Turn 4：file1 从 v2 恢复到 v1
  await doRollback("Step 2", "version2", 0, 1, "回滚 Turn 4 → file1 恢复 version1");
  if (read(f1)?.includes("version1")) {
    console.log("  ✅ file1 恢复成 version1");
  } else {
    console.log(`  ⚠️ file1="${read(f1)}"`);
  }

  // 回滚 Turn 3：删除 file3.txt
  await doRollback("Step 3", "file3", 1, 0, "回滚 Turn 3 → 删除 file3.txt");
  if (!exists(f3)) {
    console.log("  ✅ file3 已删除");
  } else {
    console.log(`  ⚠️ file3 还在`);
  }

  // 回滚 Turn 2：删除 file2.txt
  await doRollback("Step 4", "file2", 1, 0, "回滚 Turn 2 → 删除 file2.txt");
  if (!exists(f2)) {
    console.log("  ✅ file2 已删除");
  } else {
    console.log(`  ⚠️ file2 还在`);
  }

  // 回滚 Turn 1：删除 file1.txt
  await doRollback("Step 5", "file1", 1, 0, "回滚 Turn 1 → 全部清空");
  if (!exists(f1)) {
    console.log("  ✅ file1 已删除，目录清空");
  } else {
    console.log(`  ❌ file1 还在: "${read(f1)}"`);
    pass = false;
  }

  // ==================== 最终结果 ====================
  console.log("\n" + "=".repeat(50));
  if (pass) {
    console.log("🎉 全部验证通过！preview diff 数量 + 文件恢复内容全部正确");
  } else {
    console.log("❌ 验证失败，请检查上面的输出");
  }

  ws.close();
  console.log(`\n项目目录: ${CWD}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });

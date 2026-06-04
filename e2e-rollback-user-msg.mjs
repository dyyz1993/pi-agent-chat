/**
 * E2E 验证：回滚 user message 时 custom entry 是否残留
 * 模拟用户场景：创建 A → 创建 B → 回滚 B 的 user message
 */
import WebSocket from "ws";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-rollback-usermsg-${Date.now()}`;
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

async function waitForMessages(ws, sid, sp, minCount, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const msgs = res.result?.messages || [];
    if (msgs.length >= minCount) return res.result;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`timeout: expected >= ${minCount} messages`);
}

function print(label, result) {
  const msgs = result?.messages || [];
  const customs = result?.customEntries || [];
  console.log(`\n=== ${label} ===`);
  console.log(`Messages (${msgs.length}):`);
  for (const m of msgs) {
    const role = m.role;
    const content = typeof m.content === "string" ? m.content.slice(0, 80) : `[${m.content?.length || 0} blocks]`;
    console.log(`  [${role}] ${content}`);
  }
  console.log(`Custom Entries (${customs.length}):`);
  for (const c of customs) {
    const data = c.data;
    const query = typeof data?.query === "string" ? ` query="${data.query}"` : "";
    console.log(`  [${c.customType}]${query}`);
  }
}

async function main() {
  console.log("=== E2E: 回滚 user message 时 custom entry 验证 ===\n");
  console.log(`临时目录: ${CWD}\n`);

  const ws = await wsConnect();
  console.log("✅ WebSocket 连接成功\n");

  // Step 1: 创建会话
  const sr = await rpc(ws, "session.create", { projectPath: CWD });
  const sid = sr.result.sessionId;
  const sp = sr.result.sessionPath;
  console.log(`✅ 会话创建成功: ${sid}\n`);

  // Step 2: 启动 Agent
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });

  // Step 3: 发消息 A："帮我创建一个文件 A1.txt，内容是 hello"
  console.log("📌 发消息 A: '帮我创建一个文件 A1.txt，内容是 hello'");
  await rpc(ws, "agent.send", { sessionId: sid, content: "帮我创建一个文件 A1.txt，内容是 hello" });
  const resultA = await waitForMessages(ws, sid, sp, 2);
  print("发消息 A 后", resultA);

  // 等久一点确保 Agent 完全完成（工具调用 + 最终回复）
  await new Promise(r => setTimeout(r, 5000));
  const resultA2 = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
  const msgsAfterA = resultA2.result?.messages?.length || 0;
  const customsAfterA = resultA2.result?.customEntries?.length || 0;
  print("A 完成后（再次检查）", resultA2.result);

  // Step 4: 发消息 B："帮我创建一个文件 V1.txt，内容是 world"
  console.log("\n📌 发消息 B: '帮我创建一个文件 V1.txt，内容是 world'");
  await rpc(ws, "agent.send", { sessionId: sid, content: "帮我创建一个文件 V1.txt，内容是 world" });
  // 等足够久让 B 完全完成
  const resultBRaw = await waitForMessages(ws, sid, sp, msgsAfterA + 2, 120000);
  // 再等一下确保工具调用全部完成
  await new Promise(r => setTimeout(r, 5000));
  const resultB = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
  print("发消息 B 后（再次检查）", resultB.result);
  const msgsAfterB = resultB.result?.messages?.length || 0;
  const customsAfterB = resultB.result?.customEntries?.length || 0;

  // Step 5: 停止 Agent，找 B 的 user message 作为回滚目标
  console.log("\n📌 停止 Agent，准备回滚 B 的 user message...");
  await rpc(ws, "agent.stop", { sessionId: sid });

  const jsonl = readFileSync(sp, "utf-8").trim().split("\n");
  const entries = jsonl.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const messageEntries = entries.filter(e => e.type === "message");
  
  // 找 B 的 user message（第二个 user message）
  const userMessages = messageEntries.filter(e => e.message?.role === "user");
  const bUserMsg = userMessages.length >= 2 ? userMessages[1] : null;
  
  if (!bUserMsg) {
    console.error("❌ 找不到 B 的 user message");
    ws.close();
    return;
  }
  
  console.log(`  B 的 user message: id=${bUserMsg.id.slice(0, 16)}...`);
  console.log(`  内容: "${(bUserMsg.message.content || "").slice(0, 60)}"`);

  // 也看看 B 的 user message 的 parent 是什么
  const bParent = entries.find(e => e.id === bUserMsg.parentId);
  console.log(`  B 的 parent: type=${bParent?.type} customType=${bParent?.customType || "n/a"} id=${bParent?.id?.slice(0, 16) || "null"}`);

  // Step 6: 重启 Agent + 回滚 B 的 user message
  console.log("\n📌 回滚 B 的 user message（保留 A，去掉 B）...");
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
  
  const rollbackResult = await rpc(ws, "agent.navigateTree", {
    sessionId: sid,
    targetId: bUserMsg.id,
    summarize: false,
  });
  console.log(`  回滚结果: cancelled=${rollbackResult.result?.cancelled}`);

  // Step 7: 检查 leaf 指向哪里
  const jsonl2 = readFileSync(sp, "utf-8").trim().split("\n");
  const entries2 = jsonl2.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const leafPointers = entries2.filter(e => e.type === "leaf_pointer");
  const lastLeaf = leafPointers[leafPointers.length - 1];
  const leafId = lastLeaf?.leafId;
  console.log(`  回滚后 leafId: ${leafId?.slice(0, 16) || "null"}`);
  
  // leaf 指向的 entry 是什么类型？
  const leafEntry = entries2.find(e => e.id === leafId);
  console.log(`  leaf entry: type=${leafEntry?.type} customType=${leafEntry?.customType || "n/a"}`);

  // Step 8: 验证回滚后的消息和 custom entries
  console.log("\n📌 验证回滚后状态...");
  const resultRollback = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
  const rollMsgs = resultRollback.result?.messages || [];
  const rollCustoms = resultRollback.result?.customEntries || [];
  print("回滚后", resultRollback.result);

  // 验证
  console.log("\n=== 验证结果 ===");
  let pass = true;

  if (rollMsgs.length < msgsAfterB) {
    console.log(`✅ 消息数减少: ${msgsAfterB} → ${rollMsgs.length}`);
  } else {
    console.log(`❌ 消息数未减少: ${msgsAfterB} → ${rollMsgs.length}`);
    pass = false;
  }

  // 检查 B 的 custom entries 是否被过滤
  const rollCustomTypes = rollCustoms.map(c => c.customType);
  const bOnlyCustoms = customsAfterB > customsAfterA ? rollCustoms.slice(customsAfterA) : [];
  console.log(`\n  回滚前: ${customsAfterB} 个 custom, 回滚后: ${rollCustoms.length} 个 custom`);
  
  if (rollCustoms.length <= customsAfterA) {
    console.log(`✅ Custom entries 未增长: ${rollCustoms.length} <= A之后的 ${customsAfterA}`);
  } else {
    console.log(`❌ Custom entries 比 A 之后还多: ${rollCustoms.length} > ${customsAfterA}`);
    // 打印多余的
    const extraCustoms = rollCustoms.filter(c => !(resultA2.result?.customEntries || []).some(ac => ac.id === c.id));
    console.log(`  多余的 custom entries:`);
    for (const c of extraCustoms) {
      console.log(`    [${c.customType}] id=${c.id.slice(0, 12)}...`);
    }
    pass = false;
  }

  // 检查是否包含 B 的 prefetch
  const bPrefetch = rollCustoms.filter(c => 
    c.customType === "memory_prefetch" && 
    !(resultA2.result?.customEntries || []).some(ac => ac.id === c.id)
  );
  if (bPrefetch.length === 0) {
    console.log(`✅ B 的 memory_prefetch 被过滤掉了`);
  } else {
    console.log(`❌ B 的 memory_prefetch 残留! 共 ${bPrefetch.length} 个`);
    pass = false;
  }

  // Step 9: 回滚后发消息 C 验证能继续
  console.log("\n📌 回滚后发消息 C: '谢谢'");
  await rpc(ws, "agent.send", { sessionId: sid, content: "谢谢" });
  const resultC = await waitForMessages(ws, sid, sp, rollMsgs.length + 2, 60000);
  const msgsC = resultC.messages || [];
  if (msgsC.length > rollMsgs.length) {
    console.log(`✅ 回滚后能继续对话: ${rollMsgs.length} → ${msgsC.length}`);
  } else {
    console.log(`❌ 回滚后无法继续对话`);
    pass = false;
  }

  console.log("\n" + "=".repeat(50));
  if (pass) {
    console.log("🎉 验证通过！回滚 user message 时 custom entry 正确过滤");
  } else {
    console.log("❌ 验证失败！回滚 user message 时 custom entry 有残留");
  }

  await rpc(ws, "agent.stop", { sessionId: sid });
  ws.close();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

/**
 * 真模型事件形状探针 —— 对体验栈（3199）跑一次带 bash 工具的任务，
 * 抓全量 agent.event 帧，重点看 tool_execution_end 的结果字段。
 * 用法：node docs/plans/ion-backend/probe-real-tool-events.mjs
 */
import WebSocket from "ws";
import { mkdirSync, writeFileSync } from "node:fs";

const WS_URL = "ws://localhost:3199/ws?token=ion-trial";
const CWD = "/tmp/ion-tool-probe";

let msgId = 0;
const pending = new Map();
const frames = [];

function rpc(ws, method, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = `probe-${++msgId}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timeout`));
    }, timeout);
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

const ws = new WebSocket(WS_URL);
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.type === "event") frames.push(msg);
});
ws.on("open", async () => {
  try {
    ws.send(JSON.stringify({ id: "sub-1", type: "subscribe", eventType: "agent.event" }));
    mkdirSync(CWD, { recursive: true });
    writeFileSync(`${CWD}/note.txt`, "probe file content\n");
    const sr = await rpc(ws, "session.create", { projectPath: CWD });
    const sid = sr.result.sessionId,
      sp = sr.result.sessionPath;
    await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp }, 40000);
    await rpc(ws, "agent.send", {
      sessionId: sid,
      content: "请用 bash 工具执行 echo hello-ion-tool，并告诉我输出内容。",
    });
    // 等 agent_end
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && !frames.some((f) => f.payload?.event?.type === "agent_end")) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    // stop 前先读历史（UI 真实路径：client 存活时读）
    const pre = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const preMsgs = pre.result?.messages ?? [];
    console.log(
      "MSGS_BEFORE_STOP:",
      JSON.stringify(preMsgs.map((m) => ({ role: m.role, n: (m.content ?? []).length }))),
    );
    await rpc(ws, "agent.stop", { sessionId: sid });
    // 输出分析
    const types = frames.map((f) => f.payload?.event?.type ?? "?");
    console.log("EVENT TYPES:", JSON.stringify(types));
    const toolEnds = frames.filter((f) => f.payload?.event?.type === "tool_execution_end");
    for (const t of toolEnds) {
      console.log("TOOL_END KEYS:", JSON.stringify(Object.keys(t.payload.event)));
      console.log("TOOL_END FULL:", JSON.stringify(t.payload.event).slice(0, 600));
    }
    const extEvents = frames.filter((f) => f.payload?.event?.type === "extension_event");
    console.log(
      "EXT_EVENTS:",
      extEvents.length,
      JSON.stringify(extEvents.slice(0, 3).map((e) => e.payload.event)).slice(0, 500),
    );
    const mr = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const msgs = mr.result?.messages ?? [];
    console.log(
      "MSGS:",
      JSON.stringify(
        msgs.map((m) => ({ role: m.role, contentTypes: (m.content ?? []).map((c) => c.type) })),
      ),
    );
    const toolResults = msgs.filter((m) => m.role === "toolResult");
    if (toolResults[0])
      console.log("TOOLRESULT_SAMPLE:", JSON.stringify(toolResults[0]).slice(0, 500));
    ws.close();
    process.exit(0);
  } catch (e) {
    console.error("PROBE ERROR:", e.message);
    process.exit(1);
  }
});
setTimeout(() => {
  console.error("probe timeout");
  process.exit(1);
}, 120000);

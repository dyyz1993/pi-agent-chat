/**
 * ion 后端集成 smoke —— 真 socket 端到端验证 IonRpcClient 核心闭环。
 *
 * 前置：隔离 ion host 已在跑（ION_HOST_SOCKET 指向私有 socket，faux provider）。
 * 用法：ION_SESSION_DIR=... ION_SMOKE_SESSION=<id|空> bun docs/plans/ion-backend/smoke-ion-client.ts
 * 退出码 0 = 全部 PASS。
 */

import { IonRpcClient } from "../../../src/shared/agent/ion-backend/ion-rpc-client";

const socketPath = process.env.ION_HOST_SOCKET;
if (!socketPath) {
  console.error("SMOKE FAIL: ION_HOST_SOCKET not set");
  process.exit(1);
}
const cwd = process.env.ION_SMOKE_CWD ?? "/tmp";
const sessionId = process.env.ION_SMOKE_SESSION || `smoke-${Date.now()}`;

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

async function main() {
  const events: Array<{ type: string; text?: string }> = [];
  const client = new IonRpcClient({ socketPath, cwd, sessionId, autoSpawnHost: false });

  // 1. start：幂等建会话 + 订阅泵
  await client.start();
  ok("start (session + pump)", true, `sessionId=${client.ionSessionId}`);

  const off = client.onEvent((event: { type: string }) => {
    const any = event as { type: string; assistantMessageEvent?: { delta?: string } };
    if (any.type === "message_update" && any.assistantMessageEvent?.delta) {
      events.push({ type: "message_update", text: any.assistantMessageEvent.delta });
    } else {
      events.push({ type: event.type });
    }
  });

  // 2. prompt（faux 回复）
  await client.prompt("smoke round");
  await new Promise((r) => setTimeout(r, 5000)); // 等 faux agent_end

  const sawStart = events.some((e) => e.type === "agent_start");
  const sawEnd = events.some((e) => e.type === "agent_end");
  const sawText = events.filter((e) => e.type === "message_update").length;
  ok("event agent_start", sawStart);
  ok("event text_delta→message_update", sawText > 0, `count=${sawText}`);
  ok("event agent_end", sawEnd, JSON.stringify(events.map((e) => e.type)));

  // 3. 消息读取（flatten）
  const full = (await client.getFullMessages()) as {
    messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    tree: { leafId: string | null };
  };
  ok("getFullMessages roles", full.messages.some((m) => m.role === "user") && full.messages.some((m) => m.role === "assistant"), JSON.stringify(full.messages.map((m) => m.role)));
  const assistantText = full.messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.content.filter((c) => c.type === "text").map((c) => c.text))
    .join("");
  ok("getFullMessages assistant text non-empty", assistantText.length > 0, assistantText.slice(0, 60));

  // 4. 树/leaf
  const tree = (await client.getTreeWithLeaf()) as { leafId: string | null; entries: unknown[] };
  ok("getTreeWithLeaf leafId", typeof tree.leafId === "string" && tree.leafId.length > 0, `leafId=${tree.leafId}`);

  // 5. 状态
  const state = (await client.getState()) as { isStreaming: boolean; messageCount: number };
  ok("getState idle after turn", state.isStreaming === false);
  ok("getState messageCount >= 2", state.messageCount >= 2, `count=${state.messageCount}`);

  // 6. 分页（tail limit=1）
  const page = (await client.getMessageNavPage({ limit: 1 })) as { messages: unknown[]; hasMore: boolean };
  ok("getMessageNavPage limit=1", page.messages.length === 1 && page.hasMore === true, JSON.stringify({ n: page.messages.length, hasMore: page.hasMore }));

  // 7. bash + lastAssistantText
  const bash = await client.bash("echo smoke-bash");
  ok("bash exitCode 0", bash.exitCode === 0, JSON.stringify(bash));
  const last = await client.getLastAssistantText();
  ok("getLastAssistantText", typeof last === "string");

  // 8. 同 session_id 重启幂等（复活路径）
  const client2 = new IonRpcClient({ socketPath, cwd, sessionId, autoSpawnHost: false });
  await client2.start();
  const full2 = (await client2.getFullMessages()) as { messages: unknown[] };
  ok("session revival keeps history", full2.messages.length >= full.messages.length, `before=${full.messages.length} after=${full2.messages.length}`);
  await client2.stop();

  // 9. abort / stop（不抛错即过）
  await client.abort();
  off();
  await client.stop();
  ok("abort + stop clean", true);

  console.log(`\nSMOKE RESULT: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("SMOKE ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

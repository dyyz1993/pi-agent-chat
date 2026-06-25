import { randomUUID } from "crypto";
import WebSocket from "ws";

const PORT = 5173;
const AUTH_TOKEN = "pi-agent-chat-chat-token";
const WS_URL = `ws://localhost:${PORT}/ws?token=${AUTH_TOKEN}`;
const PROJECT_PATH = process.cwd();

interface RPCMessage {
  id: string;
  type: "request" | "response" | "event" | "subscribe" | "unsubscribe";
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
  eventType?: string;
  payload?: unknown;
  metadata?: Record<string, unknown>;
  timestamp?: number;
}

const capturedCases: Array<{
  name: string;
  method: string;
  params: unknown;
  result: unknown;
  elapsed: number;
}> = [];

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WS connect timeout"));
    }, 10000);
    ws.on("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function sendRPC(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
): Promise<RPCMessage> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timeout = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), 60000);
    const handler = (data: Buffer) => {
      try {
        const msg: RPCMessage = JSON.parse(data.toString());
        if (msg.id === id && msg.type === "response") {
          clearTimeout(timeout);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch {
        /* ignore non-JSON */
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id, type: "request", method, params }));
  });
}

async function captureCall(
  ws: WebSocket,
  name: string,
  method: string,
  params: Record<string, unknown>,
) {
  const startTime = Date.now();
  const response = await sendRPC(ws, method, params);
  const elapsed = Date.now() - startTime;

  capturedCases.push({ name, method, params, result: response.error || response.result, elapsed });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`CASE: ${name} (${elapsed}ms)`);
  console.log(`→ ${method}`, JSON.stringify(params).slice(0, 200));
  if (response.error) {
    console.log(`← ERROR:`, JSON.stringify(response.error));
  } else {
    const resultStr = JSON.stringify(response.result);
    console.log(
      `← RESULT: ${resultStr.length > 300 ? resultStr.slice(0, 300) + "..." : resultStr}`,
    );
  }

  return response;
}

function waitForEvent(
  ws: WebSocket,
  eventName: string,
  predicate?: (msg: RPCMessage) => boolean,
  timeoutMs = 60000,
): Promise<RPCMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Event timeout: ${eventName}`)), timeoutMs);
    const handler = (data: Buffer) => {
      try {
        const msg: RPCMessage = JSON.parse(data.toString());
        if (msg.type === "event" && msg.eventType === eventName && msg.payload) {
          if (!predicate || predicate(msg)) {
            clearTimeout(timeout);
            ws.off("message", handler);
            resolve(msg);
          }
        }
      } catch {
        /* ignore non-JSON */
      }
    };
    ws.on("message", handler);
  });
}

async function main() {
  console.log("Connecting to", WS_URL);
  const ws = await connect();
  console.log("Connected!\n");

  // Step 1: Health check
  await captureCall(ws, "Server health check", "system.ping", {});

  // Step 2: Create session
  const sessionRes = await captureCall(ws, "Create session", "session.create", {
    projectPath: PROJECT_PATH,
  });
  if (sessionRes.error) {
    console.error("Failed to create session:", sessionRes.error);
    ws.close();
    return;
  }
  const { sessionId, sessionPath } = sessionRes.result as {
    sessionId: string;
    sessionPath: string;
  };
  console.log(`\nSession: ${sessionId}`);

  // Step 3: List memory files BEFORE
  const listBefore = await captureCall(ws, "Memory BEFORE", "memory.listFiles", {
    projectPath: PROJECT_PATH,
    sessionId,
  });
  const filesBefore = (listBefore.result as { files: unknown[] })?.files || [];
  console.log(`  Files before: ${filesBefore.length}`);

  // Step 4: Start agent (loads Learning memory extension)
  console.log("\n🚀 Starting agent with Learning memory extension...");
  await captureCall(ws, "Start agent", "agent.start", {
    sessionId,
    projectPath: PROJECT_PATH,
    sessionPath,
    content: "你好，请回复 'Agent ready'",
  });

  // Wait for agent ready event
  try {
    const readyEvent = await waitForEvent(
      ws,
      "agent.event",
      (msg) => {
        const p = msg.payload as { sessionId?: string; type?: string };
        return p?.sessionId === sessionId;
      },
      30000,
    );
    const payload = readyEvent.payload as { type?: string; data?: string };
    console.log(`  Agent event: ${payload?.type}`);
  } catch (e) {
    console.log(`  Agent event timeout (continuing anyway): ${(e as Error).message}`);
  }

  // Step 5: memory.remember (bookmark trigger)
  const testContent =
    "这是一条测试消息，用于验证收藏/记忆功能。项目使用了 React + TypeScript + Zustand 技术栈。包含 WebSocket RPC 通信和 Learning memory 插件集成。";
  const testMessageIds = ["test-msg-001", "test-msg-002"];

  const rememberRes = await captureCall(ws, "memory.remember (存为记忆)", "memory.remember", {
    projectPath: PROJECT_PATH,
    sessionId,
    messageIds: testMessageIds,
    content: testContent,
  });
  const rememberOk = (rememberRes.result as { ok: boolean })?.ok;
  console.log(`  remember returned: ${rememberOk}`);

  if (!rememberOk) {
    console.error("memory.remember failed!");
    await sendRPC(ws, "agent.stop", { sessionId }).catch(() => {});
    ws.close();
    return;
  }

  // Step 6: Wait for plugin to process (LLM summary)
  console.log("\n⏳ Waiting 15s for Learning memory plugin to process (LLM summary)...");
  await new Promise((r) => setTimeout(r, 15000));

  // Step 7: List memory files AFTER
  const listAfter = await captureCall(ws, "Memory AFTER", "memory.listFiles", {
    projectPath: PROJECT_PATH,
    sessionId,
  });
  const filesAfter =
    (
      listAfter.result as {
        files: Array<{
          filename: string;
          filePath: string;
          type: string | null;
          description: string | null;
        }>;
      }
    )?.files || [];
  console.log(`  Files after: ${filesAfter.length}`);

  const newFiles = filesAfter.filter(
    (f) => !filesBefore.some((b: unknown) => (b as { filename: string }).filename === f.filename),
  );
  console.log(`  New files: ${newFiles.length}`);
  for (const f of newFiles) {
    console.log(`    - ${f.filename} (type=${f.type}, desc="${f.description?.slice(0, 60)}")`);
  }

  // Step 8: Read new bookmark files
  for (const f of newFiles) {
    const readRes = await captureCall(ws, `Read: ${f.filename}`, "memory.readFile", {
      filePath: f.filePath,
    });
    const content = (readRes.result as { content: string })?.content || "";
    console.log(`\n  --- FILE CONTENT ---`);
    console.log(content.slice(0, 800));
    console.log(`  --- END ---`);
  }

  // Step 9: Cleanup - stop agent
  await captureCall(ws, "Stop agent", "agent.stop", { sessionId });

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("VERIFICATION SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Project:      ${PROJECT_PATH}`);
  console.log(`Session:      ${sessionId}`);
  console.log(`Files before: ${filesBefore.length}`);
  console.log(`Files after:  ${filesAfter.length}`);
  console.log(`New files:    ${newFiles.length}`);
  console.log(`Remember ok:  ${rememberOk}`);
  console.log(
    `\nResult: ${newFiles.length > 0 ? "✅ PASS - New bookmark file(s) created" : "❌ FAIL - No new files"}`,
  );

  ws.close();

  // Save captured test cases
  const fs = await import("fs/promises");
  const casePath = "test/bookmark-rpc-cases.json";
  await fs.writeFile(casePath, JSON.stringify(capturedCases, null, 2));
  console.log(`\n📝 Test cases saved to ${casePath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

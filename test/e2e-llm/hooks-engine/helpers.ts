import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../../helpers/integration-server";

export { startTestServer, stopTestServer, type TestServerResult };

export interface HookPaths {
  dir: string;
  log: string;
  stdin: string;
  env: string;
}

export function getHookPaths(testId: string): HookPaths {
  const dir = join(tmpdir(), `hooks-test-${testId}`);
  return {
    dir,
    log: join(dir, "log.txt"),
    stdin: join(dir, "stdin.txt"),
    env: join(dir, "env.txt"),
  };
}

export const HOOK_BASE_PORT = 3200;

export interface HookTestContext {
  server: TestServerResult;
  ws: WebSocket;
  sessionId: string;
  sessionPath: string;
  projectDir: string;
  port: number;
}

const RPC_TIMEOUT = 60_000;

export function hookTestUrl(port: number, token: string): string {
  return `ws://localhost:${port}/ws?token=${token}`;
}

export async function sendRPC(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  timeout = RPC_TIMEOUT,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      reject(new Error(`RPC call timeout: ${method}`));
    }, timeout);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.id === id && msg.type === "response") {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch {
        // ignore
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

export function subscribe(ws: WebSocket, eventType: string, filter: Record<string, unknown>): void {
  ws.send(JSON.stringify({ type: "subscribe", id: randomUUID(), eventType, filter }));
}

export function waitForEvent(
  ws: WebSocket,
  eventName: string,
  predicate?: (msg: Record<string, unknown>) => boolean,
  timeout = RPC_TIMEOUT,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === "event" && msg.eventType === eventName && msg.payload) {
          if (!predicate || predicate(msg)) {
            clearTimeout(timer);
            ws.off("message", handler);
            resolve(msg);
          }
        }
      } catch {
        // ignore
      }
    };
    ws.on("message", handler);
  });
}

export async function createSession(
  ws: WebSocket,
  projectPath: string,
): Promise<{ sessionId: string; sessionPath: string }> {
  const resp = await sendRPC(ws, "session.create", { projectPath });
  if (resp.error) {
    throw new Error(`session.create failed: ${(resp.error as Record<string, unknown>).message}`);
  }
  return resp.result as { sessionId: string; sessionPath: string };
}

export async function safeStop(
  ws: WebSocket | undefined,
  sessionId: string | undefined,
): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
  try {
    await sendRPC(ws, "agent.stop", { sessionId });
  } catch {
    // cleanup
  }
}

export function closeWs(ws: WebSocket | undefined): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
}

export async function ensureHooksTestDir(paths: HookPaths): Promise<void> {
  await mkdir(paths.dir, { recursive: true });
}

export async function clearLog(paths: HookPaths): Promise<void> {
  if (existsSync(paths.log)) {
    await writeFile(paths.log, "");
  }
  if (existsSync(paths.stdin)) {
    await writeFile(paths.stdin, "");
  }
  if (existsSync(paths.env)) {
    await writeFile(paths.env, "");
  }
}

export async function readLog(paths: HookPaths): Promise<string> {
  if (!existsSync(paths.log)) return "";
  return readFile(paths.log, "utf-8");
}

export async function readStdin(paths: HookPaths): Promise<string> {
  if (!existsSync(paths.stdin)) return "";
  return readFile(paths.stdin, "utf-8");
}

export async function readEnvDump(paths: HookPaths): Promise<string> {
  if (!existsSync(paths.env)) return "";
  return readFile(paths.env, "utf-8");
}

export async function createVerifyHookScript(paths: HookPaths): Promise<string> {
  const scriptPath = join(paths.dir, "verify-hook.sh");
  const script = `#!/bin/bash
echo "EVENT=$PI_HOOK_TOOL AGENT=$PI_HOOK_AGENT_NAME HOOK_EVENT=$PI_HOOK_EVENT_NAME" >> ${paths.log}
cat >> ${paths.stdin}
env | grep -E '^(PI_HOOK_|CLAUDE_)' > ${paths.env}
exit 0
`;
  await writeFile(scriptPath, script);
  const { chmod } = await import("fs/promises");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function createDenyHookScript(paths: HookPaths): Promise<string> {
  const scriptPath = join(paths.dir, "deny-hook.sh");
  const script = `#!/bin/bash
echo "DENIED tool=$PI_HOOK_TOOL" >> ${paths.log}
echo "Blocked by deny hook" >&2
exit 2
`;
  await writeFile(scriptPath, script);
  const { chmod } = await import("fs/promises");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function createAskHookScript(paths: HookPaths): Promise<string> {
  const scriptPath = join(paths.dir, "ask-hook.sh");
  const script = `#!/bin/bash
echo "ASKED tool=$PI_HOOK_TOOL" >> ${paths.log}
echo "Confirmation required" >&2
exit 3
`;
  await writeFile(scriptPath, script);
  const { chmod } = await import("fs/promises");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function createTaggedHookScript(tag: string, paths: HookPaths): Promise<string> {
  const scriptPath = join(paths.dir, `${tag}-hook.sh`);
  const script = `#!/bin/bash
echo "${tag.toUpperCase()}-HOOK tool=$PI_HOOK_TOOL" >> ${paths.log}
exit 0
`;
  await writeFile(scriptPath, script);
  const { chmod } = await import("fs/promises");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function createDumpEnvScript(paths: HookPaths): Promise<string> {
  const scriptPath = join(paths.dir, "dump-env.sh");
  const script = `#!/bin/bash
echo "EVENT=$PI_HOOK_TOOL" >> ${paths.log}
env | grep -E '^(PI_HOOK_|CLAUDE_)' > ${paths.env}
exit 0
`;
  await writeFile(scriptPath, script);
  const { chmod } = await import("fs/promises");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function createTimeoutHookScript(seconds: number, paths: HookPaths): Promise<string> {
  const scriptPath = join(paths.dir, "timeout-hook.sh");
  const script = `#!/bin/bash
echo "TIMEOUT-START tool=$PI_HOOK_TOOL" >> ${paths.log}
sleep ${seconds}
echo "TIMEOUT-DONE tool=$PI_HOOK_TOOL" >> ${paths.log}
exit 0
`;
  await writeFile(scriptPath, script);
  const { chmod } = await import("fs/promises");
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function createProjectDir(name: string): Promise<string> {
  const dir = join(tmpdir(), `pi-hooks-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, ".claude"), { recursive: true });
  return dir;
}

export async function writeGlobalSettings(
  hooks: Record<string, unknown>,
  homeDir?: string,
): Promise<string> {
  const resolvedHome = homeDir ?? process.env.HOME ?? "";
  const settingsDir = join(resolvedHome, ".claude");
  await mkdir(settingsDir, { recursive: true });
  const settingsPath = join(settingsDir, "settings.json");

  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(await readFile(settingsPath, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  existing.hooks = hooks;
  await writeFile(settingsPath, JSON.stringify(existing, null, 2));
  return settingsPath;
}

export async function writeProjectSettings(
  projectDir: string,
  hooks: Record<string, unknown>,
): Promise<void> {
  const settingsDir = join(projectDir, ".claude");
  await mkdir(settingsDir, { recursive: true });
  const settingsPath = join(settingsDir, "settings.json");

  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(await readFile(settingsPath, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  existing.hooks = hooks;
  await writeFile(settingsPath, JSON.stringify(existing, null, 2));
}

export async function removeProjectSettings(projectDir: string): Promise<void> {
  const settingsPath = join(projectDir, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    await rm(settingsPath);
  }
}

export async function cleanupProjectDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

export interface SetupHookTestOptions {
  port: number;
  authToken: string;
  projectDir: string;
}

export async function setupHookTest(options: SetupHookTestOptions): Promise<HookTestContext> {
  const { port, authToken, projectDir } = options;

  const server = await startTestServer({
    port,
    authToken,
    projectPath: projectDir,
  });

  const wsUrl = hookTestUrl(port, authToken);
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket connection timeout"));
    }, 15_000);
    socket.on("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const session = await createSession(ws, projectDir);

  return {
    server,
    ws,
    sessionId: session.sessionId,
    sessionPath: session.sessionPath,
    projectDir,
    port,
  };
}

export async function teardownHookTest(ctx: HookTestContext): Promise<void> {
  await safeStop(ctx.ws, ctx.sessionId);
  closeWs(ctx.ws);
  await stopTestServer(ctx.server);
  await cleanupProjectDir(ctx.projectDir);
}

export function parseLogLines(log: string): string[] {
  return log
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function countEventsInLog(log: string, prefix: string): number {
  return parseLogLines(log).filter((l) => l.startsWith(prefix)).length;
}

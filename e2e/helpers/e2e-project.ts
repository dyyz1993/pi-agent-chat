import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { RpcDriver, SessionCreateResult } from "./rpc-driver";

export const E2E_AUTH_TOKEN = process.env.E2E_AUTH_TOKEN ?? "test-ci-token";
export const E2E_PAGE_URL = `/?token=${encodeURIComponent(E2E_AUTH_TOKEN)}`;

let preparedProjectPromise: Promise<string> | null = null;

function getRpcUrl(): string {
  const host = process.env.E2E_HOST ?? "127.0.0.1";
  const apiPort = process.env.E2E_API_PORT ?? "3100";
  return `ws://${host}:${apiPort}/ws?token=${encodeURIComponent(E2E_AUTH_TOKEN)}`;
}

function rpcCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const id = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(getRpcUrl());
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`RPC ${method} timed out`));
    }, 10_000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ id, type: "request", method, params }));
    });

    ws.on("message", (data) => {
      let payload: { id?: string; error?: { message?: string }; result?: T };
      try {
        payload = JSON.parse(data.toString()) as typeof payload;
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      if (payload.id !== id) return;
      clearTimeout(timeout);
      ws.close();
      if (payload.error) {
        reject(new Error(payload.error.message ?? `RPC ${method} failed`));
        return;
      }
      resolve(payload.result as T);
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function ensureE2EProject(): Promise<string> {
  preparedProjectPromise ??= (async () => {
    const projectPath = join(tmpdir(), "pi-agent-chat-e2e-project");
    await mkdir(projectPath, { recursive: true });
    await writeFile(
      join(projectPath, "README.md"),
      "# Pi Agent Chat E2E Project\n\nTemporary project opened by Playwright smoke tests.\n",
    );
    await rpcCall("project.open", { path: projectPath });
    return projectPath;
  })();

  return preparedProjectPromise;
}

/**
 * Create a fresh session for the e2e project and start the agent. Use this
 * in L2/L4 tests that need a real session backed by pi CLI. Returns the
 * session id and path so callers can drive the goal lifecycle via RpcDriver.
 */
export async function ensureE2ESession(driver: RpcDriver): Promise<SessionCreateResult> {
  const projectPath = await ensureE2EProject();
  const session = await driver.createSession(projectPath, "e2e-session");
  await driver.startAgent(session.sessionId, projectPath, session.sessionPath);
  return session;
}

/** Cancel any active goal and clean up. Best-effort; ignores errors. */
export async function cleanupE2ESession(driver: RpcDriver, sessionId: string): Promise<void> {
  try {
    await driver.clearGoal(sessionId);
  } catch {
    // ignore — goal may already be cleared
  }
}

